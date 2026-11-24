/**
 * Opens a short Google Maps link (maps.app.goo.gl/…) to find the full address it points to.
 * Browsers can't do this themselves, so the server follows the redirects. Only Google
 * hosts are followed.
 */
import type { ApiResult } from './sync.js';

const SHORT = /^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/i;
const GOOGLE = /(^|\.)google\.[a-z.]+$/i;

export async function resolveLink(raw: string | null): Promise<ApiResult> {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    return { status: 400, body: { error: 'That doesn’t look like a link' } };
  }
  for (let hop = 0; hop < 6; hop++) {
    if (url.hostname === 'consent.google.com' && url.searchParams.get('continue')) {
      url = new URL(url.searchParams.get('continue')!);
      continue;
    }
    if (GOOGLE.test(url.hostname) && url.pathname.startsWith('/maps')) break;
    if (!SHORT.test(url.hostname) && !GOOGLE.test(url.hostname)) {
      return { status: 400, body: { error: 'Only Google Maps links can be opened' } };
    }
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (compatible; FFIM Gather)' } });
    const next = res.headers.get('location');
    if (!next) break;
    url = new URL(next, url);
  }
  return { status: 200, body: { url: url.href } };
}
