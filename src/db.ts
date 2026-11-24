/**
 * The phone's own database (IndexedDB). Everything is saved here first, so the
 * app works with no signal. Changes are queued in `outbox` and sent to the
 * server by sync.ts when there is a connection.
 */
import Dexie, { type Table } from 'dexie';
import { zoneFor, type House, type Person, type Row, type TableName, type Task, type User, type Visit, type Zone } from '../shared/model';
import { myId, myName } from './session';

export interface OutboxItem {
  key: string; // `${table}:${id}`
  table: TableName;
  id: string;
  at: string;
}

export interface Meta {
  key: string;
  value: unknown;
}

class GatherDB extends Dexie {
  houses!: Table<House, string>;
  people!: Table<Person, string>;
  visits!: Table<Visit, string>;
  zones!: Table<Zone, string>;
  tasks!: Table<Task, string>;
  users!: Table<User, string>;
  outbox!: Table<OutboxItem, string>;
  meta!: Table<Meta, string>;

  constructor() {
    super('ffim-gather');
    this.version(1).stores({
      houses: 'id, code, osm_id, updated_at',
      people: 'id, house_id, updated_at',
      visits: 'id, house_id, person_id, visited_at',
      outbox: 'key, table',
      meta: 'key',
    });
    this.version(2).stores({
      houses: 'id, code, osm_id, zone_id',
      tasks: 'id, house_id, assignee_id',
      zones: 'id',
      users: 'id',
    });
  }
}

export const db = new GatherDB();

export function table(t: TableName): Table<Row, string> {
  return db[t] as unknown as Table<Row, string>;
}

export async function wipeLocalData() {
  await db.transaction('rw', [db.houses, db.people, db.visits, db.zones, db.tasks, db.users, db.outbox, db.meta], async () => {
    for (const t of [db.houses, db.people, db.visits, db.zones, db.tasks, db.users, db.outbox, db.meta]) await t.clear();
  });
}

export function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
  );
}

const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Fast code maker for adding many houses at once. */
export async function codeMaker(): Promise<() => string> {
  const used = new Set((await db.houses.orderBy('code').keys()) as string[]);
  return () => {
    for (;;) {
      let s = 'H-';
      for (const b of crypto.getRandomValues(new Uint8Array(5))) s += CODE_CHARS[b % CODE_CHARS.length];
      if (!used.has(s)) {
        used.add(s);
        return s;
      }
    }
  };
}

export async function newHouseCode(): Promise<string> {
  for (;;) {
    let s = 'H-';
    for (const b of crypto.getRandomValues(new Uint8Array(5))) s += CODE_CHARS[b % CODE_CHARS.length];
    if (!(await db.houses.where('code').equals(s).count())) return s;
  }
}

// ---------------------------------------------------------------------------
// Writing data. Always go through these so changes get synced.
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();
export function onLocalChange(fn: Listener) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function base() {
  const now = new Date().toISOString();
  return { extra: {}, created_at: now, updated_at: now, updated_by: myName(), deleted: false };
}

export async function saveRows<T extends Row>(t: TableName, rows: T[]): Promise<void> {
  if (!rows.length) return;
  const now = new Date().toISOString();
  const by = myName();
  const stamped = rows.map((r) => ({ ...r, updated_at: now, updated_by: by }));
  await db.transaction('rw', [table(t), db.outbox], async () => {
    await table(t).bulkPut(stamped);
    await db.outbox.bulkPut(stamped.map((r) => ({ key: `${t}:${r.id}`, table: t, id: r.id, at: now })));
  });
  listeners.forEach((fn) => fn());
}

export const save = <T extends Row>(t: TableName, row: T) => saveRows(t, [row]);

export async function newHouse(lat: number, lng: number, fields: Partial<House> = {}): Promise<House> {
  const zones = await db.zones.toArray();
  const h: House = {
    id: uuid(),
    code: await newHouseCode(),
    lat,
    lng,
    zone_id: zoneFor(lat, lng, zones),
    name: null,
    address: null,
    area: null,
    description: null,
    household_size: null,
    is_member_household: false,
    do_not_visit: false,
    next_visit_on: null,
    source: 'manual',
    osm_id: null,
    external_ref: null,
    ...base(),
    ...fields,
  };
  await save('houses', h);
  return h;
}

/** Move a house pin; its zone follows its new position. */
export async function moveHouse(id: string, lat: number, lng: number) {
  const [h, zones] = await Promise.all([db.houses.get(id), db.zones.toArray()]);
  if (h) await save('houses', { ...h, lat, lng, zone_id: zoneFor(lat, lng, zones) });
}

export function blankPerson(house_id: string | null): Person {
  return {
    id: uuid(),
    house_id,
    full_name: '',
    phone: null,
    email: null,
    gender: null,
    age_group: null,
    is_member: false,
    member_since: null,
    consent_contact: true,
    prayer_requests: null,
    notes: null,
    external_member_id: null,
    ...base(),
  };
}

export function blankVisit(house_id: string): Visit {
  return {
    id: uuid(),
    house_id,
    person_id: null,
    kind: 'evangelism',
    outcome: null,
    visited_at: new Date().toISOString(),
    notes: null,
    next_step: null,
    visited_by: myName(),
    user_id: myId(),
    ...base(),
  };
}

export function blankTask(house_id: string, fields: Partial<Task> = {}): Task {
  return {
    id: uuid(),
    house_id,
    assignee_id: null,
    action: 'follow_up',
    due_on: null,
    note: null,
    status: 'open',
    done_at: null,
    assigned_by: myId(),
    ...base(),
    ...fields,
  };
}

/** Logging a visit completes my open tasks at that house. */
export async function completeMyTasks(house_id: string) {
  const me = myId();
  const open = await db.tasks.where('house_id').equals(house_id).filter((t) => !t.deleted && t.status === 'open' && t.assignee_id === me).toArray();
  const now = new Date().toISOString();
  await saveRows('tasks', open.map((t) => ({ ...t, status: 'done' as const, done_at: now })));
  return open;
}

/** Soft-delete a house together with its people, visits and tasks. */
export async function deleteHouse(id: string): Promise<void> {
  const h = await db.houses.get(id);
  if (!h) return;
  await saveRows('houses', [{ ...h, deleted: true }]);
  // Members stay on the members list (just without a house); everything else goes with the house
  const people = await db.people.where('house_id').equals(id).toArray();
  await saveRows('people', people.map((p) => (p.is_member ? { ...p, house_id: null } : { ...p, deleted: true })));
  for (const t of ['visits', 'tasks'] as const) {
    const rows = await table(t).filter((r) => (r as Visit).house_id === id).toArray();
    await saveRows(t, rows.map((r) => ({ ...r, deleted: true })));
  }
}

/** After a zone is drawn or changed: put every house in the zone it now sits in. */
export async function reassignZones() {
  const [houses, zones] = await Promise.all([db.houses.filter((h) => !h.deleted).toArray(), db.zones.toArray()]);
  const changed = houses.filter((h) => (h.zone_id ?? null) !== zoneFor(h.lat, h.lng, zones)).map((h) => ({ ...h, zone_id: zoneFor(h.lat, h.lng, zones) }));
  await saveRows('houses', changed);
  return changed.length;
}

/** Make someone a member (or not). Their house turns green and joins the weekly member check-ups. */
export async function setMember(p: Person, isMember: boolean) {
  const fresh = (await db.people.get(p.id)) ?? p;
  await save('people', { ...fresh, is_member: isMember, member_since: isMember ? fresh.member_since ?? new Date().toISOString().slice(0, 10) : fresh.member_since });
}

/** Link a person (e.g. someone on the members list) to the house they live in. */
export async function linkToHouse(p: Person, houseId: string) {
  const fresh = (await db.people.get(p.id)) ?? p;
  await save('people', { ...fresh, house_id: houseId });
}
