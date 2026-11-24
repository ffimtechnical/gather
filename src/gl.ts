// Loaded on demand: the MapLibre engine that draws the OpenStreetMap vector map.
import 'maplibre-gl/dist/maplibre-gl.css';
import { setWorkerUrl } from 'maplibre-gl';
// Bundle MapLibre's background worker ourselves so it loads in development and production alike.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(workerUrl);
export { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
