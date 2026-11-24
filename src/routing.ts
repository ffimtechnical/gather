/**
 * Road distances, worked out on the phone.
 *
 * Roads come from the same OpenStreetMap map tiles the map already uses (no routing server).
 * They are joined into a walking network (every road usable both ways), then:
 *  - A*        finds the shortest route from one place to another (e.g. a house to the church)
 *  - Dijkstra  finds the distance from one place to many places in a single pass
 */
import { MAP_STYLE } from './mapConfig';
import { distanceM } from './util';
import { EXTENT, decode, latToY, lngToX, osmTileTemplate, pool, tilesFor, xToLng, yToLat, type Bounds } from './vtiles';

type LatLng = { lat: number; lng: number };
const Z = 14;
const MAX_TILES = 64;
const SNAP_M = 400; // how far a place may be from the nearest road
const JOIN_M = 12; // close small gaps between road pieces from neighbouring tiles
const SKIP = new Set(['rail', 'transit', 'ferry', 'aerialway']);
export const WALK_KMH = 4.8;
/** Typical town driving speed including junctions and traffic (estimate only) */
export const DRIVE_KMH = 22;

// ---------------------------------------------------------------------------
// The road network
// ---------------------------------------------------------------------------

const index = new Map<number, number>(); // global tile pixel → node number
const lat: number[] = [];
const lng: number[] = [];
const adj: number[][] = [];
const wt: number[][] = [];
const grid = new Map<string, number[]>(); // ~110 m cells → nodes
const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

const cellKey = (la: number, ln: number) => `${Math.floor(la * 1000)},${Math.floor(ln * 1000)}`;

function node(gx: number, gy: number): number {
  const key = gx * 67108864 + gy;
  let n = index.get(key);
  if (n !== undefined) return n;
  n = lat.length;
  index.set(key, n);
  lat.push(yToLat(gy / EXTENT, Z));
  lng.push(xToLng(gx / EXTENT, Z));
  adj.push([]);
  wt.push([]);
  const c = cellKey(lat[n], lng[n]);
  const arr = grid.get(c);
  if (arr) arr.push(n);
  else grid.set(c, [n]);
  return n;
}

function link(a: number, b: number) {
  if (a === b || adj[a].includes(b)) return;
  const d = distanceM({ lat: lat[a], lng: lng[a] }, { lat: lat[b], lng: lng[b] });
  adj[a].push(b);
  wt[a].push(d);
  adj[b].push(a);
  wt[b].push(d);
}

function nodesNear(p: LatLng, radiusM: number): number[] {
  const steps = Math.ceil(radiusM / 110);
  const cy = Math.floor(p.lat * 1000), cx = Math.floor(p.lng * 1000);
  const out: number[] = [];
  for (let i = -steps; i <= steps; i++) for (let j = -steps; j <= steps; j++) out.push(...(grid.get(`${cy + i},${cx + j}`) ?? []));
  return out;
}

function nearest(p: LatLng, maxM = SNAP_M): { n: number; d: number } | null {
  let best: { n: number; d: number } | null = null;
  for (const n of nodesNear(p, maxM)) {
    const d = distanceM(p, { lat: lat[n], lng: lng[n] });
    if (d <= maxM && (!best || d < best.d)) best = { n, d };
  }
  return best;
}

async function loadTile(tpl: string, x: number, y: number) {
  const key = `${x}/${y}`;
  if (loaded.has(key)) return;
  let p = loading.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(tpl.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y)));
      if (!res.ok) throw new Error('Road data is not available right now');
      const layer = decode(await res.arrayBuffer()).layers.transportation;
      const added: number[] = [];
      if (layer) {
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i);
          if (f.type !== 2 || SKIP.has(String(f.properties.class))) continue;
          for (const line of f.loadGeometry()) {
            let prev = -1;
            for (const pt of line) {
              const n = node(x * EXTENT + pt.x, y * EXTENT + pt.y);
              if (prev >= 0) link(prev, n);
              prev = n;
              added.push(n);
            }
          }
        }
      }
      // Join loose road ends to nearby roads (tile edges cut lines into pieces)
      for (const n of added) {
        if (adj[n].length !== 1) continue;
        for (const m of nodesNear({ lat: lat[n], lng: lng[n] }, JOIN_M)) {
          if (m !== n && !adj[n].includes(m) && distanceM({ lat: lat[n], lng: lng[n] }, { lat: lat[m], lng: lng[m] }) <= JOIN_M) link(n, m);
        }
      }
      loaded.add(key);
    })().finally(() => loading.delete(key));
    loading.set(key, p);
  }
  return p;
}

/** Makes sure the roads around these points are loaded. */
async function ensureRoads(points: LatLng[]) {
  const pad = 0.004; // ~450 m
  const b: Bounds = {
    south: Math.min(...points.map((p) => p.lat)) - pad,
    north: Math.max(...points.map((p) => p.lat)) + pad,
    west: Math.min(...points.map((p) => p.lng)) - pad,
    east: Math.max(...points.map((p) => p.lng)) + pad,
  };
  const tiles = tilesFor(b, Z);
  if (tiles.length > MAX_TILES) throw new Error('Too far apart to measure by road');
  const tpl = await osmTileTemplate(MAP_STYLE);
  await pool(tiles, 4, ([x, y]) => loadTile(tpl, x, y));
}

// ---------------------------------------------------------------------------
// Priority queue (binary heap)
// ---------------------------------------------------------------------------

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const { k, v } = this;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const { k, v } = this;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        let mk = lk;
        if (l < k.length && k[l] < mk) (m = l), (mk = k[l]);
        if (r < k.length && k[r] < mk) (m = r), (mk = k[r]);
        if (m === i) break;
        k[i] = k[m];
        v[i] = v[m];
        i = m;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

// ---------------------------------------------------------------------------
// A* and Dijkstra
// ---------------------------------------------------------------------------

function aStar(s: number, t: number): { meters: number; nodes: number[] } | null {
  const g = new Map<number, number>([[s, 0]]);
  const from = new Map<number, number>();
  const tp = { lat: lat[t], lng: lng[t] };
  const h = (n: number) => distanceM({ lat: lat[n], lng: lng[n] }, tp); // straight line never overestimates
  const open = new Heap();
  open.push(h(s), s);
  const closed = new Set<number>();
  while (open.size) {
    const [, n] = open.pop();
    if (n === t) {
      const nodes = [t];
      while (from.has(nodes[0])) nodes.unshift(from.get(nodes[0])!);
      return { meters: g.get(t)!, nodes };
    }
    if (closed.has(n)) continue;
    closed.add(n);
    const gn = g.get(n)!;
    for (let i = 0; i < adj[n].length; i++) {
      const m = adj[n][i];
      const cand = gn + wt[n][i];
      if (cand < (g.get(m) ?? Infinity)) {
        g.set(m, cand);
        from.set(m, n);
        open.push(cand + h(m), m);
      }
    }
  }
  return null;
}

function dijkstra(s: number, maxM = 30000): Map<number, number> {
  const dist = new Map<number, number>([[s, 0]]);
  const q = new Heap();
  q.push(0, s);
  while (q.size) {
    const [d, n] = q.pop();
    if (d > (dist.get(n) ?? Infinity) || d > maxM) continue;
    for (let i = 0; i < adj[n].length; i++) {
      const m = adj[n][i];
      const nd = d + wt[n][i];
      if (nd < (dist.get(m) ?? Infinity)) {
        dist.set(m, nd);
        q.push(nd, m);
      }
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface Route {
  meters: number; // by road, including the short walk to/from the road
  straight: number; // as the crow flies
  minutes: number; // walking
  driveMinutes: number; // rough estimate by car
  path: [number, number][];
}

/** Shortest walking route by road (A*). Returns null when no road connects the two. */
export async function roadRoute(from: LatLng, to: LatLng): Promise<Route | null> {
  await ensureRoads([from, to]);
  const a = nearest(from), b = nearest(to);
  if (!a || !b) return null;
  const r = aStar(a.n, b.n);
  if (!r) return null;
  const meters = r.meters + a.d + b.d;
  return {
    meters,
    straight: distanceM(from, to),
    minutes: Math.round((meters / 1000 / WALK_KMH) * 60),
    driveMinutes: Math.max(1, Math.round((meters / 1000 / DRIVE_KMH) * 60)),
    path: [[from.lat, from.lng], ...r.nodes.map((n) => [lat[n], lng[n]] as [number, number]), [to.lat, to.lng]],
  };
}

/** Road distance (metres) from one origin to many places in one pass (Dijkstra). */
export async function roadDistancesFrom(origin: LatLng, places: LatLng[], maxM = 8000): Promise<(number | null)[]> {
  if (!places.length) return [];
  // Only places within walking range of the origin are measured by road
  const inRange = places.filter((p) => distanceM(origin, p) <= maxM);
  if (!inRange.length) return places.map(() => null);
  await ensureRoads([origin, ...inRange]);
  const o = nearest(origin);
  if (!o) return places.map(() => null);
  const dist = dijkstra(o.n);
  return places.map((p) => {
    if (distanceM(origin, p) > maxM) return null;
    const s = nearest(p);
    const d = s ? dist.get(s.n) : undefined;
    return s && d !== undefined ? d + s.d + o.d : null;
  });
}

export function fmtWalk(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, minutes)} min walk`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min walk`;
}

export const _test = { latToY, lngToX, stats: () => ({ nodes: lat.length, tiles: loaded.size }) };
