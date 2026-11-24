/** Turns web Requests into our handlers. Used by Vercel and the dev server. */
import { authenticate, listForSignIn, login, saveUser, setup } from './auth.js';
import { getBranding, setBranding } from './branding.js';
import { resolveLink } from './links.js';
import { aiChat, aiStatus, aiTranscribe } from './ai.js';
import { getDb } from './db.js';
import { handleExport } from './export.js';
import { ensureSchema } from './schema.js';
import { handleSync, type ApiResult } from './sync.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

function respond(r: ApiResult): Response {
  const isText = typeof r.body === 'string';
  return new Response(isText ? (r.body as string) : JSON.stringify(r.body), {
    status: r.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...r.headers },
  });
}

export async function route(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const is = (p: string, m: string) => path.endsWith(p) && request.method === m;
  try {
    if (is('/api/health', 'GET')) {
      return respond({ status: 200, body: { ok: true, app: 'FFIM Gather', database: Boolean(process.env.DATABASE_URL) } });
    }
    const q = getDb();
    await ensureSchema(q);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};

    if (is('/api/branding', 'GET')) return respond(await getBranding(q));
    if (is('/api/auth/team', 'GET')) return respond(await listForSignIn(q));
    if (is('/api/auth/setup', 'POST')) return respond(await setup(q, body));
    if (is('/api/auth/login', 'POST')) return respond(await login(q, body));

    const me = await authenticate(q, request.headers.get('authorization'));
    if (!me) return respond({ status: 401, body: { error: 'Please sign in again' } });

    if (is('/api/auth/me', 'GET')) return respond({ status: 200, body: { user: me } });
    if (is('/api/sync', 'POST')) return respond(await handleSync(body, me, q));
    if (is('/api/users', 'POST')) return respond(await saveUser(q, me, body));
    if (is('/api/branding', 'POST')) return respond(await setBranding(q, me, body));
    if (is('/api/assistant-status', 'GET')) return respond(aiStatus());
    if (is('/api/assistant', 'POST')) return respond(await aiChat(body));
    if (is('/api/transcribe', 'POST')) return respond(await aiTranscribe(body));
    if (is('/api/resolve-link', 'GET')) return respond(await resolveLink(url.searchParams.get('url')));
    if (is('/api/export', 'GET')) return respond(await handleExport(url.searchParams, me, q));
    return respond({ status: 404, body: { error: 'Not found' } });
  } catch (e) {
    console.error(e);
    return respond({ status: 500, body: { error: e instanceof Error ? e.message : 'Server error' } });
  }
}
