/**
 * The assistant's brain on the phone.
 *
 * The AI model (on the server) decides what to do; the actions run here on the phone,
 * with the user's own permissions and offline-first saving. Anything that changes data
 * is shown to the user first and only happens after they tap Confirm.
 */
import {
  OUTCOMES, ROLES, STATUS_INFO, TASK_ACTIONS, VISIT_KINDS, lastContact, zoneFor,
  type House, type TaskAction, type VisitKind,
} from '../shared/model';
import { getChurch } from './branding';
import { routeToChurch } from './churchDistance';
import type { AppData } from './data';
import { blankPerson, blankTask, blankVisit, completeMyTasks, db, newHouse, save, saveRows, setMember } from './db';
import { searchPlaces } from './geocode';
import { api } from './session';
import { distanceM, endOfWeekStr, todayStr } from './util';

// ---------------------------------------------------------------------------
// Conversation store (survives switching tabs)
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface PendingConfirm {
  callId: string;
  title: string;
  lines: string[];
}

export interface ChatState {
  messages: ChatMessage[];
  busy: boolean;
  pending: PendingConfirm[];
  error: string | null;
}

let state: ChatState = { messages: [], busy: false, pending: [], error: null };
const subs = new Set<() => void>();
export const getChat = () => state;
export function subscribeChat(fn: () => void) {
  subs.add(fn);
  return () => void subs.delete(fn);
}
function set(p: Partial<ChatState>) {
  state = { ...state, ...p };
  subs.forEach((f) => f());
}
export function resetChat() {
  set({ messages: [], busy: false, pending: [], error: null });
  waiting.clear();
}

// ---------------------------------------------------------------------------
// Tools the model may use
// ---------------------------------------------------------------------------

const outcomeValues = OUTCOMES.map((o) => o.value);
const kindValues = VISIT_KINDS.map((k) => k.value);
const actionValues = TASK_ACTIONS.map((a) => a.value);

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'function' as const,
  function: { name, description, parameters: { type: 'object', properties, required } },
});

const WRITE_TOOLS = new Set(['log_visit', 'add_person', 'add_house', 'assign_houses', 'update_house', 'set_member']);

export function toolDefs(d: AppData) {
  const tools = [
    fn('find_houses', 'Search the houses and people on the map by name, house ID (like H-7KQ2M), phone or address.', { query: { type: 'string' } }, ['query']),
    fn('house_details', 'Full details of one house: people, visits, tasks, status.', { code: { type: 'string', description: 'House ID like H-7KQ2M' } }, ['code']),
    fn('list_houses', 'List houses that need attention, nearest first when the user location is known.', {
      filter: { type: 'string', enum: ['due', 'new', 'members_due', 'scheduled', 'done_this_week'] },
      zone: { type: 'string', description: 'Zone name (optional)' },
      limit: { type: 'number' },
    }, ['filter']),
    fn('my_tasks', 'The houses assigned to the current user.'),
    fn('overview', 'Counts by status and zone, and visits this week.'),
    fn('distance_to_church', 'Road distance and walking time from a house to the church (A* over OpenStreetMap roads).', { code: { type: 'string' } }, ['code']),
    fn('find_place', 'Look up a place, area or landmark (OpenStreetMap). Returns names and coordinates.', { query: { type: 'string' } }, ['query']),
    fn('show_on_map', 'Open the map at a house or a place for the user.', { code: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } }),
    fn('log_visit', 'Record a visit to a house. The user will be asked to confirm.', {
      code: { type: 'string' },
      outcome: { type: 'string', enum: outcomeValues },
      kind: { type: 'string', enum: kindValues },
      notes: { type: 'string' },
      person_name: { type: 'string', description: 'Who they spoke with (new or existing person)' },
      person_phone: { type: 'string' },
      next_visit_in_days: { type: 'number' },
    }, ['code', 'outcome']),
    fn('add_person', 'Add a person living at a house. The user will be asked to confirm.', {
      code: { type: 'string' },
      full_name: { type: 'string' },
      phone: { type: 'string' },
      is_member: { type: 'boolean' },
      prayer_requests: { type: 'string' },
    }, ['code', 'full_name']),
    fn('set_member', 'Make a person a church member (their house turns green and joins weekly member check-ups), or turn a member back into a contact. The user will be asked to confirm.', {
      person_name: { type: 'string' },
      code: { type: 'string', description: 'House ID, if known, to tell people with the same name apart' },
      is_member: { type: 'boolean' },
    }, ['person_name', 'is_member']),
    fn('add_house', 'Put a new house on the map at coordinates (use find_place first if needed). The user will be asked to confirm.', {
      lat: { type: 'number' },
      lng: { type: 'number' },
      name: { type: 'string' },
      address: { type: 'string' },
    }, ['lat', 'lng']),
    fn('update_house', 'Change details of a house. The user will be asked to confirm.', {
      code: { type: 'string' },
      name: { type: 'string' },
      address: { type: 'string' },
      household_size: { type: 'number' },
      is_member_household: { type: 'boolean' },
      do_not_visit: { type: 'boolean' },
      vacant: { type: 'boolean', description: 'Nobody lives there (empty or unfinished building)' },
      next_visit_on: { type: 'string', description: 'YYYY-MM-DD' },
      notes: { type: 'string' },
    }, ['code']),
  ];
  if (d.perms.assign) {
    tools.push(
      fn('list_team', 'Team members the user can assign work to, with their open task counts.'),
      fn('assign_houses', 'Assign houses to a team member. The user will be asked to confirm.', {
        codes: { type: 'array', items: { type: 'string' } },
        person_name: { type: 'string' },
        action: { type: 'string', enum: actionValues },
        due: { type: 'string', enum: ['today', 'tomorrow', 'this_week', 'next_week', 'anytime'] },
        note: { type: 'string' },
      }, ['codes', 'person_name', 'action']),
    );
  }
  return tools;
}

export function systemPrompt(d: AppData, me: { lat: number; lng: number } | null): string {
  const role = ROLES.find((r) => r.value === d.me.role)?.label;
  const zones = d.zones.filter((z) => d.myZoneIds === null || d.myZoneIds.includes(z.id)).map((z) => z.name);
  const church = getChurch();
  return [
    `You are Gather, the assistant inside FFIM Gather, an app a church in Ghana uses to visit homes in its neighbourhood, follow up with people and care for members.`,
    `Today is ${new Date().toDateString()}. You are helping ${d.me.name} (${role}). ${zones.length ? `They work in: ${zones.join(', ')}.` : d.perms.isAdmin ? 'They can see all zones.' : 'They have no zone yet.'}`,
    `${church ? `The church is "${church.name}".` : 'The church location is not set yet (an admin can set it under Manage).'}${me ? ' The user’s current location is known, so lists are nearest first.' : ''}`,
    `House colours: red = not evangelised yet, orange = follow-up due (no contact this week), yellow = checked this week, green = members live there, grey = do not visit. Weeks start on Monday.`,
    `Rules:`,
    `- Keep replies short and plain, like a helpful friend on WhatsApp. Use the user's language.`,
    `- Use the tools to look things up. Never invent house IDs, names, numbers or distances.`,
    `- Before changing anything, make sure you have what you need. If something is missing or unclear (which house, what happened), ask ONE short question at a time.`,
    `- When a house is described by name or person rather than ID, search first, and if several match, ask which one.`,
    `- Changes (log_visit, add_person, add_house, update_house, assign_houses) are shown to the user to confirm. If they cancel, ask what to change.`,
    `- After a change is confirmed, say what was done in one sentence.`,
    `- People can be on the members list without a house. When adding a person to a house, check the members list first (find_houses also returns members_without_house) so you don't create duplicates.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Running the tools
// ---------------------------------------------------------------------------

const label = (list: { value: string; label: string }[], v: string | null | undefined) => list.find((x) => x.value === v)?.label ?? v ?? '';

function houseByCode(d: AppData, code: unknown): House {
  const c = String(code ?? '').trim().toUpperCase().replace(/^H(?=[0-9A-Z]{5}$)/, 'H-');
  const h = d.houses.find((x) => x.code.toUpperCase() === c);
  if (!h) throw new Error(`No house with ID ${code}. Use find_houses to look it up.`);
  return h;
}

function houseSummary(d: AppData, h: House) {
  const people = d.peopleByHouse.get(h.id) ?? [];
  const tasks = d.openTasksByHouse.get(h.id) ?? [];
  return {
    code: h.code,
    name: h.name,
    address: h.address,
    zone: h.zone_id ? d.zoneById.get(h.zone_id)?.name : null,
    status: STATUS_INFO[d.statusById.get(h.id)!].label,
    people: people.map((p) => `${p.full_name}${p.is_member ? ' (member)' : ''}${p.phone ? ` ${p.phone}` : ''}`),
    last_contact: d.lastContactById.get(h.id)?.slice(0, 10) ?? 'never',
    next_visit_on: h.next_visit_on,
    assigned: tasks.map((t) => `${label(TASK_ACTIONS, t.action)} by ${d.userById.get(t.assignee_id ?? '')?.name ?? '?'}${t.due_on ? ` due ${t.due_on}` : ''}`),
  };
}

function findUser(d: AppData, name: string) {
  const n = name.trim().toLowerCase();
  if (['me', 'myself', 'i'].includes(n)) return d.me;
  const matches = d.users.filter((u) => u.active && u.name.toLowerCase().includes(n));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error(`No team member called ${name}.`);
  throw new Error(`Several people match "${name}": ${matches.map((m) => m.name).join(', ')}. Ask which one.`);
}

function dueDate(v: unknown): string | null {
  return v === 'today' ? todayStr() : v === 'tomorrow' ? todayStr(1) : v === 'this_week' ? endOfWeekStr() : v === 'next_week' ? todayStr(7) : null;
}

type Args = Record<string, unknown>;
interface Ctx {
  d: AppData;
  me: { lat: number; lng: number } | null;
  showHouse: (id: string) => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
}

/** Read-only tools: run straight away. */
async function runRead(name: string, a: Args, { d, me, showHouse, flyTo }: Ctx): Promise<unknown> {
  const near = (hs: House[]) => (me ? [...hs].sort((x, y) => distanceM(me, x) - distanceM(me, y)) : hs);
  switch (name) {
    case 'find_houses': {
      const q = String(a.query ?? '').toLowerCase().trim();
      const hits = d.houses.filter((h) =>
        [h.code, h.name, h.address, ...(d.peopleByHouse.get(h.id) ?? []).flatMap((p) => [p.full_name, p.phone])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
      const listed = d.people.filter((p) => !p.house_id && [p.full_name, p.phone].join(' ').toLowerCase().includes(q));
      return {
        count: hits.length,
        houses: near(hits).slice(0, 8).map((h) => houseSummary(d, h)),
        ...(listed.length ? { members_without_house: listed.slice(0, 8).map((p) => ({ name: p.full_name, phone: p.phone })) } : {}),
      };
    }
    case 'house_details': {
      const h = houseByCode(d, a.code);
      const visits = (d.visitsByHouse.get(h.id) ?? []).slice(0, 6).map((v) => ({
        date: v.visited_at.slice(0, 10),
        kind: label(VISIT_KINDS, v.kind),
        outcome: label(OUTCOMES, v.outcome),
        by: v.visited_by,
        notes: v.notes,
      }));
      return { ...houseSummary(d, h), household_size: h.household_size, notes: h.description, recent_visits: visits };
    }
    case 'list_houses': {
      const zone = a.zone ? d.zones.find((z) => z.name.toLowerCase().includes(String(a.zone).toLowerCase())) : undefined;
      let list: House[] =
        a.filter === 'due' ? d.alerts.followUpsDue
        : a.filter === 'members_due' ? d.alerts.membersDue
        : a.filter === 'scheduled' ? d.alerts.scheduledDue
        : d.houses.filter((h) => d.statusById.get(h.id) === (a.filter === 'new' ? 'new' : 'done'));
      if (zone) list = list.filter((h) => h.zone_id === zone.id);
      const limit = Math.min(Number(a.limit) || 10, 25);
      return { total: list.length, houses: near(list).slice(0, limit).map((h) => houseSummary(d, h)) };
    }
    case 'my_tasks':
      return {
        tasks: d.myTasks.slice(0, 25).map((t) => {
          const h = d.houseById.get(t.house_id)!;
          return { ...houseSummary(d, h), task: label(TASK_ACTIONS, t.action), due: t.due_on, note: t.note };
        }),
      };
    case 'overview': {
      const by: Record<string, number> = {};
      for (const st of d.statusById.values()) by[STATUS_INFO[st].label] = (by[STATUS_INFO[st].label] ?? 0) + 1;
      const week = Date.now() - ((new Date().getDay() + 6) % 7) * 864e5;
      return {
        houses: d.houses.length,
        by_status: by,
        people: d.people.length,
        members: d.people.filter((p) => p.is_member).length,
        visits_this_week: d.visits.filter((v) => new Date(v.visited_at).getTime() >= week - 864e5).length,
        zones: d.zones.map((z) => ({ zone: z.name, houses: d.houses.filter((h) => h.zone_id === z.id).length, pastor: d.userById.get(z.pastor_id ?? '')?.name })),
        my_open_tasks: d.myTasks.length,
      };
    }
    case 'distance_to_church': {
      const h = houseByCode(d, a.code);
      const p = routeToChurch(h);
      if (!p) return { error: 'The church location is not set yet. An admin can set it under Manage.' };
      const r = await p;
      if (!r) return { error: 'No road route found. Straight-line distance: ' + Math.round(distanceM(h, getChurch()!)) + ' m' };
      return { road_km: +(r.meters / 1000).toFixed(2), walking_minutes: r.minutes, driving_minutes_estimate: r.driveMinutes, straight_line_km: +(r.straight / 1000).toFixed(2) };
    }
    case 'find_place': {
      const places = await searchPlaces(String(a.query ?? ''), me ?? { lat: 5.6037, lng: -0.187 });
      return { places: places.slice(0, 5).map((p) => ({ name: p.name, area: p.detail, lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6), type: p.kind })) };
    }
    case 'show_on_map': {
      if (a.code) {
        const h = houseByCode(d, a.code);
        showHouse(h.id);
        return { shown: h.code };
      }
      if (typeof a.lat === 'number' && typeof a.lng === 'number') {
        flyTo(a.lat, a.lng, 17);
        return { shown: true };
      }
      return { error: 'Give a house code or coordinates' };
    }
    case 'list_team': {
      return {
        team: d.users
          .filter((u) => u.active)
          .map((u) => ({
            name: u.name,
            role: label(ROLES, u.role),
            zone: u.zone_id ? d.zoneById.get(u.zone_id)?.name : null,
            open_tasks: d.tasks.filter((t) => t.status === 'open' && t.assignee_id === u.id).length,
          })),
      };
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

/** Changes: check everything first and describe them for the confirm card. Returns the action to run. */
function prepareWrite(name: string, a: Args, { d }: Ctx): { title: string; lines: string[]; run: () => Promise<unknown> } {
  switch (name) {
    case 'log_visit': {
      const h = houseByCode(d, a.code);
      if (!outcomeValues.includes(String(a.outcome))) throw new Error('Unknown outcome');
      const kind = (kindValues.includes(String(a.kind) as VisitKind) ? a.kind : undefined) as VisitKind | undefined;
      const status = d.statusById.get(h.id);
      const k: VisitKind = kind ?? (status === 'member' ? 'member_care' : status === 'new' ? 'evangelism' : 'follow_up');
      const people = d.peopleByHouse.get(h.id) ?? [];
      const pname = a.person_name ? String(a.person_name).trim() : '';
      const existing = pname ? people.find((p) => p.full_name.toLowerCase() === pname.toLowerCase()) : undefined;
      const days = Number(a.next_visit_in_days) || 0;
      return {
        title: `Log visit at ${h.code}`,
        lines: [
          `${label(VISIT_KINDS, k)}: ${label(OUTCOMES, String(a.outcome))}`,
          ...(pname ? [`Spoke with ${pname}${existing ? '' : ' (new person' + (a.person_phone ? `, ${a.person_phone}` : '') + ')'}`] : []),
          ...(a.notes ? [`Notes: ${a.notes}`] : []),
          ...(days ? [`Next visit in ${days} days`] : []),
        ],
        run: async () => {
          let person_id = existing?.id ?? null;
          if (pname && !existing) {
            const p = { ...blankPerson(h.id), full_name: pname, phone: a.person_phone ? String(a.person_phone) : null };
            await save('people', p);
            person_id = p.id;
          }
          await save('visits', { ...blankVisit(h.id), kind: k, outcome: String(a.outcome), notes: a.notes ? String(a.notes) : null, person_id });
          await completeMyTasks(h.id);
          if (days) {
            const fresh = await db.houses.get(h.id);
            if (fresh) await save('houses', { ...fresh, next_visit_on: todayStr(days) });
          }
          return { ok: true, house: h.code };
        },
      };
    }
    case 'add_person': {
      const h = houseByCode(d, a.code);
      const name = String(a.full_name ?? '').trim();
      if (!name) throw new Error('Name is required');
      // Someone already on the members list without a house: link them instead of adding a duplicate
      const listed = d.people.find((p) => !p.house_id && p.full_name.toLowerCase() === name.toLowerCase());
      if (listed) {
        return {
          title: `Add ${listed.full_name} (from the members list) to ${h.code}`,
          lines: [listed.full_name, ...(listed.phone ? [listed.phone] : []), 'Church member'],
          run: async () => {
            await save('people', { ...listed, house_id: h.id });
            return { ok: true, linked_existing_member: true };
          },
        };
      }
      return {
        title: `Add person to ${h.code}`,
        lines: [name, ...(a.phone ? [String(a.phone)] : []), ...(a.is_member ? ['Church member'] : []), ...(a.prayer_requests ? [`Prayer: ${a.prayer_requests}`] : [])],
        run: async () => {
          await save('people', {
            ...blankPerson(h.id),
            full_name: name,
            phone: a.phone ? String(a.phone) : null,
            is_member: Boolean(a.is_member),
            member_since: a.is_member ? todayStr() : null,
            prayer_requests: a.prayer_requests ? String(a.prayer_requests) : null,
          });
          return { ok: true };
        },
      };
    }
    case 'set_member': {
      const q = String(a.person_name ?? '').trim().toLowerCase();
      const inHouse = a.code ? houseByCode(d, a.code) : undefined;
      const matches = d.people.filter((p) => p.full_name.toLowerCase().includes(q) && (!inHouse || p.house_id === inHouse.id));
      if (!matches.length) throw new Error(`No person called ${a.person_name}. Search first.`);
      if (matches.length > 1) throw new Error(`Several people match: ${matches.map((m) => `${m.full_name} (${m.house_id ? d.houseById.get(m.house_id)?.code : 'no house'})`).join(', ')}. Ask which one.`);
      const p = matches[0];
      const to = Boolean(a.is_member);
      return {
        title: to ? `Make ${p.full_name} a member` : `Mark ${p.full_name} as not a member`,
        lines: [p.house_id ? `Lives at ${d.houseById.get(p.house_id)?.code}` : 'No house on the map yet', ...(to ? ['Their house turns green and joins the weekly member check-ups'] : [])],
        run: async () => {
          await setMember(p, to);
          return { ok: true };
        },
      };
    }
    case 'add_house': {
      const lat = Number(a.lat), lng = Number(a.lng);
      if (!isFinite(lat) || !isFinite(lng)) throw new Error('Coordinates are needed');
      if (!d.perms.canPlace(lat, lng)) throw new Error('That spot is outside the user’s zone');
      const zone = zoneFor(lat, lng, d.zones);
      return {
        title: 'Add a house',
        lines: [
          [a.name, a.address].filter(Boolean).join(', ') || `At ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          ...(zone ? [`Zone: ${d.zoneById.get(zone)?.name}`] : []),
        ],
        run: async () => {
          const h = await newHouse(lat, lng, { name: a.name ? String(a.name) : null, address: a.address ? String(a.address) : null });
          return { ok: true, code: h.code };
        },
      };
    }
    case 'update_house': {
      const h = houseByCode(d, a.code);
      const patch: Partial<House> = {};
      const lines: string[] = [];
      if (a.name !== undefined) (patch.name = String(a.name) || null), lines.push(`Name: ${a.name}`);
      if (a.address !== undefined) (patch.address = String(a.address) || null), lines.push(`Address: ${a.address}`);
      if (a.household_size !== undefined) (patch.household_size = Number(a.household_size)), lines.push(`People living here: ${a.household_size}`);
      if (a.is_member_household !== undefined) (patch.is_member_household = Boolean(a.is_member_household)), lines.push(`Member household: ${a.is_member_household ? 'yes' : 'no'}`);
      if (a.do_not_visit !== undefined) (patch.do_not_visit = Boolean(a.do_not_visit)), lines.push(`Do not visit: ${a.do_not_visit ? 'yes' : 'no'}`);
      if (a.vacant !== undefined) (patch.vacant = Boolean(a.vacant)), lines.push(`Empty house: ${a.vacant ? 'yes' : 'no'}`);
      if (a.next_visit_on !== undefined) (patch.next_visit_on = String(a.next_visit_on) || null), lines.push(`Next visit: ${a.next_visit_on}`);
      if (a.notes !== undefined) (patch.description = String(a.notes) || null), lines.push(`Notes: ${a.notes}`);
      if (!lines.length) throw new Error('Nothing to change');
      return {
        title: `Update ${h.code}`,
        lines,
        run: async () => {
          const fresh = (await db.houses.get(h.id)) ?? h;
          await save('houses', { ...fresh, ...patch });
          return { ok: true };
        },
      };
    }
    case 'assign_houses': {
      if (!d.perms.assign) throw new Error('Only admins and zone pastors can assign houses');
      const codes = (Array.isArray(a.codes) ? a.codes : [a.codes]).map((c) => houseByCode(d, c));
      const u = findUser(d, String(a.person_name ?? ''));
      const action = (actionValues.includes(String(a.action) as TaskAction) ? a.action : 'follow_up') as TaskAction;
      const due = dueDate(a.due);
      return {
        title: `Assign ${codes.length} ${codes.length === 1 ? 'house' : 'houses'} to ${u.name}`,
        lines: [`${label(TASK_ACTIONS, action)}${due ? `, due ${due}` : ''}`, codes.map((h) => h.code).slice(0, 12).join(', ') + (codes.length > 12 ? '…' : ''), ...(a.note ? [`Note: ${a.note}`] : [])],
        run: async () => {
          const rows = codes.map((h) => {
            const open = d.openTasksByHouse.get(h.id)?.[0];
            const fields = { assignee_id: u.id, action, due_on: due, note: a.note ? String(a.note) : null, assigned_by: d.me.id };
            return open ? { ...open, ...fields } : blankTask(h.id, fields);
          });
          await saveRows('tasks', rows);
          return { ok: true, assigned: rows.length };
        },
      };
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

// ---------------------------------------------------------------------------
// The conversation loop
// ---------------------------------------------------------------------------

const waiting = new Map<string, { run: () => Promise<unknown> }>();
let ctxRef: Ctx | null = null;

function parseArgs(s: string): Args {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

function toolResult(id: string, value: unknown): ChatMessage {
  return { role: 'tool', tool_call_id: id, content: JSON.stringify(value).slice(0, 6000) };
}

async function step(ctx: Ctx) {
  ctxRef = ctx;
  for (let round = 0; round < 6; round++) {
    const convo: ChatMessage[] = [{ role: 'system', content: systemPrompt(ctx.d, ctx.me) }, ...state.messages.slice(-30)];
    // A trimmed history must not start with a tool reply
    while (convo.length > 1 && convo[1].role === 'tool') convo.splice(1, 1);
    const { message } = await api<{ message: ChatMessage & { role: 'assistant' } }>('assistant', { messages: convo, tools: toolDefs(ctx.d) });
    set({ messages: [...state.messages, message] });
    const calls = message.tool_calls ?? [];
    if (!calls.length) return;

    const results: ChatMessage[] = [];
    const pending: PendingConfirm[] = [];
    for (const c of calls) {
      const args = parseArgs(c.function.arguments);
      try {
        if (WRITE_TOOLS.has(c.function.name)) {
          const w = prepareWrite(c.function.name, args, ctx);
          waiting.set(c.id, { run: w.run });
          pending.push({ callId: c.id, title: w.title, lines: w.lines });
        } else {
          results.push(toolResult(c.id, await runRead(c.function.name, args, ctx)));
        }
      } catch (e) {
        results.push(toolResult(c.id, { error: (e as Error).message }));
      }
    }
    set({ messages: [...state.messages, ...results] });
    if (pending.length) {
      set({ pending }); // wait for the user to confirm or cancel
      return;
    }
  }
}

async function guarded(fnc: () => Promise<void>) {
  set({ busy: true, error: null });
  try {
    await fnc();
  } catch (e) {
    set({ error: (e as Error).message });
  } finally {
    set({ busy: false });
  }
}

export function sendMessage(text: string, ctx: Ctx) {
  const t = text.trim();
  if (!t || state.busy) return;
  // Unanswered confirmations count as cancelled when the user moves on
  const cancelled = state.pending.map((p) => toolResult(p.callId, { cancelled: true, reason: 'User sent a new message instead' }));
  waiting.clear();
  set({ messages: [...state.messages, ...cancelled, { role: 'user', content: t }], pending: [] });
  return guarded(() => step(ctx));
}

export function answerConfirm(callId: string, ok: boolean, ctx: Ctx) {
  const w = waiting.get(callId);
  waiting.delete(callId);
  return guarded(async () => {
    let result: unknown;
    if (!ok) result = { cancelled: true, reason: 'User cancelled' };
    else {
      try {
        result = await w!.run();
      } catch (e) {
        result = { error: (e as Error).message };
      }
    }
    const rest = state.pending.filter((p) => p.callId !== callId);
    set({ messages: [...state.messages, toolResult(callId, result)], pending: rest });
    if (!rest.length) await step(ctxRef ?? ctx);
  });
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export interface AiStatus {
  chat: boolean;
  voice: boolean;
  providers: string[];
}
let status: Promise<AiStatus> | null = null;
export function aiStatus(): Promise<AiStatus> {
  status ??= api<AiStatus>('assistant-status').catch(() => {
    status = null;
    return { chat: false, voice: false, providers: [] };
  });
  return status;
}

export async function transcribe(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const r = await api<{ text: string }>('transcribe', { audio: btoa(bin), mime: blob.type });
  return r.text;
}

/** Read a reply aloud with the phone's built-in voice (free, works offline on most phones). */
export function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const clean = text.replace(/[*_`#>]/g, '').replace(/\bH-([0-9A-Z]{5})\b/g, (_, c) => `house ${c.split('').join(' ')}`);
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'en-GB';
  window.speechSynthesis.speak(u);
}

export { lastContact };
