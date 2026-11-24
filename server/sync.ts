/**
 * Two-way sync. A phone sends the records it changed (push) and receives
 * everything that changed since its last sync (pull) — but only within the
 * zones that person works in. Conflicts: the most recent edit wins.
 */
import { PUSH_TABLES, TABLES, TABLE_NAMES, userZoneIds, type TableName, type User } from '../shared/model.js';
import type { Query } from './db.js';
import { ensureSchema } from './schema.js';

const MAX_PUSH = 5000;
const PAGE = 3000;
/** Re-read a few revisions on every pull to cover writes that finished late. */
const OVERLAP = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SyncRequest {
  cursor?: number;
  changes?: Partial<Record<TableName, Record<string, unknown>[]>>;
}

export interface ApiResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

type R = Record<string, unknown>;

function cleanRow(t: TableName, r: R): R | null {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !UUID.test(r.id)) return null;
  if (typeof r.updated_at !== 'string' || isNaN(Date.parse(r.updated_at))) return null;
  const out: R = {};
  for (const c of TABLES[t]) if (c.name in r) out[c.name] = r[c.name];
  return out;
}

function upsertSql(t: TableName): string {
  const cols = TABLES[t];
  const names = cols.map((c) => c.name);
  const selects = cols.map((c) => (c.def ? `COALESCE(r.${c.name}, ${c.def})` : `r.${c.name}`));
  return `INSERT INTO ${t} (${names.join(', ')}, rev, server_updated_at)
SELECT ${selects.join(', ')}, nextval('ffim_rev'), now()
FROM json_populate_recordset(NULL::${t}, $1::json) AS r
ON CONFLICT (id) DO UPDATE SET
  ${names.filter((n) => n !== 'id').map((n) => `${n} = EXCLUDED.${n}`).join(',\n  ')},
  rev = nextval('ffim_rev'), server_updated_at = now()
WHERE ${t}.updated_at <= EXCLUDED.updated_at`;
}

/** Same shape regardless of driver: ISO timestamps, numbers as numbers. */
export function normalize(t: TableName, r: R): R {
  for (const c of TABLES[t]) {
    const v = r[c.name];
    if (v == null) continue;
    if (c.type === 'timestamptz') r[c.name] = new Date(v as string).toISOString();
    else if (c.type === 'float' || c.type === 'int') r[c.name] = Number(v);
    else if (c.type === 'jsonb' && typeof v === 'string') r[c.name] = JSON.parse(v);
  }
  return r;
}

const cols = (t: TableName) => TABLES[t].map((c) => c.name).join(', ');

export async function handleSync(req: SyncRequest, me: User, q: Query): Promise<ApiResult> {
  await ensureSchema(q);
  const zones = (await q(`SELECT id, pastor_id, deleted FROM zones`)) as { id: string; pastor_id: string | null; deleted: boolean }[];
  const scope = userZoneIds(me, zones); // null = everything
  const allowed = (z: unknown) => scope === null || (typeof z === 'string' && scope.includes(z));
  const zoneList: string[] = scope ?? [];
  const isLead = me.role === 'admin' || me.role === 'pastor';

  // ---- push ----
  let pushed = 0, rejected = 0;
  const changes = req.changes ?? {};
  const batchHouseZone = new Map<unknown, unknown>();
  for (const t of PUSH_TABLES) {
    const raw = changes[t];
    if (!Array.isArray(raw) || raw.length === 0) continue;
    if (raw.length > MAX_PUSH) return { status: 413, body: { error: `Too many ${t} in one sync (max ${MAX_PUSH})` } };
    let rows = raw.map((r) => cleanRow(t, r)).filter((r): r is R => !!r);

    if (scope !== null || t === 'zones') {
      const ids = rows.map((r) => r.id as string);
      if (t === 'zones') {
        if (me.role !== 'admin') rows = [];
      } else if (t === 'houses') {
        const prev = new Map<unknown, unknown>(
          (await q(`SELECT id, zone_id FROM houses WHERE id = ANY($1::uuid[])`, [ids])).map((r) => [r.id, r.zone_id]),
        );
        rows = rows.filter(
          (r) =>
            allowed(r.zone_id) &&
            (!prev.has(r.id) || allowed(prev.get(r.id))) &&
            (isLead || !r.deleted),
        );
      } else {
        // people / visits / tasks: allowed when their house is in my zones
        const houseIds = [...new Set(rows.map((r) => r.house_id as string))].filter((h) => UUID.test(String(h)));
        const hz = new Map<unknown, unknown>(
          (await q(`SELECT id, zone_id FROM houses WHERE id = ANY($1::uuid[])`, [houseIds])).map((r) => [r.id, r.zone_id]),
        );
        for (const [k, v] of batchHouseZone) hz.set(k, v);
        if (t === 'people') {
          // A person may be on the members list without a house (admins and pastors manage that list),
          // and may only be moved between houses the user can see.
          const prevHouse = new Map<unknown, unknown>(
            (await q(`SELECT id, house_id FROM people WHERE id = ANY($1::uuid[])`, [ids])).map((r) => [r.id, r.house_id]),
          );
          const prevZone = new Map<unknown, unknown>(
            (await q(`SELECT id, zone_id FROM houses WHERE id = ANY($1::uuid[])`, [[...new Set([...prevHouse.values()].filter(Boolean))]])).map((r) => [r.id, r.zone_id]),
          );
          rows = rows.filter((r) => {
            const okNew = r.house_id == null ? isLead || (prevHouse.has(r.id) && prevHouse.get(r.id) == null) : allowed(hz.get(r.house_id));
            const old = prevHouse.get(r.id);
            const okOld = old == null || allowed(prevZone.get(old) ?? hz.get(old));
            return okNew && okOld;
          });
        } else rows = rows.filter((r) => allowed(hz.get(r.house_id)));
        if (t === 'tasks' && !isLead) {
          const prev = new Map<unknown, unknown>(
            (await q(`SELECT id, assignee_id FROM tasks WHERE id = ANY($1::uuid[])`, [ids])).map((r) => [r.id, r.assignee_id]),
          );
          rows = rows.filter((r) => prev.get(r.id) === me.id && r.assignee_id === me.id);
        }
      }
      rejected += raw.length - rows.length;
    }
    if (t === 'houses') for (const r of rows) batchHouseZone.set(r.id, r.zone_id);
    if (!rows.length) continue;

    let movedHouses: string[] = [];
    if (t === 'houses') {
      const before = new Map<unknown, unknown>(
        (await q(`SELECT id, zone_id FROM houses WHERE id = ANY($1::uuid[])`, [rows.map((r) => r.id)])).map((r) => [r.id, r.zone_id]),
      );
      movedHouses = rows.filter((r) => before.has(r.id) && before.get(r.id) !== (r.zone_id ?? null)).map((r) => r.id as string);
    }
    await q(upsertSql(t), [JSON.stringify(rows)]);
    pushed += rows.length;
    // A house that moved into another zone: re-send its people/visits/tasks so the new zone's phones get them.
    if (movedHouses.length) {
      for (const child of ['people', 'visits', 'tasks'])
        await q(`UPDATE ${child} SET rev = nextval('ffim_rev') WHERE house_id = ANY($1::uuid[])`, [movedHouses]);
    }
  }

  // ---- pull ----
  const seq = await q(`SELECT CASE WHEN is_called THEN last_value ELSE 0 END AS v FROM ffim_rev`);
  const maxRev = Number(seq[0]?.v ?? 0);
  const cursor = Math.max(0, Number(req.cursor) || 0);
  const since = Math.max(0, cursor - OVERLAP);
  const upper = Math.min(since + PAGE, maxRev);
  const out: Record<string, unknown[]> = {};
  for (const t of TABLE_NAMES) {
    if (since >= upper) {
      out[t] = [];
      continue;
    }
    let where = 'rev > $1 AND rev <= $2';
    const params: unknown[] = [since, upper];
    if (scope !== null) {
      if (t === 'houses') where += ' AND zone_id = ANY($3::uuid[])';
      else if (t === 'people')
        // people in my zones, plus the members list (members whose house isn't mapped yet)
        where += ' AND (house_id IS NULL OR house_id IN (SELECT id FROM houses WHERE zone_id = ANY($3::uuid[])))';
      else if (t === 'visits' || t === 'tasks')
        where += ' AND house_id IN (SELECT id FROM houses WHERE zone_id = ANY($3::uuid[]))';
      else if (t === 'users')
        where += ' AND (id = $4 OR zone_id = ANY($3::uuid[]) OR id IN (SELECT pastor_id FROM zones WHERE id = ANY($3::uuid[])))';
      if (t !== 'zones') params.push(zoneList);
      if (t === 'users') params.push(me.id);
    }
    const rows = await q(`SELECT ${cols(t)} FROM ${t} WHERE ${where} ORDER BY rev`, params);
    out[t] = rows.map((r) => normalize(t, r));
  }

  return {
    status: 200,
    body: {
      cursor: upper,
      more: upper < maxRev,
      pushed,
      rejected,
      // Changes when this person's role or zones change → the phone re-downloads its data.
      scope: `${me.role}:${scope === null ? '*' : [...scope].sort().join(',')}`,
      changes: out,
      serverTime: new Date().toISOString(),
    },
  };
}
