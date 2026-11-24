import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import {
  houseStatus, lastContact, memberCheckDue, pointInPolygon, userZoneIds,
  type House, type Person, type Status, type Task, type User, type Visit, type Zone,
} from '../shared/model';
import { db } from './db';
import { todayStr } from './util';

export interface Perms {
  isAdmin: boolean;
  isLead: boolean; // admin or zone pastor
  manageZones: boolean;
  assign: boolean;
  deleteHouses: boolean;
  export: boolean;
  manageTeam: boolean;
  /** Can a house be placed here? */
  canPlace: (lat: number, lng: number) => boolean;
}

export interface AppData {
  ready: boolean;
  me: User;
  perms: Perms;
  myZoneIds: string[] | null; // null = all
  houses: House[];
  people: Person[];
  visits: Visit[];
  zones: Zone[];
  users: User[];
  tasks: Task[];
  houseById: Map<string, House>;
  userById: Map<string, User>;
  zoneById: Map<string, Zone>;
  peopleByHouse: Map<string, Person[]>;
  visitsByHouse: Map<string, Visit[]>;
  openTasksByHouse: Map<string, Task[]>;
  statusById: Map<string, Status>;
  lastContactById: Map<string, string | undefined>;
  myTasks: Task[];
  alerts: { followUpsDue: House[]; scheduledDue: House[]; membersDue: House[]; total: number };
}

function group<T extends { house_id: string | null }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.house_id) continue;
    const arr = m.get(r.house_id);
    if (arr) arr.push(r);
    else m.set(r.house_id, [r]);
  }
  return m;
}

function useClock(ms = 5 * 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useAppData(sessionUser: User): AppData {
  const houses = useLiveQuery(() => db.houses.filter((h) => !h.deleted).toArray(), []);
  const people = useLiveQuery(() => db.people.filter((p) => !p.deleted).toArray(), []);
  const visits = useLiveQuery(() => db.visits.filter((v) => !v.deleted).toArray(), []);
  const zones = useLiveQuery(() => db.zones.filter((z) => !z.deleted).toArray(), []);
  const users = useLiveQuery(() => db.users.filter((u) => !u.deleted).toArray(), []);
  const tasks = useLiveQuery(() => db.tasks.filter((t) => !t.deleted).toArray(), []);
  const now = useClock();

  return useMemo(() => {
    const Z = zones ?? [], U = users ?? [], T = tasks ?? [];
    const me = U.find((u) => u.id === sessionUser.id) ?? sessionUser;
    const myZoneIds = userZoneIds(me, Z);
    const isAdmin = me.role === 'admin';
    const isLead = isAdmin || me.role === 'pastor';
    const myZones = myZoneIds === null ? null : Z.filter((z) => myZoneIds.includes(z.id));
    const perms: Perms = {
      isAdmin,
      isLead,
      manageZones: isAdmin,
      assign: isLead,
      deleteHouses: isLead,
      export: isLead,
      manageTeam: isLead,
      canPlace: (lat, lng) => myZones === null || myZones.some((z) => pointInPolygon(lat, lng, z.polygon)),
    };

    // Only houses in my zones (the server already limits this; admins see all)
    const H = (houses ?? []).filter((h) => myZoneIds === null || (h.zone_id && myZoneIds.includes(h.zone_id)));
    const P = people ?? [], V = visits ?? [];
    const houseById = new Map(H.map((h) => [h.id, h]));
    const peopleByHouse = group(P);
    const visitsByHouse = group(V);
    for (const arr of visitsByHouse.values()) arr.sort((a, b) => b.visited_at.localeCompare(a.visited_at));
    const open = T.filter((t) => t.status === 'open' && houseById.has(t.house_id));
    const openTasksByHouse = group(open);
    const statusById = new Map<string, Status>();
    const lastContactById = new Map<string, string | undefined>();
    const today = todayStr();
    const followUpsDue: House[] = [], scheduledDue: House[] = [], membersDue: House[] = [];

    for (const h of H) {
      const hv = visitsByHouse.get(h.id) ?? [];
      const st = houseStatus(h, peopleByHouse.get(h.id) ?? [], hv, now);
      statusById.set(h.id, st);
      const lc = lastContact(hv)?.visited_at;
      lastContactById.set(h.id, lc);
      if (st === 'due') followUpsDue.push(h);
      if (st === 'member' && memberCheckDue(hv, now)) membersDue.push(h);
      if (h.next_visit_on && h.next_visit_on <= today && st !== 'dnv' && (!lc || lc.slice(0, 10) < h.next_visit_on)) scheduledDue.push(h);
    }
    const myTasks = open
      .filter((t) => t.assignee_id === me.id)
      .sort((a, b) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999'));

    return {
      ready: [houses, people, visits, zones, users, tasks].every((x) => x !== undefined),
      me,
      perms,
      myZoneIds,
      houses: H,
      // people in visible houses, plus members on the list whose house isn't mapped yet
      people: P.filter((p) => (p.house_id ? houseById.has(p.house_id) : p.is_member)),
      visits: V.filter((v) => houseById.has(v.house_id)),
      zones: Z,
      users: U,
      tasks: T.filter((t) => houseById.has(t.house_id)),
      houseById,
      userById: new Map(U.map((u) => [u.id, u])),
      zoneById: new Map(Z.map((z) => [z.id, z])),
      peopleByHouse,
      visitsByHouse,
      openTasksByHouse,
      statusById,
      lastContactById,
      myTasks,
      alerts: {
        followUpsDue,
        scheduledDue,
        membersDue,
        total: isLead ? new Set([...followUpsDue, ...scheduledDue].map((h) => h.id)).size : myTasks.length,
      },
    };
  }, [houses, people, visits, zones, users, tasks, now, sessionUser]);
}
