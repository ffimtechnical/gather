/** Church settings (logo, name, church location), set by an admin and shared with every phone. */
import type { User } from '../shared/model.js';
import type { Query } from './db.js';
import type { ApiResult } from './sync.js';

const MAX_LOGO_BYTES = 400 * 1024;

async function meta(q: Query) {
  await q(`CREATE TABLE IF NOT EXISTS ffim_meta (key text PRIMARY KEY, value text)`);
  return q(`SELECT key, value FROM ffim_meta WHERE key LIKE 'brand.%'`);
}

export async function getBranding(q: Query): Promise<ApiResult> {
  const rows = await meta(q);
  const get = (k: string) => (rows.find((r) => r.key === `brand.${k}`)?.value as string | undefined) ?? null;
  return {
    status: 200,
    body: { logo: get('logo'), name: get('name'), church: get('church') ? JSON.parse(get('church')!) : null, version: get('version') },
    headers: { 'cache-control': 'no-cache' },
  };
}

export async function setBranding(
  q: Query,
  me: User,
  body: { logo?: string | null; name?: string | null; church?: { lat: number; lng: number; name?: string } | null },
): Promise<ApiResult> {
  if (me.role !== 'admin') return { status: 403, body: { error: 'Only admins can change church settings' } };
  await meta(q);
  const put = (k: string, v: string | null) =>
    v === null
      ? q(`DELETE FROM ffim_meta WHERE key = $1`, [`brand.${k}`])
      : q(`INSERT INTO ffim_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [`brand.${k}`, v]);

  if (body.logo !== undefined) {
    if (body.logo !== null) {
      if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.logo)) return { status: 400, body: { error: 'Use a PNG, JPG or WebP image' } };
      if (body.logo.length * 0.75 > MAX_LOGO_BYTES) return { status: 413, body: { error: 'That image is too large' } };
    }
    await put('logo', body.logo);
  }
  if (body.name !== undefined) await put('name', body.name?.trim() || null);
  if (body.church !== undefined) {
    const c = body.church;
    if (c !== null && !(typeof c.lat === 'number' && typeof c.lng === 'number' && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180)) {
      return { status: 400, body: { error: 'Church location is not valid' } };
    }
    await put('church', c === null ? null : JSON.stringify({ lat: c.lat, lng: c.lng, name: String(c.name ?? 'Church').slice(0, 120) }));
  }
  await put('version', String(Date.now()));
  return getBranding(q);
}
