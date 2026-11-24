/** Export to spreadsheets (CSV) and full backups (JSON). */
import { OUTCOMES, PUSH_TABLES, STATUS_INFO, TABLE_NAMES, TASK_ACTIONS, VISIT_KINDS, lastContact, type House, type Person, type Row, type TableName, type Visit } from '../shared/model';
import type { AppData } from './data';
import { db, saveRows } from './db';

function cell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  // BOM so Excel opens accents correctly
  return '﻿' + [headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join('\r\n');
}

export function download(filename: string, content: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const stamp = () => new Date().toISOString().slice(0, 10);
const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

export function exportHouses(d: AppData) {
  const rows = d.houses.map((h: House) => {
    const people = d.peopleByHouse.get(h.id) ?? [];
    const visits = d.visitsByHouse.get(h.id) ?? [];
    return {
      'House ID': h.code,
      Status: STATUS_INFO[d.statusById.get(h.id)!].label,
      Name: h.name,
      Address: h.address,
      Zone: h.zone_id ? d.zoneById.get(h.zone_id)?.name : '',
      'Assigned to': (d.openTasksByHouse.get(h.id) ?? []).map((t) => d.userById.get(t.assignee_id ?? '')?.name).filter(Boolean).join(', '),
      'People living here': h.household_size,
      'Contacts saved': people.length,
      Members: people.filter((p) => p.is_member).length,
      'Member household': yesNo(h.is_member_household),
      'Do not visit': yesNo(h.do_not_visit),
      'Visits logged': visits.length,
      'Last contact': lastContact(visits)?.visited_at?.slice(0, 10) ?? '',
      'Next visit': h.next_visit_on,
      Description: h.description,
      Latitude: h.lat,
      Longitude: h.lng,
      'Added by': h.source === 'manual' ? 'Manual' : 'Auto (building data)',
      'Record ID': h.id,
    };
  });
  download(`ffim-houses-${stamp()}.csv`, toCsv(rows));
}

export function exportPeople(d: AppData, membersOnly = false) {
  const rows = d.people
    .filter((p: Person) => !membersOnly || p.is_member)
    .map((p) => {
      const h = p.house_id ? d.houseById.get(p.house_id) : undefined;
      return {
        Name: p.full_name,
        Phone: p.phone,
        Email: p.email,
        Member: yesNo(p.is_member),
        'Member since': p.member_since,
        'Age group': p.age_group,
        Gender: p.gender,
        'OK to contact': yesNo(p.consent_contact),
        'Prayer requests': p.prayer_requests,
        Notes: p.notes,
        'House ID': h?.code,
        Address: h?.address,
        Zone: h?.zone_id ? d.zoneById.get(h.zone_id)?.name : '',
        'Member system ID': p.external_member_id,
        'Record ID': p.id,
      };
    });
  download(`ffim-${membersOnly ? 'members' : 'people'}-${stamp()}.csv`, toCsv(rows));
}

export function exportVisits(d: AppData) {
  const personById = new Map(d.people.map((p) => [p.id, p]));
  const rows = [...d.visits]
    .sort((a, b) => b.visited_at.localeCompare(a.visited_at))
    .map((v: Visit) => {
      const h = d.houseById.get(v.house_id);
      return {
        Date: new Date(v.visited_at).toLocaleString(),
        'House ID': h?.code,
        Address: h?.address,
        Zone: h?.zone_id ? d.zoneById.get(h.zone_id)?.name : '',
        Type: VISIT_KINDS.find((k) => k.value === v.kind)?.label ?? v.kind,
        Outcome: OUTCOMES.find((o) => o.value === v.outcome)?.label ?? v.outcome,
        'Spoke with': v.person_id ? personById.get(v.person_id)?.full_name : '',
        Notes: v.notes,
        'Next step': v.next_step,
        'Visited by': v.visited_by,
        'Record ID': v.id,
      };
    });
  download(`ffim-visits-${stamp()}.csv`, toCsv(rows));
}

export function exportTasks(d: AppData) {
  const rows = d.tasks.map((t) => {
    const h = d.houseById.get(t.house_id);
    return {
      'House ID': h?.code,
      Address: h?.address,
      Zone: h?.zone_id ? d.zoneById.get(h.zone_id)?.name : '',
      Task: TASK_ACTIONS.find((a) => a.value === t.action)?.label ?? t.action,
      'Assigned to': t.assignee_id ? d.userById.get(t.assignee_id)?.name : '',
      Due: t.due_on,
      Status: t.status === 'done' ? 'Done' : 'Open',
      'Done on': t.done_at?.slice(0, 10) ?? '',
      Note: t.note,
      'Record ID': t.id,
    };
  });
  download(`ffim-tasks-${stamp()}.csv`, toCsv(rows));
}

export async function exportBackup() {
  const out: Record<string, unknown> = { app: 'FFIM Gather', version: 1, exported_at: new Date().toISOString() };
  for (const t of TABLE_NAMES) out[t] = await (db[t] as unknown as { toArray(): Promise<Row[]> }).toArray();
  download(`ffim-backup-${stamp()}.json`, JSON.stringify(out, null, 1), 'application/json');
}

export async function importBackup(file: File): Promise<number> {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'FFIM Gather') throw new Error('This is not an FFIM Gather backup file.');
  let n = 0;
  for (const t of PUSH_TABLES as TableName[]) {
    const rows = (data[t] ?? []) as Row[];
    const table = db[t] as unknown as { bulkGet(ids: string[]): Promise<(Row | undefined)[]> };
    const existing = await table.bulkGet(rows.map((r) => r.id));
    // Only bring in records that are newer than what this phone has.
    const newer = rows.filter((r, i) => !existing[i] || existing[i]!.updated_at < r.updated_at);
    await saveRows(t, newer);
    n += newer.length;
  }
  return n;
}
