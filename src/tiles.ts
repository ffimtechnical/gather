/**
 * Map backgrounds. Nothing here needs an API key.
 *
 *  - Map: OpenStreetMap data drawn by OpenFreeMap (open source, free, no key). Shows streets,
 *    areas and landmarks: churches, schools, shops, filling stations…
 *  - Satellite: Esri satellite photos, with the same OpenStreetMap labels on top.
 *
 * To use another provider, set VITE_MAP_STYLE (a MapLibre style URL) or VITE_PHOTO_TILES.
 */
import L from 'leaflet';
import type { StyleSpecification } from 'maplibre-gl';

const gl = () => import('./gl');

export type LayerId = 'map' | 'satellite';

const env = import.meta.env;
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
import { MAP_STYLE } from './mapConfig';
export { MAP_STYLE };
const PHOTO_TILES: string = env.VITE_PHOTO_TILES ?? `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
const PHOTO_ATTR = 'Imagery © Esri, Vantor, Earthstar Geographics and the GIS User Community';

let glSupport: boolean | null = null;
/** Older phones without WebGL get simpler (picture) maps. */
export function webglOK(): boolean {
  if (glSupport === null) {
    try {
      const c = document.createElement('canvas');
      glSupport = Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      glSupport = false;
    }
  }
  return glSupport;
}

let baseStyle: Promise<StyleSpecification> | null = null;
/**
 * The map style, tidied once: road-number shields are dropped. They're for US/European highway numbers
 * (not used in Ghana) and their filters make the map library print warnings in the console.
 */
function mapStyle(): Promise<StyleSpecification> {
  baseStyle ??= fetch(MAP_STYLE)
    .then((r) => {
      if (!r.ok) throw new Error(`Map style ${r.status}`);
      return r.json() as Promise<StyleSpecification>;
    })
    .then((style) => ({ ...style, layers: style.layers.filter((l) => !/shield/i.test(l.id)) }))
    .catch((e) => {
      baseStyle = null;
      throw e;
    });
  return baseStyle;
}

let labelsStyle: Promise<StyleSpecification> | null = null;
/** The OpenStreetMap style with only labels, landmarks and roads, for drawing over satellite photos. */
function labelsOnlyStyle(): Promise<StyleSpecification> {
  labelsStyle ??= mapStyle()
    .then((style) => ({
      ...style,
      layers: style.layers
        .filter((l) => l.type === 'symbol' || (l.type === 'line' && 'source-layer' in l && l['source-layer'] === 'transportation'))
        .map((l) => (l.type === 'line' ? { ...l, paint: { ...l.paint, 'line-opacity': 0.45 } } : l)),
    }))
    .catch((e) => {
      labelsStyle = null;
      throw e;
    });
  return labelsStyle;
}

const fallbackStreets = () =>
  L.tileLayer(`${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 18, maxZoom: 21, attribution: 'Tiles © Esri and its data partners' });
const fallbackLabels = () =>
  [`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`].map((u) =>
    L.tileLayer(u, { maxNativeZoom: 19, maxZoom: 21 }),
  );

/** Puts the chosen background on the map; returns a function that removes it. */
export function showBaseLayer(map: L.Map, id: LayerId): () => void {
  const layers: L.Layer[] = [];
  let cancelled = false;
  const add = (l: L.Layer) => {
    if (cancelled) return;
    l.addTo(map);
    layers.push(l);
  };
  const hasGL = webglOK();

  if (id === 'map') {
    if (hasGL)
      Promise.all([gl(), mapStyle()])
        .then(([m, style]) => add(m.maplibreGL({ style })))
        .catch(() => add(fallbackStreets()));
    else add(fallbackStreets());
  } else {
    add(L.tileLayer(PHOTO_TILES, { maxNativeZoom: 19, maxZoom: 21, attribution: PHOTO_ATTR }));
    if (hasGL)
      Promise.all([gl(), labelsOnlyStyle()])
        .then(([m, style]) => add(m.maplibreGL({ style })))
        .catch(() => fallbackLabels().forEach(add));
    else fallbackLabels().forEach(add);
  }
  return () => {
    cancelled = true;
    layers.forEach((l) => l.remove());
  };
}
