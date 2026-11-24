-- FFIM Gather database schema (reference copy).
-- The app creates/updates this automatically on first sync; you never need to run it by hand.

CREATE SEQUENCE IF NOT EXISTS ffim_rev;

CREATE TABLE IF NOT EXISTS zones (
  id uuid PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#2f7a4f',
  polygon jsonb NOT NULL DEFAULT '[]'::jsonb,
  pastor_id uuid,
  notes text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  deleted boolean NOT NULL DEFAULT false,
  rev bigint NOT NULL DEFAULT nextval('ffim_rev'),
  server_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zones_rev_idx ON zones (rev);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  phone text,
  role text NOT NULL DEFAULT 'member',
  zone_id uuid,
  active boolean NOT NULL DEFAULT true,
  external_member_id text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  deleted boolean NOT NULL DEFAULT false,
  rev bigint NOT NULL DEFAULT nextval('ffim_rev'),
  server_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_rev_idx ON users (rev);

CREATE TABLE IF NOT EXISTS houses (
  id uuid PRIMARY KEY,
  code text NOT NULL DEFAULT '',
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  zone_id uuid,
  name text,
  address text,
  area text,
  description text,
  household_size integer,
  is_member_household boolean NOT NULL DEFAULT false,
  do_not_visit boolean NOT NULL DEFAULT false,
  next_visit_on text,
  source text NOT NULL DEFAULT 'manual',
  osm_id text,
  external_ref text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  deleted boolean NOT NULL DEFAULT false,
  rev bigint NOT NULL DEFAULT nextval('ffim_rev'),
  server_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS houses_rev_idx ON houses (rev);

CREATE TABLE IF NOT EXISTS people (
  id uuid PRIMARY KEY,
  house_id uuid NOT NULL,
  full_name text NOT NULL DEFAULT '',
  phone text,
  email text,
  gender text,
  age_group text,
  is_member boolean NOT NULL DEFAULT false,
  member_since text,
  consent_contact boolean NOT NULL DEFAULT false,
  prayer_requests text,
  notes text,
  external_member_id text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  deleted boolean NOT NULL DEFAULT false,
  rev bigint NOT NULL DEFAULT nextval('ffim_rev'),
  server_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS people_rev_idx ON people (rev);

CREATE TABLE IF NOT EXISTS visits (
  id uuid PRIMARY KEY,
  house_id uuid NOT NULL,
  person_id uuid,
  kind text NOT NULL DEFAULT 'evangelism',
  outcome text,
  visited_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  next_step text,
  visited_by text,
  user_id uuid,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  deleted boolean NOT NULL DEFAULT false,
  rev bigint NOT NULL DEFAULT nextval('ffim_rev'),
  server_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visits_rev_idx ON visits (rev);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  house_id uuid NOT NULL,
  assignee_id uuid,
  action text NOT NULL DEFAULT 'follow_up',
  due_on text,
  note text,
  status text NOT NULL DEFAULT 'open',
  done_at timestamptz,
  assigned_by uuid,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  deleted boolean NOT NULL DEFAULT false,
  rev bigint NOT NULL DEFAULT nextval('ffim_rev'),
  server_updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_rev_idx ON tasks (rev);

CREATE UNIQUE INDEX IF NOT EXISTS users_name_uniq ON users (lower(name)) WHERE NOT deleted;

CREATE INDEX IF NOT EXISTS houses_zone_idx ON houses (zone_id);

CREATE INDEX IF NOT EXISTS tasks_house_idx ON tasks (house_id);

CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assignee_id);

CREATE INDEX IF NOT EXISTS people_house_idx ON people (house_id);

CREATE INDEX IF NOT EXISTS visits_house_idx ON visits (house_id);

CREATE INDEX IF NOT EXISTS people_external_idx ON people (external_member_id);

DROP VIEW IF EXISTS house_overview;

CREATE VIEW house_overview AS
SELECT h.id, h.code, h.name, h.address, h.area, h.zone_id, z.name AS zone_name, h.lat, h.lng, h.household_size,
       h.is_member_household, h.do_not_visit, h.next_visit_on, h.external_ref,
       COALESCE(p.people_count, 0) AS people_count,
       COALESCE(p.member_count, 0) AS member_count,
       v.last_contact_at,
       CASE
         WHEN h.do_not_visit THEN 'do_not_visit'
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
  FROM visits WHERE NOT deleted AND COALESCE(outcome, '') <> 'not_home' GROUP BY house_id
) v ON v.house_id = h.id
WHERE NOT h.deleted;
