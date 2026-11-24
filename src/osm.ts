/**
 * Finds buildings automatically.
 *
 * Main source: Overture Maps buildings, updated every month. It combines, without doubles,
 *  - OpenStreetMap buildings traced by people (many local mappers in Ghana),
 *  - Google Open Buildings and Microsoft building footprints (AI detections from satellite photos).
 * Backup source (if Overture can't be reached): the VIDA Google + Microsoft + OSM dataset.
 * Both are read straight from cloud files (PMTiles): no server, key or AI model of our own.
 *
 * The raw outlines are then cleaned (buildingShapes.ts): weak detections dropped, one building's
 * outlines merged into one, and outlines cut at tile edges joined, so each building gets one pin.
 */
import { PMTiles } from 'pmtiles';
import { zoneFor, type House } from '../shared/model';
import { buildingLocator, cleanBuildings, clipToTile, type Building, type Pt, type RawOutline } from './buildingShapes';
import { base, codeMaker, db, saveRows, uuid } from './db';
import { decode, pool, tilesFor, xToLng, yToLat, type Bounds } from './vtiles';

export type { Building as FoundBuilding } from './buildingShapes';

const env = import.meta.env;
const OVERTURE_BUCKET = 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com';
const VIDA_URL = 'https://data.source.coop/vida/google-microsoft-osm-open-buildings/pmtiles/goog_msft_osm_country_layers.pmtiles';
/** Set VITE_BUILDINGS_PMTILES to force one file (Overture-style or VIDA-style). */
const CUSTOM_URL = env.VITE_BUILDINGS_PMTILES as string | undefined;

/** The most map data loaded at once: about 10 × 10 km. */
const maxTiles = (src: Source) => (src.z <= 14 ? 16 : 64);

interface Source {
  name: 'overture' | 'vida';
  z: number;
  archive: PMTiles;
}

let source: Promise<Source> | null = null;

/** Overture keeps its last 3 monthly releases; find the newest (remembered for a day). */
async function latestOverture(): Promise<string> {
  const KEY = 'ffim.overture';
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { rel: string; at: number } | null;
    if (saved && Date.now() - saved.at < 86_400_000) return saved.rel;
  } catch {
    /* ignore */
  }
  const xml = await (await fetch(`${OVERTURE_BUCKET}/?list-type=2&prefix=tiles/&delimiter=/`)).text();
  const rels = [...xml.matchAll(/<Prefix>tiles\/([^<]+)\/<\/Prefix>/g)].map((m) => m[1]).sort();
  const rel = rels[rels.length - 1];
  if (!rel) throw new Error('No Overture release found');
  try {
    localStorage.setItem(KEY, JSON.stringify({ rel, at: Date.now() }));
  } catch {
    /* ignore */
  }
  return rel;
}

async function openSource(): Promise<Source> {
  if (CUSTOM_URL) {
    const archive = new PMTiles(CUSTOM_URL);
    const md = (await archive.getMetadata()) as { vector_layers?: { id: string }[] };
    const isOverture = md.vector_layers?.some((l) => l.id === 'building');
    const h = await archive.getHeader();
    return { name: isOverture ? 'overture' : 'vida', z: h.maxZoom, archive };
  }
  try {
    const rel = await latestOverture();
    const archive = new PMTiles(`${OVERTURE_BUCKET}/tiles/${rel}/buildings.pmtiles`);
    const h = await archive.getHeader();
    return { name: 'overture', z: Math.min(14, h.maxZoom), archive };
  } catch {
    localStorage.removeItem('ffim.overture');
    return { name: 'vida', z: 15, archive: new PMTiles(VIDA_URL) };
  }
}

function getSource() {
  source ??= openSource().catch((e) => {
    source = null;
    throw e;
  });
  return source;
}

const tileCache = new Map<string, RawOutline[]>();

function sourceOf(name: string): RawOutline['source'] {
  const n = name.toLowerCase();
  return n.includes('openstreetmap') || n === 'osm' ? 'osm' : n.includes('google') ? 'google' : n.includes('microsoft') ? 'microsoft' : 'other';
}

/** Reads one tile's outlines, clipped to the tile so buildings on the edge aren't counted twice. */
async function loadTile(src: Source, x: number, y: number): Promise<RawOutline[]> {
  const key = `${src.name}/${src.z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const t = await src.archive.getZxy(src.z, x, y);
  const out: RawOutline[] = [];
  if (t?.data) {
    const vt = decode(t.data);
    const names = src.name === 'overture' ? ['building'] : Object.keys(vt.layers);
    for (const name of names) {
      const layer = vt.layers[name];
      if (!layer) continue;
      const ext = layer.extent;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        if (f.type !== 3) continue;
        const p = f.properties;
        let id: string, from: RawOutline['source'], confidence: number | null = null;
        if (src.name === 'overture') {
          if (p.is_underground === true) continue;
          id = String(p.id ?? f.id);
          from = sourceOf(String(p['@geometry_source'] ?? ''));
          if (from === 'google' && typeof p.sources === 'string') {
            try {
              const c = (JSON.parse(p.sources) as { confidence?: number }[]).find((s) => typeof s.confidence === 'number')?.confidence;
              confidence = c ?? null;
            } catch {
              /* ignore */
            }
          }
        } else {
          id = String(f.id ?? `${x}/${y}/${i}`);
          from = sourceOf(String(p.bf_source ?? ''));
          confidence = typeof p.confidence === 'number' ? p.confidence : null;
        }
        // first ring is the outline; other rings with the same winding are extra parts, the rest are holes
        const geo = f.loadGeometry();
        const sign = Math.sign(ringArea(geo[0]));
        const rings: Pt[][] = [];
        for (const r of geo) {
          if (r.length < 3 || Math.sign(ringArea(r)) !== sign) continue;
          const clipped = clipToTile(r, ext);
          if (clipped.length < 3) continue;
          rings.push(clipped.map((q) => [yToLat(y + q.y / ext, src.z), xToLng(x + q.x / ext, src.z)]));
        }
        if (rings.length) out.push({ id, rings, source: from, confidence });
      }
    }
  }
  tileCache.set(key, out);
  return out;
}

function ringArea(r: { x: number; y: number }[]) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j].x * r[i].y - r[i].x * r[j].y;
  return a;
}

/** How many data tiles an area needs, and whether that's too much for one go. */
export async function areaSize(b: Bounds): Promise<{ tiles: number; tooBig: boolean }> {
  const src = await getSource();
  const tiles = tilesFor(b, src.z).length;
  return { tiles, tooBig: tiles > maxTiles(src) };
}

export interface FindOptions {
  /** Skip sheds and very big buildings (schools, markets, warehouses). */
  homesOnly?: boolean;
  inside?: (lat: number, lng: number) => boolean;
  onProgress?: (done: number, total: number) => void;
}

/** Clean buildings (one per real building) inside an area. */
export async function findBuildings(b: Bounds, opts: FindOptions = {}): Promise<Building[]> {
  const src = await getSource();
  const tiles = tilesFor(b, src.z);
  if (tiles.length > maxTiles(src)) throw new Error('That area is too big. Zoom in or pick a smaller zone.');
  const lists = await pool(tiles, 4, ([x, y]) => loadTile(src, x, y), (d) => opts.onProgress?.(d, tiles.length));
  return cleanBuildings(lists.flat(), src.name === 'overture' ? 'ov' : 'vida')
    .filter((f) => f.lat >= b.south && f.lat <= b.north && f.lng >= b.west && f.lng <= b.east)
    .filter((f) => !opts.homesOnly || (f.area >= 18 && f.area <= 900))
    .filter((f) => !opts.inside || opts.inside(f.lat, f.lng));
}

/** Which found buildings don't have a pin on them yet. */
export function notYetPinned(found: Building[], houses: House[]): Building[] {
  const locate = buildingLocator(found);
  const taken = new Set<number>();
  for (const h of houses) {
    if (h.deleted) continue;
    const i = locate(h.lat, h.lng);
    if (i >= 0) taken.add(i);
  }
  return found.filter((_, i) => !taken.has(i));
}

/** Adds buildings as red (not yet visited) houses. */
export async function addBuildings(found: Building[]): Promise<number> {
  const existing = await db.houses.filter((h) => !h.deleted).toArray();
  const zones = await db.zones.filter((z) => !z.deleted).toArray();
  const fresh = notYetPinned(found, existing);
  const nextCode = await codeMaker();
  const rows: House[] = fresh.map((b) => ({
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
    vacant: false,
    next_visit_on: null,
    source: 'auto',
    osm_id: b.key,
    external_ref: null,
    ...base(),
  }));
  for (let i = 0; i < rows.length; i += 500) await saveRows('houses', rows.slice(i, i + 500));
  return rows.length;
}

// ---------------------------------------------------------------- tidy up

export interface TidyPlan {
  /** Auto pins that aren't on any real building */
  notBuildings: House[];
  /** Extra pins on a building that already has one */
  doubles: House[];
  /** Buildings with no pin yet (homes only) */
  missing: Building[];
  /** Pins left alone because someone has worked with them (visits, people, notes…) */
  kept: number;
}

/**
 * Checks every automatically added pin against the cleaned building data. Only pins nobody
 * has worked with (no visits, people, tasks, notes or marks) are ever suggested for removal.
 */
export async function planTidy(
  houses: House[],
  used: Set<string>,
  opts: { inside?: (lat: number, lng: number) => boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<TidyPlan> {
  const src = await getSource();
  const live = houses.filter((h) => !h.deleted);
  if (!live.length) return { notBuildings: [], doubles: [], missing: [], kept: 0 };

  // load every tile that has pins (and its neighbours, so buildings across edges are whole)
  const want = new Map<string, [number, number]>();
  for (const h of live) {
    const [[x, y]] = tilesFor({ south: h.lat, north: h.lat, west: h.lng, east: h.lng }, src.z);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) want.set(`${x + dx}/${y + dy}`, [x + dx, y + dy]);
  }
  const tiles = [...want.values()];
  if (tiles.length > 200) throw new Error('These pins cover too large an area to check at once. Pick one zone.');
  const lists = await pool(tiles, 4, ([x, y]) => loadTile(src, x, y), (d) => opts.onProgress?.(d, tiles.length));
  const buildings = cleanBuildings(lists.flat(), src.name === 'overture' ? 'ov' : 'vida');
  const locate = buildingLocator(buildings);

  const worked = (h: House) =>
    h.source !== 'auto' || used.has(h.id) || h.name || h.address || h.description || h.household_size != null ||
    h.is_member_household || h.do_not_visit || h.vacant || h.next_visit_on || h.external_ref;

  const owner = new Map<number, House>();
  const notBuildings: House[] = [], doubles: House[] = [];
  let kept = 0;
  // pins people have worked with claim their building first
  const ordered = [...live].sort((a, b) => Number(Boolean(worked(b))) - Number(Boolean(worked(a))) || a.code.localeCompare(b.code));
  for (const h of ordered) {
    const i = locate(h.lat, h.lng);
    if (worked(h)) {
      kept++;
      if (i >= 0 && !owner.has(i)) owner.set(i, h);
      continue;
    }
    if (i < 0) notBuildings.push(h);
    else if (owner.has(i)) doubles.push(h);
    else owner.set(i, h);
  }

  // homes not pinned yet, in the same neighbourhoods
  const lats = live.map((h) => h.lat), lngs = live.map((h) => h.lng);
  const box = { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) };
  const missing = buildings.filter(
    (b, i) =>
      !owner.has(i) &&
      b.area >= 18 && b.area <= 900 &&
      b.lat >= box.south && b.lat <= box.north && b.lng >= box.west && b.lng <= box.east &&
      (!opts.inside || opts.inside(b.lat, b.lng)),
  );
  return { notBuildings, doubles, missing, kept };
}

/** Removes the given pins (they can be restored from a backup; nothing else is touched). */
export async function removePins(pins: House[]): Promise<number> {
  const now = new Date().toISOString();
  const rows = pins.map((h) => ({ ...h, deleted: true, updated_at: now }));
  for (let i = 0; i < rows.length; i += 500) await saveRows('houses', rows.slice(i, i + 500));
  return rows.length;
}
