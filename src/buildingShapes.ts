/**
 * Turning raw building outlines into one clean pin per real building.
 *
 * The outlines come from AI detections on satellite photos (Google, Microsoft) and from
 * hand-traced OpenStreetMap buildings. Three things go wrong with the raw data:
 *  1. Weak detections that aren't buildings (bare patches, cars, trees, rubble).
 *  2. One building split into several outlines (a complex roof, an annex), or detected twice.
 *  3. Outlines cut in two where map tiles meet.
 * This file fixes all three. Pure maths, no network, so it is easy to test.
 */

export type Pt = [number, number]; // [lat, lng]

export interface RawOutline {
  /** Stable id from the data (the same building in two tiles has the same id). */
  id: string;
  /** Outer rings, already clipped to their tile (so pieces from neighbouring tiles don't overlap). */
  rings: Pt[][];
  source: 'osm' | 'google' | 'microsoft' | 'other';
  /** Detection confidence 0–1 (Google only). */
  confidence: number | null;
}

export interface Building {
  key: string;
  lat: number;
  lng: number;
  /** Floor area in m² (all parts together). */
  area: number;
  source: string;
  /** Outlines of every part, for "is this pin on a building?" checks. */
  rings: Pt[][];
}

const M_PER_DEG = 111_320;

/** Local flat coordinates in metres around a reference point. */
function projector(lat0: number, lng0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    to: ([lat, lng]: Pt): [number, number] => [(lng - lng0) * M_PER_DEG * k, (lat - lat0) * M_PER_DEG],
    from: ([x, y]: [number, number]): Pt => [lat0 + y / M_PER_DEG, lng0 + x / (M_PER_DEG * k)],
  };
}

type XY = [number, number];

function signedArea(p: XY[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
}

function centroidXY(p: XY[]): XY {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
    a += f;
    cx += (p[j][0] + p[i][0]) * f;
    cy += (p[j][1] + p[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  return [cx / (3 * a), cy / (3 * a)];
}

export function insideXY(x: number, y: number, r: XY[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function insideRing(lat: number, lng: number, r: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [yi, xi] = r[i], [yj, xj] = r[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function convexHull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: XY[] = [], up: XY[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** Area of the smallest rotated rectangle around the points (rotating calipers). */
function minRectArea(pts: XY[]): number {
  const h = convexHull(pts);
  if (h.length < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < h.length; i++) {
    const [x1, y1] = h[i], [x2, y2] = h[(i + 1) % h.length];
    const l = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / l, uy = (y2 - y1) / l;
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [x, y] of h) {
      const s = x * ux + y * uy, t = -x * uy + y * ux;
      a = Math.min(a, s); b = Math.max(b, s); c = Math.min(c, t); d = Math.max(d, t);
    }
    best = Math.min(best, (b - a) * (d - c));
  }
  return best;
}

function pointSegDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function segsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  const o = (p: XY, q: XY, r: XY) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** Shortest gap between two outlines in metres (0 if they touch or overlap). */
function gap(A: XY[], B: XY[]): number {
  if (insideXY(A[0][0], A[0][1], B) || insideXY(B[0][0], B[0][1], A)) return 0;
  let best = Infinity;
  for (let i = 0, j = A.length - 1; i < A.length; j = i++)
    for (let k = 0, l = B.length - 1; k < B.length; l = k++) {
      if (segsCross(A[j], A[i], B[l], B[k])) return 0;
      best = Math.min(best, pointSegDist(A[i], B[l], B[k]), pointSegDist(B[k], A[j], A[i]));
    }
  return best;
}

/** A point that is surely inside the outline (the centre, unless the shape is L/U-shaped). */
function interiorPoint(r: XY[]): XY {
  const c = centroidXY(r);
  if (insideXY(c[0], c[1], r)) return c;
  // widest stretch of the horizontal line through the centre
  const y = c[1];
  const xs: number[] = [];
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
  }
  xs.sort((a, b) => a - b);
  let best: XY = r[0], w = -1;
  for (let i = 0; i + 1 < xs.length; i += 2)
    if (xs[i + 1] - xs[i] > w) {
      w = xs[i + 1] - xs[i];
      best = [(xs[i] + xs[i + 1]) / 2, y];
    }
  return best;
}

interface Shape {
  o: RawOutline;
  parts: XY[][];
  area: number;
  /** area ÷ smallest surrounding rectangle; real buildings are boxy (≈0.75–1) */
  boxy: number;
  pin: XY;
  bbox: [number, number, number, number];
}

/**
 * Is this outline a real building? OpenStreetMap buildings were traced by people, so they're kept.
 * AI detections must be confident, and small ones must be more confident (that's where
 * the false alarms are: patches of bare ground, cars, rubble, shadows).
 */
export function looksLikeBuilding(s: { source: RawOutline['source']; confidence: number | null; area: number; boxy: number }): boolean {
  if (s.area < 9) return false;
  if (s.source === 'osm') return true;
  if (s.boxy < 0.55) return false; // ragged blobs are trees or shadows, not roofs
  if (s.source === 'microsoft') return s.area >= 16;
  const c = s.confidence ?? 1;
  const need = s.area < 20 ? 0.8 : s.area < 35 ? 0.74 : s.area < 60 ? 0.7 : 0.67;
  return c >= need;
}

/**
 * Raw outlines (possibly the same building in several tiles, or several outlines per building)
 * → one clean entry per building.
 */
export function cleanBuildings(raw: RawOutline[], keyPrefix: string): Building[] {
  if (!raw.length) return [];
  // 1. Join pieces of the same building cut at tile edges
  const byId = new Map<string, RawOutline>();
  for (const r of raw) {
    const had = byId.get(r.id);
    if (had) had.rings.push(...r.rings);
    else byId.set(r.id, { ...r, rings: [...r.rings] });
  }
  const first = raw[0].rings[0][0];
  const P = projector(first[0], first[1]);

  // 2. Measure each one and drop what isn't a building
  const shapes: Shape[] = [];
  for (const o of byId.values()) {
    const parts = o.rings.filter((r) => r.length >= 3).map((r) => r.map(P.to));
    if (!parts.length) continue;
    const area = parts.reduce((s, p) => s + Math.abs(signedArea(p)), 0);
    const all = parts.flat();
    const rect = minRectArea(all);
    const boxy = rect > 0 ? Math.min(1, area / rect) : 0;
    if (!looksLikeBuilding({ source: o.source, confidence: o.confidence, area, boxy })) continue;
    const main = parts.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    shapes.push({ o, parts, area, boxy, pin: interiorPoint(main), bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }

  // 3. Merge outlines that belong to one building, carefully, so neighbouring houses never chain together
  const parent = shapes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const pairs = nearbyPairs(shapes);
  // a) the same building detected twice (outlines overlap)
  for (const [i, j] of pairs) if (overlaps(shapes[i], shapes[j])) parent[find(i)] = find(j);
  const size = new Map<number, number>();
  shapes.forEach((_, i) => size.set(find(i), (size.get(find(i)) ?? 0) + 1));
  const single = (i: number) => size.get(find(i)) === 1;
  const gaps = new Map<string, number>();
  const gapOf = (i: number, j: number) => {
    const k = `${i}:${j}`;
    let g = gaps.get(k);
    if (g === undefined) {
      g = Infinity;
      for (const a of shapes[i].parts) for (const b of shapes[j].parts) g = Math.min(g, gap(a, b));
      gaps.set(k, g);
    }
    return g;
  };
  // b) a small annex (kitchen, porch, store) stuck to one house: joins its biggest touching neighbour only
  const annexOf = new Map<number, number>();
  for (const [i, j] of pairs) {
    for (const [sm, bg] of [[i, j], [j, i]]) {
      const S = shapes[sm], B = shapes[bg];
      if (!single(sm) || S.area >= 0.35 * B.area || S.area > 45) continue;
      if (gapOf(Math.min(i, j), Math.max(i, j)) > 0.8) continue;
      const prev = annexOf.get(sm);
      if (prev === undefined || shapes[prev].area < B.area) annexOf.set(sm, bg);
    }
  }
  for (const [sm, bg] of annexOf) parent[find(sm)] = find(bg);
  // c) two halves of one roof: two similar outlines touching that together make one tidy house-sized box
  const paired = new Set<number>();
  for (const [i, j] of pairs) {
    if (paired.has(i) || paired.has(j) || annexOf.has(i) || annexOf.has(j) || !single(i) || !single(j)) continue;
    const A = shapes[i], B = shapes[j];
    if (A.area + B.area > 260 || Math.min(A.area, B.area) < 0.35 * Math.max(A.area, B.area)) continue;
    if (gapOf(Math.min(i, j), Math.max(i, j)) > 0.8) continue;
    const together = [...A.parts.flat(), ...B.parts.flat()];
    if ((A.area + B.area) / (minRectArea(together) || Infinity) < 0.82) continue;
    paired.add(i).add(j);
    parent[find(i)] = find(j);
  }

  const groups = new Map<number, Shape[]>();
  shapes.forEach((s, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(s);
    else groups.set(r, [s]);
  });

  const out: Building[] = [];
  for (const g of groups.values()) {
    const main = g.reduce((a, b) => (b.area > a.area ? b : a));
    const [lat, lng] = P.from(main.pin);
    out.push({
      key: `${keyPrefix}:${main.o.id}`,
      lat,
      lng,
      area: g.reduce((s, x) => s + x.area, 0),
      source: main.o.source,
      rings: g.flatMap((x) => x.parts.map((p) => p.map(P.from))),
    });
  }
  return out;
}

/** Outlines that overlap: the same building detected twice. */
function overlaps(A: Shape, B: Shape): boolean {
  const [big, small] = A.area >= B.area ? [A, B] : [B, A];
  return big.parts.some((p) => insideXY(small.pin[0], small.pin[1], p)) || small.parts.some((p) => insideXY(big.pin[0], big.pin[1], p));
}

/** Pairs of outlines whose boxes come within 1 m of each other. */
function nearbyPairs(shapes: Shape[]): [number, number][] {
  const CELL = 25;
  const grid = new Map<string, number[]>();
  shapes.forEach((s, i) => {
    for (let gx = Math.floor(s.bbox[0] / CELL); gx <= Math.floor(s.bbox[2] / CELL); gx++)
      for (let gy = Math.floor(s.bbox[1] / CELL); gy <= Math.floor(s.bbox[3] / CELL); gy++) {
        const k = `${gx},${gy}`;
        const l = grid.get(k);
        if (l) l.push(i);
        else grid.set(k, [i]);
      }
  });
  const seen = new Set<number>();
  const out: [number, number][] = [];
  const n = shapes.length;
  for (const cell of grid.values())
    for (let a = 0; a < cell.length; a++)
      for (let b = a + 1; b < cell.length; b++) {
        const i = Math.min(cell[a], cell[b]), j = Math.max(cell[a], cell[b]);
        const key = i * n + j;
        if (seen.has(key)) continue;
        seen.add(key);
        const A = shapes[i], B = shapes[j];
        if (A.bbox[0] > B.bbox[2] + 1 || B.bbox[0] > A.bbox[2] + 1 || A.bbox[1] > B.bbox[3] + 1 || B.bbox[1] > A.bbox[3] + 1) continue;
        out.push([i, j]);
      }
  return out;
}

/** Index for "which building is this pin on?" (tolerance in metres for pins dropped just off the roof edge). */
export function buildingLocator(buildings: Building[], toleranceM = 1.5) {
  const C = 0.0003;
  const grid = new Map<string, number[]>();
  buildings.forEach((b, i) => {
    const pts = b.rings.flat();
    const la = pts.map((p) => p[0]), ln = pts.map((p) => p[1]);
    for (let x = Math.floor(Math.min(...la) / C); x <= Math.floor(Math.max(...la) / C); x++)
      for (let y = Math.floor(Math.min(...ln) / C); y <= Math.floor(Math.max(...ln) / C); y++) {
        const k = `${x},${y}`;
        const l = grid.get(k);
        if (l) l.push(i);
        else grid.set(k, [i]);
      }
  });
  return (lat: number, lng: number): number => {
    const P = projector(lat, lng);
    let best = -1, bestD = toleranceM;
    const seen = new Set<number>();
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const i of grid.get(`${Math.floor(lat / C) + dx},${Math.floor(lng / C) + dy}`) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          for (const r of buildings[i].rings) {
            if (insideRing(lat, lng, r)) return i;
            const xy = r.map(P.to);
            for (let a = 0, b = xy.length - 1; a < xy.length; b = a++) {
              const d = pointSegDist([0, 0], xy[b], xy[a]);
              if (d < bestD) (bestD = d), (best = i);
            }
          }
        }
    return best;
  };
}

/** Clips a ring (in tile pixels) to the tile square, so buffer copies of neighbouring tiles' buildings are dropped. */
export function clipToTile(ring: { x: number; y: number }[], extent: number): { x: number; y: number }[] {
  let pts = ring;
  const edges: [(p: { x: number; y: number }) => boolean, (a: { x: number; y: number }, b: { x: number; y: number }) => { x: number; y: number }][] = [
    [(p) => p.x >= 0, (a, b) => ({ x: 0, y: a.y + ((b.y - a.y) * (0 - a.x)) / (b.x - a.x) })],
    [(p) => p.x <= extent, (a, b) => ({ x: extent, y: a.y + ((b.y - a.y) * (extent - a.x)) / (b.x - a.x) })],
    [(p) => p.y >= 0, (a, b) => ({ x: a.x + ((b.x - a.x) * (0 - a.y)) / (b.y - a.y), y: 0 })],
    [(p) => p.y <= extent, (a, b) => ({ x: a.x + ((b.x - a.x) * (extent - a.y)) / (b.y - a.y), y: extent })],
  ];
  for (const [inside, cut] of edges) {
    if (!pts.length) break;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
      if (inside(cur)) {
        if (!inside(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (inside(prev)) out.push(cut(prev, cur));
    }
    pts = out;
  }
  return pts;
}
