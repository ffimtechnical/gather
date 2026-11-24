/**
 * Sign-in and team management.
 *
 * For now people sign in by tapping their name (no code). Each user also has
 * an optional PIN: if one is ever set on a user, it becomes required for them.
 * Sessions are signed tokens, so the server always knows who is making a change.
 */
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { TABLES, userZoneIds, type Role, type User } from '../shared/model.js';
import type { Query } from './db.js';
import { normalize, type ApiResult } from './sync.js';

export type AuthUser = User & { token_version: number };

const PUBLIC_USER_COLS = TABLES.users.map((c) => c.name).join(', ');
const TOKEN_DAYS = 180;

// ---------------------------------------------------------------------------

let secretCache: string | null = null;
async function secret(q: Query): Promise<string> {
  if (process.env.FFIM_SECRET) return process.env.FFIM_SECRET;
  if (secretCache) return secretCache;
  await q(`CREATE TABLE IF NOT EXISTS ffim_meta (key text PRIMARY KEY, value text)`);
  await q(`INSERT INTO ffim_meta (key, value) VALUES ('secret', $1) ON CONFLICT (key) DO NOTHING`, [
    randomBytes(32).toString('hex'),
  ]);
  const rows = await q(`SELECT value FROM ffim_meta WHERE key = 'secret'`);
  secretCache = String(rows[0].value);
  return secretCache;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (data: string, key: string) => createHmac('sha256', key).update(data).digest('base64url');

async function makeToken(q: Query, u: { id: string; token_version: number }): Promise<string> {
  const payload = b64(JSON.stringify({ u: u.id, v: u.token_version, e: Date.now() + TOKEN_DAYS * 864e5 }));
  return `${payload}.${sign(payload, await secret(q))}`;
}

export async function authenticate(q: Query, header: string | null): Promise<AuthUser | null> {
  const token = header?.replace(/^Bearer\s+/i, '').trim();
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload, await secret(q));
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data: { u: string; v: number; e: number };
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
  if (!data?.u || data.e < Date.now()) return null;
  const rows = await q(`SELECT ${PUBLIC_USER_COLS}, token_version FROM users WHERE id = $1 AND NOT deleted AND active`, [data.u]);
  const u = rows[0] as unknown as AuthUser | undefined;
  if (!u || Number(u.token_version) !== data.v) return null;
  return u;
}

function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex');
  return `s1$${salt}$${scryptSync(pin, salt, 32).toString('hex')}`;
}
function checkPin(pin: string, stored: string): boolean {
  const [, salt, hash] = stored.split('$');
  const a = scryptSync(pin, salt, 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function publicUser(q: Query, id: string) {
  const rows = await q(`SELECT ${PUBLIC_USER_COLS} FROM users WHERE id = $1`, [id]);
  return rows[0] ? normalize('users', rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** GET /api/auth/team: names shown on the sign-in screen. */
export async function listForSignIn(q: Query): Promise<ApiResult> {
  const rows = await q(
    `SELECT u.id, u.name, u.role, (u.pin_hash IS NOT NULL) AS has_pin, z.name AS zone_name
     FROM users u LEFT JOIN zones z ON z.id = u.zone_id
     WHERE NOT u.deleted AND u.active ORDER BY u.role = 'admin' DESC, u.role = 'pastor' DESC, lower(u.name)`,
  );
  return { status: 200, body: { needsSetup: rows.length === 0, setupCode: Boolean(process.env.FFIM_SETUP_CODE), team: rows } };
}

/** POST /api/auth/setup {name, code?}: creates the first admin. */
export async function setup(q: Query, body: { name?: string; code?: string }): Promise<ApiResult> {
  const name = String(body?.name ?? '').trim();
  if (!name) return { status: 400, body: { error: 'Enter your name' } };
  if (process.env.FFIM_SETUP_CODE && body.code !== process.env.FFIM_SETUP_CODE) {
    return { status: 401, body: { error: 'Setup code is wrong' } };
  }
  const count = await q(`SELECT count(*)::int AS n FROM users WHERE NOT deleted`);
  if (Number(count[0].n) > 0) return { status: 409, body: { error: 'Already set up. Sign in instead.' } };
  const id = randomUUID();
  await q(
    `INSERT INTO users (id, name, role, active, updated_by) VALUES ($1, $2, 'admin', true, $2)`,
    [id, name],
  );
  return login(q, { user_id: id });
}

/** POST /api/auth/login {user_id, pin?} */
export async function login(q: Query, body: { user_id?: string; pin?: string }): Promise<ApiResult> {
  const rows = await q(`SELECT id, token_version, pin_hash FROM users WHERE id = $1 AND NOT deleted AND active`, [
    String(body?.user_id ?? ''),
  ]).catch(() => []);
  const u = rows[0] as { id: string; token_version: number; pin_hash: string | null } | undefined;
  if (!u) return { status: 404, body: { error: 'This person is not on the team' } };
  if (u.pin_hash) {
    if (!body.pin) return { status: 401, body: { error: 'PIN needed', needsPin: true } };
    if (!checkPin(String(body.pin), u.pin_hash)) {
      await new Promise((r) => setTimeout(r, 600));
      return { status: 401, body: { error: 'Wrong PIN', needsPin: true } };
    }
  }
  return {
    status: 200,
    body: { token: await makeToken(q, { id: u.id, token_version: Number(u.token_version) }), user: await publicUser(q, u.id) },
  };
}

interface UserInput {
  id?: string;
  name?: string;
  phone?: string | null;
  role?: Role;
  zone_id?: string | null;
  active?: boolean;
  external_member_id?: string | null;
  pin?: string | null;
}

/** POST /api/users: add or edit a team member, within the caller's rights. */
export async function saveUser(q: Query, me: AuthUser, body: UserInput): Promise<ApiResult> {
  const zones = (await q(`SELECT id, pastor_id, deleted FROM zones`)) as { id: string; pastor_id: string | null; deleted: boolean }[];
  const myZones = userZoneIds(me, zones);
  const inMyZones = (z: string | null | undefined) => myZones === null || (!!z && myZones.includes(z));

  const existing = body.id
    ? ((await q(`SELECT ${PUBLIC_USER_COLS} FROM users WHERE id = $1 AND NOT deleted`, [body.id]))[0] as unknown as User | undefined)
    : undefined;
  if (body.id && !existing) return { status: 404, body: { error: 'User not found' } };

  const next = {
    name: (body.name ?? existing?.name ?? '').trim(),
    phone: body.phone !== undefined ? body.phone : existing?.phone ?? null,
    role: (body.role ?? existing?.role ?? 'member') as Role,
    zone_id: body.zone_id !== undefined ? body.zone_id : existing?.zone_id ?? null,
    active: body.active ?? existing?.active ?? true,
    external_member_id: body.external_member_id !== undefined ? body.external_member_id : existing?.external_member_id ?? null,
  };
  if (!next.name) return { status: 400, body: { error: 'Name is required' } };
  if (!['admin', 'pastor', 'member'].includes(next.role)) return { status: 400, body: { error: 'Unknown role' } };

  const isSelf = existing?.id === me.id;
  const forbidden = { status: 403, body: { error: 'You can’t make this change' } };

  if (me.role !== 'admin') {
    if (isSelf) {
      // Anyone may edit their own name/phone, nothing else.
      next.role = existing!.role;
      next.zone_id = existing!.zone_id;
      next.active = existing!.active;
    } else if (me.role === 'pastor') {
      if (next.role !== 'member' || (existing && existing.role !== 'member')) return forbidden;
      if (!inMyZones(next.zone_id) || (existing && !inMyZones(existing.zone_id))) return forbidden;
    } else return forbidden;
  } else if (isSelf && (next.role !== 'admin' || !next.active)) {
    return { status: 400, body: { error: 'You can’t remove your own admin access' } };
  }

  const id = existing?.id ?? randomUUID();
  const pinChange = body.pin === undefined ? undefined : body.pin ? hashPin(String(body.pin)) : null;
  try {
    await q(
      `INSERT INTO users (id, name, phone, role, zone_id, active, external_member_id, updated_at, updated_by, rev, server_updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, nextval('ffim_rev'), now())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, role = EXCLUDED.role,
         zone_id = EXCLUDED.zone_id, active = EXCLUDED.active, external_member_id = EXCLUDED.external_member_id,
         updated_at = now(), updated_by = EXCLUDED.updated_by, rev = nextval('ffim_rev'), server_updated_at = now(),
         token_version = users.token_version + CASE WHEN EXCLUDED.active THEN 0 ELSE 1 END`,
      [id, next.name, next.phone, next.role, next.zone_id, next.active, next.external_member_id, me.name],
    );
  } catch (e) {
    if (String(e).includes('users_name_uniq')) return { status: 409, body: { error: 'Someone on the team already has that name' } };
    throw e;
  }
  if (pinChange !== undefined && (me.role === 'admin' || isSelf)) {
    await q(`UPDATE users SET pin_hash = $2, token_version = token_version + 1 WHERE id = $1`, [id, pinChange]);
  }
  return { status: 200, body: { user: await publicUser(q, id) } };
}
