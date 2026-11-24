/** Keeps this phone and the server database in step. */
import { PUSH_TABLES, TABLE_NAMES, type Row, type TableName } from '../shared/model';
import { db, onLocalChange, table } from './db';
import { API, getSession, setSession } from './session';

const BATCH = 1000;

export type SyncKind = 'idle' | 'syncing' | 'offline' | 'signed-out' | 'error';
export interface SyncState {
  kind: SyncKind;
  pending: number;
  lastSync: string | null;
  message?: string;
}

let state: SyncState = { kind: 'idle', lastSync: null, pending: 0 };
const subs = new Set<(s: SyncState) => void>();
export const getSyncState = () => state;
export function subscribeSync(fn: (s: SyncState) => void) {
  subs.add(fn);
  fn(state);
  return () => void subs.delete(fn);
}
function set(s: Partial<SyncState>) {
  state = { ...state, ...s };
  subs.forEach((fn) => fn(state));
}

async function meta<T>(key: string, fallback: T): Promise<T> {
  return ((await db.meta.get(key))?.value as T) ?? fallback;
}
const setMeta = (key: string, value: unknown) => db.meta.put({ key, value });

let running: Promise<void> | null = null;
let again = false;

export function syncNow(opts: { full?: boolean } = {}): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = doSync(opts).finally(() => {
    running = null;
    if (again) {
      again = false;
      void syncNow();
    }
  });
  return running;
}

/** Role or zones changed: drop what this phone holds (except unsent edits) and download again. */
async function resetScope() {
  const keep = new Set((await db.outbox.toArray()).map((o) => o.key));
  for (const t of TABLE_NAMES) {
    const ids = (await table(t).toCollection().primaryKeys()) as string[];
    await table(t).bulkDelete(ids.filter((id) => !keep.has(`${t}:${id}`)));
  }
}

async function doSync({ full = false }: { full?: boolean }): Promise<void> {
  const session = getSession();
  const lastSync = await meta<string | null>('lastSync', null);
  const pending = await db.outbox.count();
  if (!session) return set({ kind: 'signed-out', pending, lastSync });
  if (!navigator.onLine) return set({ kind: 'offline', pending, lastSync });
  set({ kind: 'syncing', pending, lastSync });

  try {
    let cursor = full ? 0 : await meta<number>('cursor', 0);
    let more = true;
    let rounds = 0;
    while (more && rounds++ < 200) {
      const items = (await db.outbox.limit(BATCH).toArray()).filter((i) => PUSH_TABLES.includes(i.table));
      const changes: Partial<Record<TableName, Row[]>> = {};
      const sentAt = new Map<string, string>();
      for (const t of PUSH_TABLES) {
        const ids = items.filter((i) => i.table === t).map((i) => i.id);
        if (!ids.length) continue;
        const rows = (await table(t).bulkGet(ids)).filter(Boolean) as Row[];
        changes[t] = rows;
        rows.forEach((r) => sentAt.set(`${t}:${r.id}`, r.updated_at));
      }

      const res = await fetch(`${API}/api/sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ cursor, changes }),
      }).catch(() => null);

      if (!res) return set({ kind: 'offline', pending: await db.outbox.count() });
      if (res.status === 401) {
        setSession(null);
        return set({ kind: 'signed-out', pending: await db.outbox.count() });
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error(data?.error ?? `Server error ${res.status}`);

      const prevScope = await meta<string | null>('scope', null);
      if (prevScope !== data.scope) {
        await setMeta('scope', data.scope);
        if (prevScope !== null && cursor !== 0) {
          await resetScope();
          await setMeta('cursor', 0);
          cursor = 0;
          continue; // pull again from the start with the new scope
        }
      }

      await db.transaction('rw', [db.outbox, ...TABLE_NAMES.map(table)], async () => {
        for (const i of items) {
          const row = await table(i.table).get(i.id);
          if (!row || row.updated_at === sentAt.get(i.key)) await db.outbox.delete(i.key);
        }
        for (const t of TABLE_NAMES) {
          const incoming = (data.changes?.[t] ?? []) as Row[];
          if (!incoming.length) continue;
          const pendingIds = new Set((await db.outbox.where('table').equals(t).toArray()).map((o) => o.id));
          const locals = await table(t).bulkGet(incoming.map((r) => r.id));
          const toPut = incoming.filter((r, idx) => !pendingIds.has(r.id) && (!locals[idx] || locals[idx]!.updated_at <= r.updated_at));
          if (toPut.length) await table(t).bulkPut(toPut);
        }
      });

      // Keep the signed-in profile (role, zone) fresh
      const meRow = (data.changes?.users as Row[] | undefined)?.find((u) => u.id === session.user.id);
      if (meRow) setSession({ token: session.token, user: meRow as typeof session.user });

      cursor = data.cursor;
      await setMeta('cursor', cursor);
      more = Boolean(data.more) || (await db.outbox.count()) > 0;
    }
    const now = new Date().toISOString();
    await setMeta('lastSync', now);
    set({ kind: 'idle', lastSync: now, pending: await db.outbox.count(), message: undefined });
  } catch (e) {
    set({ kind: 'error', message: e instanceof Error ? e.message : String(e), pending: await db.outbox.count() });
  }
}

let started = false;
/** Automatic syncing: on open, every minute, when back online, and shortly after edits. */
export function startAutoSync() {
  if (started) return;
  started = true;
  let t: ReturnType<typeof setTimeout> | undefined;
  onLocalChange(() => {
    clearTimeout(t);
    t = setTimeout(() => void syncNow(), 2000);
    void db.outbox.count().then((pending) => set({ pending }));
  });
  window.addEventListener('online', () => void syncNow());
  window.addEventListener('offline', () => set({ kind: 'offline' }));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void syncNow());
  setInterval(() => void syncNow(), 60_000);
  void syncNow();
}
