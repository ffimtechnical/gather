/**
 * FFIM Gather — shared data model.
 *
 * Single source of truth for the data structure. The app (browser) and the
 * server (Neon/Postgres) both read these column lists, so a field added here
 * appears in the database, sync and exports.
 *
 * Every record has:
 *  - id          UUID made on the device (works offline, never clashes)
 *  - updated_at  last change time (newest change wins when syncing)
 *  - deleted     soft delete, so deletions reach every phone
 *  - extra       free-form JSON for custom fields without a schema change
 *  - external_*  ID of the same record in another system (member management…)
 */

export type ColType = 'uuid' | 'text' | 'int' | 'float' | 'bool' | 'timestamptz' | 'jsonb';

export interface ColSpec {
  name: string;
  type: ColType;
  notNull?: boolean;
  def?: string;
}

const common: ColSpec[] = [
  { name: 'extra', type: 'jsonb', notNull: true, def: `'{}'::jsonb` },
  { name: 'created_at', type: 'timestamptz', notNull: true, def: 'now()' },
  { name: 'updated_at', type: 'timestamptz', notNull: true, def: 'now()' },
  { name: 'updated_by', type: 'text' },
  { name: 'deleted', type: 'bool', notNull: true, def: 'false' },
];

export type TableName = 'houses' | 'people' | 'visits' | 'zones' | 'tasks' | 'users';
/** Tables kept on the phone and pulled from the server. */
export const TABLE_NAMES: TableName[] = ['zones', 'users', 'houses', 'people', 'visits', 'tasks'];
/** Tables phones may send changes for (users are changed through /api/users). */
export const PUSH_TABLES: TableName[] = ['zones', 'houses', 'people', 'visits', 'tasks'];

export const TABLES: Record<TableName, ColSpec[]> = {
  zones: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'name', type: 'text', notNull: true, def: `''` },
    { name: 'color', type: 'text', notNull: true, def: `'#2f7a4f'` },
    { name: 'polygon', type: 'jsonb', notNull: true, def: `'[]'::jsonb` }, // [[lat,lng], …]
    { name: 'pastor_id', type: 'uuid' },
    { name: 'notes', type: 'text' },
    ...common,
  ],
  // Public user fields. Private fields (PIN hash etc.) live only on the server.
  users: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'name', type: 'text', notNull: true, def: `''` },
    { name: 'phone', type: 'text' },
    { name: 'role', type: 'text', notNull: true, def: `'member'` }, // admin | pastor | member
    { name: 'zone_id', type: 'uuid' },
    { name: 'active', type: 'bool', notNull: true, def: 'true' },
    { name: 'external_member_id', type: 'text' },
    ...common,
  ],
  houses: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'code', type: 'text', notNull: true, def: `''` },
    { name: 'lat', type: 'float', notNull: true },
    { name: 'lng', type: 'float', notNull: true },
    { name: 'zone_id', type: 'uuid' },
    { name: 'name', type: 'text' },
    { name: 'address', type: 'text' },
    { name: 'area', type: 'text' },
    { name: 'description', type: 'text' },
    { name: 'household_size', type: 'int' },
    { name: 'is_member_household', type: 'bool', notNull: true, def: 'false' },
    { name: 'do_not_visit', type: 'bool', notNull: true, def: 'false' },
    { name: 'next_visit_on', type: 'text' },
    { name: 'source', type: 'text', notNull: true, def: `'manual'` },
    { name: 'osm_id', type: 'text' },
    { name: 'external_ref', type: 'text' },
    ...common,
  ],
  people: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'house_id', type: 'uuid' }, // null = on the members list, house not mapped yet
    { name: 'full_name', type: 'text', notNull: true, def: `''` },
    { name: 'phone', type: 'text' },
    { name: 'email', type: 'text' },
    { name: 'gender', type: 'text' },
    { name: 'age_group', type: 'text' },
    { name: 'is_member', type: 'bool', notNull: true, def: 'false' },
    { name: 'member_since', type: 'text' },
    { name: 'consent_contact', type: 'bool', notNull: true, def: 'false' },
    { name: 'prayer_requests', type: 'text' },
    { name: 'notes', type: 'text' },
    { name: 'external_member_id', type: 'text' },
    ...common,
  ],
  visits: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'house_id', type: 'uuid', notNull: true },
    { name: 'person_id', type: 'uuid' },
    { name: 'kind', type: 'text', notNull: true, def: `'evangelism'` },
    { name: 'outcome', type: 'text' },
    { name: 'visited_at', type: 'timestamptz', notNull: true, def: 'now()' },
    { name: 'notes', type: 'text' },
    { name: 'next_step', type: 'text' },
    { name: 'visited_by', type: 'text' },
    { name: 'user_id', type: 'uuid' },
    ...common,
  ],
  tasks: [
    { name: 'id', type: 'uuid', notNull: true },
    { name: 'house_id', type: 'uuid', notNull: true },
    { name: 'assignee_id', type: 'uuid' },
    { name: 'action', type: 'text', notNull: true, def: `'follow_up'` },
    { name: 'due_on', type: 'text' },
    { name: 'note', type: 'text' },
    { name: 'status', type: 'text', notNull: true, def: `'open'` }, // open | done
    { name: 'done_at', type: 'timestamptz' },
    { name: 'assigned_by', type: 'uuid' },
    ...common,
  ],
};

interface Base {
  id: string;
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  deleted: boolean;
}

export type Role = 'admin' | 'pastor' | 'member';

export interface Zone extends Base {
  name: string;
  color: string;
  polygon: [number, number][];
  pastor_id: string | null;
  notes: string | null;
}

export interface User extends Base {
  name: string;
  phone: string | null;
  role: Role;
  zone_id: string | null;
  active: boolean;
  external_member_id: string | null;
}

export interface House extends Base {
  code: string;
  lat: number;
  lng: number;
  zone_id: string | null;
  name: string | null;
  address: string | null;
  area: string | null;
  description: string | null;
  household_size: number | null;
  is_member_household: boolean;
  do_not_visit: boolean;
  next_visit_on: string | null;
  /** manual = pinned by hand; auto = found from building data */
  source: 'manual' | 'osm' | 'auto';
  osm_id: string | null;
  external_ref: string | null;
}

export interface Person extends Base {
  house_id: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  gender: string | null;
  age_group: string | null;
  is_member: boolean;
  member_since: string | null;
  consent_contact: boolean;
  prayer_requests: string | null;
  notes: string | null;
  external_member_id: string | null;
}

export type VisitKind = 'evangelism' | 'follow_up' | 'member_care' | 'other';

export interface Visit extends Base {
  house_id: string;
  person_id: string | null;
  kind: VisitKind;
  outcome: string | null;
  visited_at: string;
  notes: string | null;
  next_step: string | null;
  visited_by: string | null;
  user_id: string | null;
}

export type TaskAction = 'first_visit' | 'follow_up' | 'member_care' | 'invite' | 'pray' | 'other';

export interface Task extends Base {
  house_id: string;
  assignee_id: string | null;
  action: TaskAction;
  due_on: string | null;
  note: string | null;
  status: 'open' | 'done';
  done_at: string | null;
  assigned_by: string | null;
}

export type Row = House | Person | Visit | Zone | Task | User;

// ---------------------------------------------------------------------------
// Labels (icons are mapped in the app, keyed by `value`)
// ---------------------------------------------------------------------------

export const ROLES: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'pastor', label: 'Zone pastor' },
  { value: 'member', label: 'Team member' },
];

export const VISIT_KINDS: { value: VisitKind; label: string }[] = [
  { value: 'evangelism', label: 'First visit' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'member_care', label: 'Member care' },
  { value: 'other', label: 'Other' },
];

/** `counts` = we actually spoke with someone. */
export const OUTCOMES: { value: string; label: string; counts: boolean }[] = [
  { value: 'prayed', label: 'Prayed', counts: true },
  { value: 'good_chat', label: 'Good talk', counts: true },
  { value: 'invited', label: 'Invited', counts: true },
  { value: 'not_home', label: 'Not home', counts: false },
  { value: 'gave_life', label: 'Gave life to Christ', counts: true },
  { value: 'came_to_church', label: 'Came to church', counts: true },
  { value: 'needs_help', label: 'Needs help', counts: true },
  { value: 'not_interested', label: 'Not interested', counts: true },
];

export const TASK_ACTIONS: { value: TaskAction; label: string }[] = [
  { value: 'first_visit', label: 'First visit' },
  { value: 'follow_up', label: 'Follow up' },
  { value: 'member_care', label: 'Member care' },
  { value: 'invite', label: 'Invite' },
  { value: 'pray', label: 'Pray with' },
  { value: 'other', label: 'Other' },
];

export const AGE_GROUPS = [
  { value: 'child', label: 'Child' },
  { value: 'youth', label: 'Youth' },
  { value: 'adult', label: 'Adult' },
  { value: 'senior', label: 'Senior' },
];

export const ZONE_COLORS = ['#2f7a4f', '#2b6cb0', '#8a5a2b', '#7b4fa0', '#b0476b', '#3c8c8c', '#9a7b1c', '#4d5d53'];

// ---------------------------------------------------------------------------
// House colour (status) rules
// ---------------------------------------------------------------------------

export type Status = 'member' | 'new' | 'due' | 'done' | 'dnv';

export const STATUS_INFO: Record<Status, { label: string; short: string; color: string }> = {
  new: { label: 'Not evangelised', short: 'New', color: '#c8443a' },
  due: { label: 'Follow-up due', short: 'Due', color: '#e07b26' },
  done: { label: 'Checked this week', short: 'Done', color: '#d9a91a' },
  member: { label: 'Members live here', short: 'Members', color: '#1f8a4c' },
  dnv: { label: 'Do not visit', short: 'Skip', color: '#8c958d' },
};

export const STATUS_ORDER: Status[] = ['new', 'due', 'done', 'member', 'dnv'];

/** Monday 00:00 (local) of the week containing `d`. */
export function startOfWeek(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function outcomeCounts(outcome: string | null): boolean {
  if (!outcome) return true;
  return OUTCOMES.find((o) => o.value === outcome)?.counts ?? true;
}

export function lastContact(visits: Visit[]): Visit | undefined {
  let best: Visit | undefined;
  for (const v of visits) {
    if (v.deleted || !outcomeCounts(v.outcome)) continue;
    if (!best || v.visited_at > best.visited_at) best = v;
  }
  return best;
}

export function houseStatus(house: House, people: Person[], visits: Visit[], now = new Date()): Status {
  if (house.do_not_visit) return 'dnv';
  if (house.is_member_household || people.some((p) => !p.deleted && p.is_member)) return 'member';
  const last = lastContact(visits);
  if (!last) return 'new';
  return new Date(last.visited_at) >= startOfWeek(now) ? 'done' : 'due';
}

export function memberCheckDue(visits: Visit[], now = new Date()): boolean {
  const last = lastContact(visits);
  return !last || new Date(last.visited_at) < startOfWeek(now);
}

// ---------------------------------------------------------------------------
// Zones & permissions (used by both the app and the server)
// ---------------------------------------------------------------------------

export function pointInPolygon(lat: number, lng: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function zoneFor(lat: number, lng: number, zones: Zone[]): string | null {
  for (const z of zones) if (!z.deleted && z.polygon.length >= 3 && pointInPolygon(lat, lng, z.polygon)) return z.id;
  return null;
}

/** Zones a user works in. `null` = everything (admin). */
export function userZoneIds(user: Pick<User, 'id' | 'role' | 'zone_id'>, zones: Pick<Zone, 'id' | 'pastor_id' | 'deleted'>[]): string[] | null {
  if (user.role === 'admin') return null;
  const ids = new Set<string>();
  if (user.zone_id) ids.add(user.zone_id);
  if (user.role === 'pastor') for (const z of zones) if (!z.deleted && z.pastor_id === user.id) ids.add(z.id);
  return [...ids];
}
