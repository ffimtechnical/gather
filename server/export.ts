/**
 * Read-only data feed for other systems (member management, dashboards,
 * spreadsheets). Admins see everything; zone pastors see their zones. Example:
 *   GET /api/export?table=people&format=csv     (header Authorization: Bearer <token>)
 *   GET /api/export?table=house_overview&format=json
 */
import { TABLES, userZoneIds, type TableName, type User } from '../shared/model.js';
import type { Query } from './db.js';
import { ensureSchema } from './schema.js';
import { normalize, type ApiResult } from './sync.js';

const ALLOWED = ['houses', 'people', 'visits', 'tasks', 'zones', 'users', 'house_overview'] as const;

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function handleExport(params: URLSearchParams, me: User, q: Query): Promise<ApiResult> {
  await ensureSchema(q);
  if (me.role === 'member') return { status: 403, body: { error: 'Only admins and zone pastors can export' } };
  const scope = userZoneIds(me, (await q(`SELECT id, pastor_id, deleted FROM zones`)) as never);
  const table = params.get('table') ?? 'houses';
  const format = params.get('format') ?? 'json';
  const includeDeleted = params.get('include_deleted') === '1';
  if (!(ALLOWED as readonly string[]).includes(table)) {
    return { status: 400, body: { error: `table must be one of ${ALLOWED.join(', ')}` } };
  }
  let rows: Record<string, unknown>[];
  if (table === 'house_overview') {
    rows = scope === null
      ? await q(`SELECT * FROM house_overview ORDER BY code`)
      : await q(`SELECT * FROM house_overview WHERE zone_id = ANY($1::uuid[]) ORDER BY code`, [scope]);
  } else {
    const t = table as TableName;
    const cols = TABLES[t].map((c) => c.name).join(', ');
    const conds = [includeDeleted ? 'true' : 'NOT deleted'];
    const params: unknown[] = [];
    if (scope !== null) {
      params.push(scope);
      if (t === 'houses') conds.push('zone_id = ANY($1::uuid[])');
      else if (t === 'users') conds.push('(zone_id = ANY($1::uuid[]) OR id IN (SELECT pastor_id FROM zones WHERE id = ANY($1::uuid[])))');
      else if (t !== 'zones') conds.push('house_id IN (SELECT id FROM houses WHERE zone_id = ANY($1::uuid[]))');
      else params.pop();
    }
    rows = (await q(`SELECT ${cols} FROM ${t} WHERE ${conds.join(' AND ')} ORDER BY created_at`, params)).map((r) =>
      normalize(t, r),
    );
  }
  if (format === 'csv') {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(','))].join('\n');
    return {
      status: 200,
      body: csv,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="ffim-${table}.csv"`,
      },
    };
  }
  return { status: 200, body: { table, count: rows.length, rows } };
}
