import { TABLES, TABLE_NAMES, type ColSpec, type ColType } from '../shared/model.js';
import type { Query } from './db.js';

const PG_TYPE: Record<ColType, string> = {
  uuid: 'uuid',
  text: 'text',
  int: 'integer',
  float: 'double precision',
  bool: 'boolean',
  timestamptz: 'timestamptz',
  jsonb: 'jsonb',
};

function colDdl(c: ColSpec): string {
  let s = `${c.name} ${PG_TYPE[c.type]}`;
  if (c.name === 'id') s += ' PRIMARY KEY';
  else {
    if (c.notNull) s += ' NOT NULL';
    if (c.def) s += ` DEFAULT ${c.def}`;
  }
  return s;
}

/** All SQL statements that create the database. Safe to run many times. */
export function schemaStatements(): string[] {
  const out: string[] = [`CREATE SEQUENCE IF NOT EXISTS ffim_rev`];
  for (const t of TABLE_NAMES) {
    const cols = TABLES[t].map(colDdl);
    // rev = sync counter: every change gets a bigger number, so phones can ask
    // "what changed since number X?"
    cols.push(`rev bigint NOT NULL DEFAULT nextval('ffim_rev')`);
    cols.push(`server_updated_at timestamptz NOT NULL DEFAULT now()`);
    out.push(`CREATE TABLE IF NOT EXISTS ${t} (\n  ${cols.join(',\n  ')}\n)`);
    // Add any columns introduced in newer versions of the app
    for (const c of TABLES[t]) {
      if (c.name === 'id') continue;
      out.push(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS ${colDdl(c)}`);
    }
    out.push(`CREATE INDEX IF NOT EXISTS ${t}_rev_idx ON ${t} (rev)`);
  }
  // Members can be on the list before their house is mapped
  out.push(`ALTER TABLE people ALTER COLUMN house_id DROP NOT NULL`);
  // Private sign-in fields: never sent to phones.
  out.push(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash text`);
  out.push(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0`);
  out.push(`CREATE UNIQUE INDEX IF NOT EXISTS users_name_uniq ON users (lower(name)) WHERE NOT deleted`);
  out.push(`CREATE INDEX IF NOT EXISTS houses_zone_idx ON houses (zone_id)`);
  out.push(`CREATE INDEX IF NOT EXISTS tasks_house_idx ON tasks (house_id)`);
  out.push(`CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assignee_id)`);
  out.push(`CREATE INDEX IF NOT EXISTS people_house_idx ON people (house_id)`);
  out.push(`CREATE INDEX IF NOT EXISTS visits_house_idx ON visits (house_id)`);
  out.push(`CREATE INDEX IF NOT EXISTS people_external_idx ON people (external_member_id)`);

  // A ready-made reporting view (handy for dashboards or other systems).
  out.push(`DROP VIEW IF EXISTS house_overview`);
  out.push(`CREATE VIEW house_overview AS
SELECT h.id, h.code, h.name, h.address, h.area, h.zone_id, z.name AS zone_name, h.lat, h.lng, h.household_size,
       h.is_member_household, h.do_not_visit, h.vacant, h.next_visit_on, h.external_ref,
       COALESCE(p.people_count, 0) AS people_count,
       COALESCE(p.member_count, 0) AS member_count,
       v.last_contact_at,
       CASE
         WHEN h.do_not_visit THEN 'do_not_visit'
         WHEN h.vacant THEN 'empty_house'
         WHEN h.is_member_household OR COALESCE(p.member_count, 0) > 0 THEN 'member'
         WHEN v.last_contact_at IS NULL THEN 'not_evangelised'
         WHEN v.last_contact_at >= date_trunc('week', now()) THEN 'checked_this_week'
         ELSE 'follow_up_due'
       END AS status
FROM houses h
LEFT JOIN zones z ON z.id = h.zone_id
LEFT JOIN (
  SELECT house_id, count(*) AS people_count, count(*) FILTER (WHERE is_member) AS member_count
  FROM people WHERE NOT deleted GROUP BY house_id
) p ON p.house_id = h.id
LEFT JOIN (
  SELECT house_id, max(visited_at) AS last_contact_at
  FROM visits WHERE NOT deleted AND COALESCE(outcome, '') NOT IN ('not_home', 'vacant') GROUP BY house_id
) v ON v.house_id = h.id
WHERE NOT h.deleted`);
  return out;
}

let ready: Promise<void> | null = null;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Creates/updates tables the first time the server runs (or after an app update). */
export function ensureSchema(q: Query): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const stmts = schemaStatements();
      const version = hash(stmts.join(';'));
      try {
        const rows = await q(`SELECT value FROM ffim_meta WHERE key = 'schema'`);
        if (rows[0]?.value === version) return;
      } catch {
        /* first run: meta table does not exist yet */
      }
      for (const s of stmts) await q(s);
      await q(`CREATE TABLE IF NOT EXISTS ffim_meta (key text PRIMARY KEY, value text)`);
      await q(
        `INSERT INTO ffim_meta (key, value) VALUES ('schema', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [version],
      );
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}
