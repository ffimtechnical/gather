/** Helpers for reading map data tiles (vector tiles) directly in the browser. */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

export const EXTENT = 4096;

export function lngToX(lng: number, z: number) {
  return ((lng + 180) / 360) * 2 ** z;
}
export function latToY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
export function xToLng(x: number, z: number) {
  return (x / 2 ** z) * 360 - 180;
}
export function yToLat(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Tile coordinates covering a box at zoom z. */
export function tilesFor(b: Bounds, z: number): [number, number][] {
  const x1 = Math.floor(lngToX(b.west, z)), x2 = Math.floor(lngToX(b.east, z));
  const y1 = Math.floor(latToY(b.north, z)), y2 = Math.floor(latToY(b.south, z));
  const out: [number, number][] = [];
  for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) out.push([x, y]);
  return out;
}

export function decode(buf: ArrayBuffer | Uint8Array): VectorTile {
  return new VectorTile(new PbfReader(buf instanceof Uint8Array ? buf : new Uint8Array(buf)));
}

/** Runs async jobs a few at a time. */
export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>, onEach?: (done: number) => void): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
        onEach?.(++done);
      }
    }),
  );
  return out;
}

let tileTemplate: Promise<string> | null = null;
/** URL template of the OpenStreetMap vector tiles used by the map (changes with each weekly update). */
export function osmTileTemplate(styleUrl: string): Promise<string> {
  tileTemplate ??= (async () => {
    const style = await (await fetch(styleUrl)).json();
    const src = style.sources?.openmaptiles;
    if (src?.tiles?.[0]) return src.tiles[0] as string;
    const tj = await (await fetch(src.url)).json();
    return tj.tiles[0] as string;
  })().catch((e) => {
    tileTemplate = null;
    throw e;
  });
  return tileTemplate;
}
