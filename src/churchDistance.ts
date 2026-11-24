/** Remembers road distances to the church so each house is only measured once per session. */
import { getChurch } from './branding';
import { roadRoute, type Route } from './routing';

const cache = new Map<string, Promise<Route | null>>();

export function routeToChurch(h: { id: string; lat: number; lng: number }): Promise<Route | null> | null {
  const c = getChurch();
  if (!c) return null;
  const key = `${h.id}:${h.lat},${h.lng}:${c.lat},${c.lng}`;
  let p = cache.get(key);
  if (!p) {
    p = roadRoute({ lat: h.lat, lng: h.lng }, c).catch(() => null);
    cache.set(key, p);
  }
  return p;
}
