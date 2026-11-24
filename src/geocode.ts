/**
 * One search box that understands:
 *  - place names, areas and landmarks (OpenStreetMap, via Photon)
 *  - coordinates: "5.6037, -0.1870", "5.6037 N 0.187 W", 5°36'13.3"N 0°11'13.2"W
 *  - Google Maps links, including short maps.app.goo.gl links
 *  - plus codes: "6CQX8F9X+8C" or "8F9X+8C Accra"
 * Area boundaries (for zones) come from OpenStreetMap via Nominatim.
 */
import { OpenLocationCode } from 'open-location-code';
import { api } from './session';

export interface Place {
  id: string;
  name: string;
  detail: string;
  lat: number;
  lng: number;
  kind: 'coords' | 'place' | 'area' | 'landmark' | 'street';
  /** [south, west, north, east] when the place covers an area */
  bounds?: [number, number, number, number];
  /** OpenStreetMap id like "R123456" — used to fetch an area boundary */
  osm?: string;
}

const olc = new OpenLocationCode();

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

const valid = (lat: number, lng: number) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

function dmsToDeg(d: string, m?: string, s?: string, hemi?: string): number {
  let v = Math.abs(parseFloat(d)) + (m ? parseFloat(m) / 60 : 0) + (s ? parseFloat(s) / 3600 : 0);
  if (d.trim().startsWith('-') || /[SW]/i.test(hemi ?? '')) v = -v;
  return v;
}

export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const t = text.trim().replace(/[()[\]]/g, ' ');
  // Degrees, minutes, seconds with hemispheres: 5°36'13.3"N 0°11'13.2"W
  const dms = t.match(
    /^(-?\d+(?:\.\d+)?)\s*[°º]\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*["″”]\s*)?([NS])[\s,;]+(-?\d+(?:\.\d+)?)\s*[°º]\s*(?:(\d+(?:\.\d+)?)\s*['′’]\s*)?(?:(\d+(?:\.\d+)?)\s*["″”]\s*)?([EW])$/i,
  );
  if (dms) {
    const lat = dmsToDeg(dms[1], dms[2], dms[3], dms[4]);
    const lng = dmsToDeg(dms[5], dms[6], dms[7], dms[8]);
    return valid(lat, lng) ? { lat, lng } : null;
  }
  // Decimal with hemispheres: 5.6037 N, 0.187 W  /  N5.6037 W0.187
  const hemi = t.match(/^([NS])?\s*(\d+(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+([EW])?\s*(\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (hemi && (hemi[1] || hemi[3]) && (hemi[4] || hemi[6])) {
    const lat = dmsToDeg(hemi[2], undefined, undefined, hemi[1] || hemi[3]);
    const lng = dmsToDeg(hemi[5], undefined, undefined, hemi[4] || hemi[6]);
    return valid(lat, lng) ? { lat, lng } : null;
  }
  // Plain decimal pair: 5.6037, -0.1870
  const dec = t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (dec && (dec[1].includes('.') || dec[2].includes('.'))) {
    const lat = parseFloat(dec[1]), lng = parseFloat(dec[2]);
    return valid(lat, lng) ? { lat, lng } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Google Maps links
// ---------------------------------------------------------------------------

export function findUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0] : null;
}

const isShortLink = (u: URL) => /^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/i.test(u.hostname);
const isGoogleMaps = (u: URL) => /(^|\.)google\.[a-z.]+$/i.test(u.hostname) || /^maps\.google\./i.test(u.hostname);

/** Reads coordinates (or a place name) out of a full Google Maps URL. */
export function parseGoogleUrl(href: string): { lat: number; lng: number; name?: string } | { name: string } | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const s = decodeURIComponent(u.href).replace(/\+/g, ' ');
  // The dropped pin of a place: !3d<lat>!4d<lng> (most accurate)
  const pin = [...s.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g)].pop();
  const placeName = s.match(/\/maps\/place\/([^/@]+)/)?.[1]?.trim();
  if (pin) return { lat: +pin[1], lng: +pin[2], name: placeName };
  for (const key of ['q', 'query', 'll', 'destination', 'center', 'daddr', 'sll']) {
    const v = u.searchParams.get(key);
    if (!v) continue;
    const c = parseCoordinates(v.replace(/^loc:/, ''));
    if (c) return { ...c, name: placeName };
    if (key === 'q' || key === 'query' || key === 'destination' || key === 'daddr') return { name: v };
  }
  const inPath = s.match(/\/(?:search|place|dir\/[^/]*)\/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (inPath) return { lat: +inPath[1], lng: +inPath[2], name: placeName };
  const at = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return { lat: +at[1], lng: +at[2], name: placeName };
  if (placeName) return { name: placeName };
  return null;
}

async function fromLink(href: string, near: { lat: number; lng: number }): Promise<Place[]> {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return [];
  }
  let full = href;
  if (isShortLink(u)) {
    const r = await api<{ url: string }>(`resolve-link?url=${encodeURIComponent(href)}`);
    full = r.url;
  } else if (!isGoogleMaps(u)) return [];
  const g = parseGoogleUrl(full);
  if (!g) return [];
  if ('lat' in g) return [coordsPlace(g.lat, g.lng, g.name ?? 'Google Maps location')];
  return searchPlaces(g.name, near);
}

// ---------------------------------------------------------------------------
// Plus codes and GhanaPost GPS
// ---------------------------------------------------------------------------

function coordsPlace(lat: number, lng: number, name?: string): Place {
  return {
    id: `c:${lat},${lng}`,
    name: name ?? `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
    detail: name ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Coordinates',
    lat,
    lng,
    kind: 'coords',
  };
}

async function fromPlusCode(text: string, near: { lat: number; lng: number }): Promise<Place[] | null> {
  const m = text.trim().match(/^([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,3})(?:[\s,]+(.+))?$/i);
  if (!m) return null;
  const code = m[1].toUpperCase();
  if (!olc.isValid(code)) return null;
  let full = code;
  if (olc.isShort(code)) {
    let ref = near;
    if (m[2]) {
      const area = (await searchPlaces(m[2], near))[0];
      if (area) ref = area;
    }
    full = olc.recoverNearest(code, ref.lat, ref.lng);
  }
  const a = olc.decode(full);
  return [coordsPlace(a.latitudeCenter, a.longitudeCenter, `Plus code ${code}${m[2] ? ' ' + m[2] : ''}`)];
}

/** GhanaPost GPS digital addresses (e.g. GA-183-8164) can't be looked up with open data. */
export const isGhanaPostGps = (t: string) => /^[A-Z]{2}-?\d{3,4}-?\d{4}$/i.test(t.trim());

// ---------------------------------------------------------------------------
// Place search (Photon: open-source OpenStreetMap search made for search-as-you-type)
// ---------------------------------------------------------------------------

const PHOTON = (import.meta.env.VITE_PHOTON_URL as string | undefined) ?? 'https://photon.komoot.io';
const COUNTRY = ((import.meta.env.VITE_SEARCH_COUNTRY as string | undefined) ?? 'GH').toUpperCase();
/** Rough box around Ghana, used to keep results local */
const COUNTRY_BBOX: Record<string, string> = { GH: '-3.3,4.5,1.3,11.2' };

const AREA_TYPES = new Set(['city', 'district', 'locality', 'county', 'state', 'suburb', 'neighbourhood', 'quarter', 'town', 'village', 'hamlet', 'borough', 'city_block', 'residential', 'administrative']);

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | number | number[] | undefined> & { extent?: number[] };
}

const cache = new Map<string, Place[]>();

async function photon(q: string, near: { lat: number; lng: number }, bbox?: string): Promise<Place[]> {
  const params = new URLSearchParams({ q, limit: '8', lang: 'en', lat: String(near.lat), lon: String(near.lng) });
  if (bbox) params.set('bbox', bbox);
  const res = await fetch(`${PHOTON}/api/?${params}`);
  if (!res.ok) throw new Error('Place search is busy. Try again in a moment.');
  const json = (await res.json()) as { features: PhotonFeature[] };
  const seen = new Set<string>();
  return json.features.flatMap((f) => {
    const p = f.properties;
    const [lng, lat] = f.geometry.coordinates;
    const name = String(p.name ?? p.street ?? '');
    if (!name) return [];
    const type = String(p.type ?? '');
    const value = String(p.osm_value ?? '');
    const key = String(p.osm_key ?? '');
    const isArea = AREA_TYPES.has(type) || AREA_TYPES.has(value) || key === 'boundary' || key === 'place';
    const kind: Place['kind'] = isArea ? 'area' : type === 'street' || key === 'highway' ? 'street' : 'landmark';
    const detail = [p.district, p.locality, p.city, p.county ?? p.state].filter((x) => x && x !== name);
    const id = `${p.osm_type}${p.osm_id}`;
    if (seen.has(id)) return [];
    seen.add(id);
    const e = p.extent;
    return [{
      id,
      name,
      detail: [...new Set(detail.map(String))].slice(0, 2).join(', ') || String(p.country ?? ''),
      lat,
      lng,
      kind,
      bounds: e && e.length === 4 ? ([e[3], e[0], e[1], e[2]] as [number, number, number, number]) : undefined,
      osm: p.osm_type && p.osm_id ? `${p.osm_type}${p.osm_id}` : undefined,
    }];
  });
}

export async function searchPlaces(q: string, near: { lat: number; lng: number }): Promise<Place[]> {
  const key = `${q.toLowerCase()}|${near.lat.toFixed(1)},${near.lng.toFixed(1)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out = COUNTRY_BBOX[COUNTRY] ? await photon(q, near, COUNTRY_BBOX[COUNTRY]) : [];
  if (!out.length) out = await photon(q, near);
  cache.set(key, out);
  return out;
}

/** Everything the search box can find for a piece of text. */
export async function lookup(text: string, near: { lat: number; lng: number }): Promise<Place[]> {
  const t = text.trim();
  if (!t) return [];
  const url = findUrl(t);
  if (url) return fromLink(url, near);
  const c = parseCoordinates(t);
  if (c) return [coordsPlace(c.lat, c.lng)];
  const plus = await fromPlusCode(t, near);
  if (plus) return plus;
  if (t.length < 3) return [];
  return searchPlaces(t, near);
}

/** Is this text something we can resolve without typing more (link, coords, plus code)? */
export function isDirect(text: string): boolean {
  const t = text.trim();
  return Boolean(findUrl(t) || parseCoordinates(t) || /\+[23456789CFGHJMPQRVWX]{2,3}\b/i.test(t));
}

// ---------------------------------------------------------------------------
// Area boundaries (Nominatim, one request when an admin turns an area into a zone)
// ---------------------------------------------------------------------------

type Ring = [number, number][];

/** Outline of an OpenStreetMap area as [[lat,lng], …], or null if it has none. */
export async function areaBoundary(osm: string): Promise<Ring | null> {
  if (!/^[NWR]\d+$/.test(osm) || osm.startsWith('N')) return null;
  const res = await fetch(
    `https://nominatim.openstreetmap.org/lookup?osm_ids=${osm}&format=json&polygon_geojson=1&polygon_threshold=0.00005`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error('Could not get that area’s outline right now');
  const [hit] = (await res.json()) as { geojson?: { type: string; coordinates: unknown } }[];
  const g = hit?.geojson;
  if (!g) return null;
  let rings: number[][][] = [];
  if (g.type === 'Polygon') rings = [(g.coordinates as number[][][])[0]];
  else if (g.type === 'MultiPolygon') rings = (g.coordinates as number[][][][]).map((p) => p[0]);
  if (!rings.length) return null;
  const area = (r: number[][]) => Math.abs(r.reduce((s, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x1 * y2 - x2 * y1; }, 0));
  const biggest = rings.sort((a, b) => area(b) - area(a))[0];
  let ring: Ring = biggest.map(([lng, lat]) => [lat, lng]);
  if (ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]) ring = ring.slice(0, -1);
  // Keep zones light: at most ~300 corners
  const step = Math.ceil(ring.length / 300);
  return step > 1 ? ring.filter((_, i) => i % step === 0) : ring;
}
