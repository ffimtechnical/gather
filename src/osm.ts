/**
 * Finds buildings automatically.
 *
 * Source: the combined Google Open Buildings + Microsoft Building Footprints + OpenStreetMap
 * dataset (by VIDA, on Source Cooperative). Google and Microsoft made it by running AI over
 * satellite photos, so it covers Ghana far better than hand-mapped data. It is read straight
 * from a cloud file (PMTiles), so no server, key or AI model of our own is needed.
 */
import { PMTiles } from 'pmtiles';
import { zoneFor, type House } from '../shared/model';
import { base, codeMaker, db, saveRows, uuid } from './db';
import { distanceM } from './util';
import { EXTENT, decode, pool, tilesFor, xToLng, yToLat, type Bounds } from './vtiles';

const BUILDINGS_URL =
  (import.meta.env.VITE_BUILDINGS_PMTILES as string | undefined) ??
  'https://data.source.coop/vida/google-microsoft-osm-open-buildings/pmtiles/goog_msft_osm_country_layers.pmtiles';
const Z = 15;
export const MAX_TILES = 48;

let archive: PMTiles | null = null;
const tileCache = new Map<string, FoundBuilding[]>();

export interface FoundBuilding {
  key: string;
  lat: number;
  lng: number;
  area: number;
  source: string; // google | microsoft | osm
}

/** Centre of a building outline (in global tile pixels). */
function centroid(ring: { x: number; y: number }[]) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    a += f;
    cx += (ring[j].x + ring[i].x) * f;
    cy += (ring[j].y + ring[i].y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = ring.length || 1;
    return { x: ring.reduce((s, p) => s + p.x, 0) / n, y: ring.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

async function loadTile(x: number, y: number): Promise<FoundBuilding[]> {
  const key = `${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  archive ??= new PMTiles(BUILDINGS_URL);
  const t = await archive.getZxy(Z, x, y);
  const out: FoundBuilding[] = [];
  if (t?.data) {
    const vt = decode(t.data);
    for (const name of Object.keys(vt.layers)) {
      const layer = vt.layers[name];
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        const ring = f.loadGeometry()[0];
        if (!ring || ring.length < 3) continue;
        const c = centroid(ring);
        if (c.x < 0 || c.y < 0 || c.x >= EXTENT || c.y >= EXTENT) continue; // belongs to a neighbouring tile
        const gx = x + c.x / EXTENT, gy = y + c.y / EXTENT;
        const p = f.properties;
        if (typeof p.confidence === 'number' && p.confidence < 0.65) continue;
        out.push({
          key: `${String(p.bf_source ?? 'b')}:${Math.round(gx * EXTENT)},${Math.round(gy * EXTENT)}`,
          lat: yToLat(gy, Z),
          lng: xToLng(gx, Z),
          area: Number(p.area_in_meters ?? 0),
          source: String(p.bf_source ?? ''),
        });
      }
    }
  }
  tileCache.set(key, out);
  return out;
}

export function tileCount(b: Bounds) {
  return tilesFor(b, Z).length;
}

/**
 * Buildings inside an area. `homesOnly` skips very small structures and very large
 * buildings (likely schools, markets, churches, warehouses).
 */
export async function findBuildings(
  b: Bounds,
  opts: { homesOnly?: boolean; inside?: (lat: number, lng: number) => boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<FoundBuilding[]> {
  const tiles = tilesFor(b, Z);
  if (tiles.length > MAX_TILES) throw new Error('That area is too big. Zoom in or pick a smaller zone.');
  const lists = await pool(tiles, 4, ([x, y]) => loadTile(x, y), (d) => opts.onProgress?.(d, tiles.length));
  return lists
    .flat()
    .filter((f) => f.lat >= b.south && f.lat <= b.north && f.lng >= b.west && f.lng <= b.east)
    .filter((f) => !opts.homesOnly || (f.area >= 18 && f.area <= 900))
    .filter((f) => !opts.inside || opts.inside(f.lat, f.lng));
}

/** Adds found buildings as red (not yet visited) houses, skipping ones already on the map. */
export async function addBuildings(found: FoundBuilding[]): Promise<number> {
  const existing = await db.houses.filter((h) => !h.deleted).toArray();
  const zones = await db.zones.filter((z) => !z.deleted).toArray();
  const keys = new Set(existing.map((h) => h.osm_id).filter(Boolean));
  // Grid of existing pins (~11 m cells) for a fast "already pinned nearby?" check
  const cell = (lat: number, lng: number) => `${Math.round(lat * 1e4)},${Math.round(lng * 1e4)}`;
  const grid = new Map<string, House[]>();
  for (const h of existing) {
    const k = cell(h.lat, h.lng);
    grid.set(k, [...(grid.get(k) ?? []), h]);
  }
  const near = (lat: number, lng: number) => {
    const [a, c] = [Math.round(lat * 1e4), Math.round(lng * 1e4)];
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) for (const h of grid.get(`${a + i},${c + j}`) ?? []) if (distanceM(h, { lat, lng }) < 6) return true;
    return false;
  };
  const nextCode = await codeMaker();
  const rows: House[] = [];
  for (const b of found) {
    if (keys.has(b.key) || near(b.lat, b.lng)) continue;
    rows.push({
      id: uuid(),
      code: nextCode(),
      lat: b.lat,
      lng: b.lng,
      zone_id: zoneFor(b.lat, b.lng, zones),
      name: null,
      address: null,
      area: null,
      description: null,
      household_size: null,
      is_member_household: false,
      do_not_visit: false,
      next_visit_on: null,
      source: 'auto',
      osm_id: b.key,
      external_ref: null,
      ...base(),
    });
  }
  for (let i = 0; i < rows.length; i += 500) await saveRows('houses', rows.slice(i, i + 500));
  return rows.length;
}
