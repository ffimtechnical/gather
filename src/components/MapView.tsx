import L from 'leaflet';
import { Check, Hexagon, ListChecks, LocateFixed, Plus, Sparkles, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, useMap, useMapEvents } from 'react-leaflet';
import { STATUS_INFO, STATUS_ORDER, type Status } from '../../shared/model';
import { linkToHouse, moveHouse, newHouse } from '../db';
import { ICON } from '../icons';
import { saveBranding, useBranding } from '../branding';
import { areaBoundary } from '../geocode';
import { showBaseLayer, type LayerId } from '../tiles';
import { useUI } from '../ui';
import { AssignModal } from './AssignModal';
import { FindHousesModal } from './FindHouses';
import { SearchBar } from './SearchBar';
import { SyncBadge } from './SyncBadge';
import { ZoneForm } from './ZoneForm';

const renderer = L.canvas({ padding: 0.5, tolerance: 10 });

function savedView(): { center: [number, number]; zoom: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem('ffim.view') ?? 'null');
    if (v && typeof v.lat === 'number') return { center: [v.lat, v.lng], zoom: v.zoom };
  } catch {
    /* ignore */
  }
  const env = import.meta.env.VITE_DEFAULT_CENTER as string | undefined;
  if (env) {
    const [lat, lng, zoom] = env.split(',').map(Number);
    return { center: [lat, lng], zoom: zoom || 16 };
  }
  return null;
}

const radiusFor = (z: number) => (z >= 19 ? 10 : z >= 18 ? 8 : z >= 17 ? 6.5 : z >= 15 ? 5 : 3.5);

function BaseLayer({ id }: { id: LayerId }) {
  const map = useMap();
  useEffect(() => showBaseLayer(map, id), [map, id]);
  return null;
}

/** Pin for a place found with search. */
function PlaceLayer() {
  const map = useMap();
  const { place } = useUI();
  useEffect(() => {
    if (!place) return;
    const m = L.marker([place.lat, place.lng], {
      icon: L.divIcon({ className: 'place-pin', html: '<span></span>', iconSize: [30, 40], iconAnchor: [15, 38] }),
      interactive: false,
      zIndexOffset: 900,
    }).addTo(map);
    return () => void m.remove();
  }, [map, place]);
  return null;
}

/** Zone outlines with their names. */
function ZoneLayer() {
  const map = useMap();
  const { data, mode } = useUI();
  useEffect(() => {
    const g = L.layerGroup().addTo(map);
    for (const z of data.zones) {
      if (z.polygon.length < 3) continue;
      if (mode.kind === 'draw' && mode.zoneId === z.id) continue;
      const mine = data.myZoneIds === null || data.myZoneIds.includes(z.id);
      L.polygon(z.polygon, {
        color: z.color, weight: mine ? 2.5 : 1.5, opacity: mine ? 0.9 : 0.45, dashArray: mine ? undefined : '6 6',
        fillColor: z.color, fillOpacity: mine ? 0.06 : 0.02, interactive: false, renderer,
      })
        .bindTooltip(z.name, { permanent: true, direction: 'center', className: 'zone-label' })
        .addTo(g);
    }
    return () => void g.remove();
  }, [map, data.zones, data.myZoneIds, mode]);
  return null;
}

/** Every house as a coloured dot (canvas, so thousands stay fast). */
function HouseLayer({ hidden }: { hidden: Set<Status> }) {
  const map = useMap();
  const ui = useUI();
  const { data, selectedId, mode } = ui;
  const group = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, { dot: L.CircleMarker; ring?: L.CircleMarker }>());
  const [zoom, setZoom] = useState(map.getZoom());
  const uiRef = useRef(ui);
  uiRef.current = ui;

  useEffect(() => {
    const g = L.layerGroup().addTo(map);
    group.current = g;
    const onZoom = () => setZoom(map.getZoom());
    map.on('zoomend', onZoom);
    return () => {
      map.off('zoomend', onZoom);
      g.remove();
      markers.current.clear();
    };
  }, [map]);

  const myTaskHouses = useMemo(() => new Set(data.myTasks.map((t) => t.house_id)), [data.myTasks]);
  const picked = useMemo(() => new Set(mode.kind === 'select' ? mode.ids : []), [mode]);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    const seen = new Set<string>();
    const r = radiusFor(zoom);
    for (const h of data.houses) {
      const st = data.statusById.get(h.id)!;
      if (hidden.has(st) && h.id !== selectedId) continue;
      seen.add(h.id);
      const isPicked = picked.has(h.id);
      const style: L.CircleMarkerOptions = {
        radius: isPicked ? r + 2 : r,
        color: isPicked ? '#18432f' : '#ffffff',
        weight: isPicked ? 4 : 1.5,
        fillColor: STATUS_INFO[st].color,
        fillOpacity: h.id === selectedId ? 0.35 : 1,
      };
      let m = markers.current.get(h.id);
      if (!m) {
        const dot = L.circleMarker([h.lat, h.lng], { ...style, renderer, bubblingMouseEvents: false });
        dot.on('click', () => {
          const u = uiRef.current;
          if (u.mode.kind === 'pick-house') {
            const person = u.data.people.find((x) => x.id === (u.mode as { personId: string }).personId);
            if (person) void linkToHouse(person, h.id).then(() => u.toast(`${person.full_name.split(' ')[0]} now lives at ${h.name || h.code}`));
            u.setMode({ kind: 'browse' });
            u.select(h.id);
          } else if (u.mode.kind === 'select') {
            const ids = u.mode.ids.includes(h.id) ? u.mode.ids.filter((x) => x !== h.id) : [...u.mode.ids, h.id];
            u.setMode({ kind: 'select', ids });
          } else if (u.mode.kind === 'browse') {
            u.select(h.id);
            const pt = map.latLngToContainerPoint([h.lat, h.lng]);
            const target = map.getSize().y * 0.24;
            if (pt.y > target + 40) map.panBy([0, pt.y - target], { duration: 0.35 });
          }
        });
        dot.addTo(g);
        m = { dot };
        markers.current.set(h.id, m);
      } else {
        const ll = m.dot.getLatLng();
        if (ll.lat !== h.lat || ll.lng !== h.lng) m.dot.setLatLng([h.lat, h.lng]);
        m.dot.setStyle(style);
        m.dot.setRadius(style.radius!);
      }
      // Ring around houses assigned to me
      const wantRing = myTaskHouses.has(h.id);
      if (wantRing && !m.ring) {
        m.ring = L.circleMarker([h.lat, h.lng], { radius: r + 5, color: '#18432f', weight: 2, fill: false, renderer, interactive: false }).addTo(g);
      } else if (!wantRing && m.ring) {
        m.ring.remove();
        m.ring = undefined;
      } else if (m.ring) {
        m.ring.setLatLng([h.lat, h.lng]);
        m.ring.setRadius(r + 5);
      }
    }
    for (const [id, m] of markers.current) {
      if (!seen.has(id)) {
        m.dot.remove();
        m.ring?.remove();
        markers.current.delete(id);
      }
    }
  }, [data, hidden, selectedId, zoom, myTaskHouses, picked, map]);

  return null;
}

/** The selected house gets a handle you can drag to shift the pin. */
function DragHandle() {
  const map = useMap();
  const { data, selectedId, mode, toast } = useUI();
  const house = selectedId ? data.houseById.get(selectedId) : undefined;
  const ref = useRef<L.Marker | null>(null);
  const canPlace = data.perms.canPlace;
  const status = house ? data.statusById.get(house.id) : undefined;

  useEffect(() => {
    if (!house || mode.kind !== 'browse') return;
    const color = STATUS_INFO[data.statusById.get(house.id)!].color;
    const icon = L.divIcon({
      className: 'drag-pin',
      html: `<span style="--c:${color}"><i></i></span>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
    const m = L.marker([house.lat, house.lng], { icon, draggable: true, autoPan: true, zIndexOffset: 1000, keyboard: false }).addTo(map);
    m.on('dragend', async () => {
      const p = m.getLatLng();
      if (!canPlace(p.lat, p.lng)) {
        m.setLatLng([house.lat, house.lng]);
        toast('That spot is outside your zone');
        return;
      }
      await moveHouse(house.id, p.lat, p.lng);
      toast('Pin moved');
    });
    ref.current = m;
    return () => void m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, house?.id, house?.lat, house?.lng, mode.kind, status]);
  return null;
}

/** Zone outline being drawn: tap a corner to remove it, drag it to move it. */
function DrawLayer() {
  const map = useMap();
  const { mode, setMode } = useUI();
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    if (mode.kind !== 'draw' || !mode.points.length) return;
    const g = L.layerGroup().addTo(map);
    const pts = mode.points;
    if (pts.length >= 3) L.polygon(pts, { color: '#12603a', weight: 2, fillOpacity: 0.12, dashArray: '4 6', interactive: false }).addTo(g);
    else L.polyline(pts, { color: '#12603a', weight: 2, dashArray: '4 6', interactive: false }).addTo(g);
    pts.forEach((p, i) => {
      const m = L.marker(p, {
        draggable: true,
        icon: L.divIcon({ className: 'corner', html: `<span>${i + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: 'Tap to remove, drag to move',
      }).addTo(g);
      const update = (points: [number, number][]) => {
        const cur = modeRef.current;
        if (cur.kind === 'draw') setMode({ ...cur, points });
      };
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        update(pts.filter((_, j) => j !== i));
      });
      m.on('dragend', () => {
        const ll = m.getLatLng();
        update(pts.map((q, j) => (j === i ? [ll.lat, ll.lng] : q)));
      });
    });
    return () => void g.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mode]);
  return null;
}

const CHURCH_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 9h4"/><path d="M12 7v5"/><path d="M14 22v-4a2 2 0 0 0-4 0v4"/><path d="M18 22V5.618a1 1 0 0 0-.553-.894l-4.553-2.277a2 2 0 0 0-1.788 0L6.553 4.724A1 1 0 0 0 6 5.618V22"/><path d="m18 7 3.447 1.724a1 1 0 0 1 .553.894V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-10.382a1 1 0 0 1 .553-.894L6 7"/></svg>';

/** The church, and a road route drawn to it. */
function ChurchLayer() {
  const map = useMap();
  const { church } = useBranding();
  const { route } = useUI();
  useEffect(() => {
    if (!church) return;
    const m = L.marker([church.lat, church.lng], {
      icon: L.divIcon({ className: 'church-pin', html: `<span>${CHURCH_SVG}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] }),
      zIndexOffset: 800,
      keyboard: false,
      interactive: false, // taps go to the map (e.g. when moving the church)
    })
      .bindTooltip(church.name, { permanent: true, direction: 'bottom', offset: [0, 18], className: 'zone-label' })
      .addTo(map);
    return () => void m.remove();
  }, [map, church]);
  useEffect(() => {
    if (!route) return;
    const g = L.layerGroup([
      L.polyline(route, { color: '#ffffff', weight: 8, opacity: 0.9, interactive: false }),
      L.polyline(route, { color: '#2b6cb0', weight: 4.5, opacity: 1, interactive: false }),
    ]).addTo(map);
    map.flyToBounds(L.latLngBounds(route), { paddingTopLeft: [30, 120], paddingBottomRight: [30, map.getSize().y * 0.6], maxZoom: 18, duration: 0.6 });
    return () => void g.remove();
  }, [map, route]);
  return null;
}

function MeLayer() {
  const map = useMap();
  const { me } = useUI();
  const ref = useRef<L.CircleMarker | null>(null);
  useEffect(() => {
    if (!me) return;
    if (!ref.current) {
      ref.current = L.circleMarker([me.lat, me.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#2b6cb0', fillOpacity: 1, renderer, interactive: false }).addTo(map);
    } else ref.current.setLatLng([me.lat, me.lng]);
  }, [map, me]);
  return null;
}

function MapController({ onMap }: { onMap: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    map.attributionControl?.setPrefix('<a href="https://leafletjs.com">Leaflet</a> | Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors');
  }, [map]);
  const { focus, mode, setMode, select, toast, data } = useUI();
  useEffect(() => onMap(map), [map, onMap]);
  useEffect(() => {
    if (!focus) return;
    if (focus.bounds) {
      const [s, w, n, e] = focus.bounds;
      map.flyToBounds([[s, w], [n, e]], { paddingTopLeft: [24, 130], paddingBottomRight: [24, 220], maxZoom: 17, duration: 0.7 });
      return;
    }
    const zoom = focus.zoom ?? Math.max(map.getZoom(), 18);
    const p = map.project([focus.lat, focus.lng], zoom).add([0, map.getSize().y * 0.26]);
    map.flyTo(map.unproject(p, zoom), zoom, { duration: 0.7 });
  }, [focus, map]);
  useMapEvents({
    async click(e) {
      const { lat, lng } = e.latlng;
      if (mode.kind === 'add') {
        if (!data.perms.canPlace(lat, lng)) return toast('That spot is outside your zone');
        const h = await newHouse(lat, lng);
        setMode({ kind: 'browse' });
        select(h.id);
        toast(`${h.code} added. Drag the pin to adjust.`);
      } else if (mode.kind === 'church') {
        setMode({ kind: 'browse' });
        try {
          await saveBranding({ church: { lat, lng, name: 'Church' } });
          toast('Church location saved');
        } catch (err) {
          toast((err as Error).message);
        }
      } else if (mode.kind === 'draw') {
        setMode({ ...mode, points: [...mode.points, [lat, lng]] });
      } else if (mode.kind === 'browse') select(null);
    },
    moveend(e) {
      const m = e.target as L.Map;
      const c = m.getCenter();
      localStorage.setItem('ffim.view', JSON.stringify({ lat: c.lat, lng: c.lng, zoom: m.getZoom() }));
    },
  });
  return null;
}

export function MapView({ visible }: { visible: boolean }) {
  const { data, mode, setMode, setMe, toast, openModal, setTab, selectedId, place, showPlace } = useUI();
  const [outlining, setOutlining] = useState(false);
  const [map, setMap] = useState<L.Map | null>(null);
  const [layerId, setLayerId] = useState<LayerId>(() => (localStorage.getItem('ffim.base') as LayerId) || 'map');
  const [hidden, setHidden] = useState<Set<Status>>(new Set());
  const watchId = useRef<number | null>(null);
  const initial = useMemo(savedView, []);
  const { perms } = data;

  useEffect(() => localStorage.setItem('ffim.base', layerId), [layerId]);
  useEffect(() => {
    if (visible && map) setTimeout(() => map.invalidateSize(), 50);
  }, [visible, map]);

  // First open with no saved view: frame my zones/houses, else find the user.
  const framed = useRef(false);
  useEffect(() => {
    if (!map || framed.current || initial || !data.ready) return;
    framed.current = true;
    const pts: [number, number][] = [
      ...data.zones.filter((z) => data.myZoneIds === null || data.myZoneIds.includes(z.id)).flatMap((z) => z.polygon),
      ...data.houses.map((h) => [h.lat, h.lng] as [number, number]),
    ];
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 18 });
    else locate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, data.ready]);

  function locate(quiet = false) {
    if (!navigator.geolocation) return toast('Location isn’t available on this device');
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    let first = true;
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setMe(pos);
        if (first) {
          first = false;
          map?.flyTo([pos.lat, pos.lng], Math.max(map.getZoom(), 17), { duration: 0.7 });
        }
      },
      () => !quiet && toast('Allow location access to see where you are'),
      { enableHighAccuracy: true, maximumAge: 15000 },
    );
  }

  const counts = useMemo(() => {
    const c: Record<Status, number> = { new: 0, due: 0, done: 0, member: 0, dnv: 0 };
    for (const st of data.statusById.values()) c[st]++;
    return c;
  }, [data.statusById]);

  const toggleStatus = (s: Status) =>
    setHidden((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });

  const browsing = mode.kind === 'browse';

  return (
    <div className={`map-wrap ${!browsing ? 'picking' : ''}`} style={{ visibility: visible ? 'visible' : 'hidden' }}>
      <MapContainer center={initial?.center ?? [20, 0]} zoom={initial?.zoom ?? 3} maxZoom={21} zoomControl={false} preferCanvas className="map">
        <BaseLayer id={layerId} />
        <ZoneLayer />
        <HouseLayer hidden={hidden} />
        <DragHandle />
        <DrawLayer />
        <PlaceLayer />
        <ChurchLayer />
        <MeLayer />
        <MapController onMap={setMap} />
      </MapContainer>

      <div className="map-top">
        <div className="row gap">
          <SearchBar />
          <SyncBadge />
        </div>
        {browsing && !selectedId && (
          <div className="legend">
            {data.alerts.total > 0 && (
              <button className="legend-chip alert" onClick={() => setTab('tasks')}>
                <ListChecks size={15} strokeWidth={2} />
                {data.alerts.total} {perms.isLead ? 'due' : 'tasks'}
              </button>
            )}
            {STATUS_ORDER.filter((s) => counts[s] > 0 || s !== 'dnv').map((s) => (
              <button key={s} className={`legend-chip ${hidden.has(s) ? 'off' : ''}`} onClick={() => toggleStatus(s)} aria-label={STATUS_INFO[s].label}>
                <span className="dot" style={{ background: STATUS_INFO[s].color }} />
                {STATUS_INFO[s].short}
                <b>{counts[s]}</b>
              </button>
            ))}
          </div>
        )}
      </div>

      {mode.kind === 'add' && (
        <div className="mode-bar">
          <span>Tap where the house is</span>
          <button className="icon-btn" onClick={() => setMode({ kind: 'browse' })} aria-label="Cancel">
            <X {...ICON} />
          </button>
        </div>
      )}

      {mode.kind === 'pick-house' && (
        <div className="mode-bar">
          <span>Tap the house where {mode.name.split(' ')[0]} lives</span>
          <button className="icon-btn" onClick={() => setMode({ kind: 'browse' })} aria-label="Cancel">
            <X {...ICON} />
          </button>
        </div>
      )}

      {mode.kind === 'church' && (
        <div className="mode-bar">
          <span>Tap the church building</span>
          <button className="icon-btn" onClick={() => setMode({ kind: 'browse' })} aria-label="Cancel">
            <X {...ICON} />
          </button>
        </div>
      )}

      {mode.kind === 'select' && (
        <div className="mode-bar">
          <span>{mode.ids.length ? `${mode.ids.length} selected` : 'Tap houses to select'}</span>
          <button className="icon-btn" onClick={() => setMode({ kind: 'browse' })} aria-label="Cancel">
            <X {...ICON} />
          </button>
          <button className="btn primary" disabled={!mode.ids.length} onClick={() => openModal(<AssignModal houseIds={mode.ids} onDone={() => setMode({ kind: 'browse' })} />)}>
            Assign
          </button>
        </div>
      )}

      {mode.kind === 'draw' && (
        <div className="mode-bar">
          {place?.kind === 'area' && place.osm && !mode.points.length ? (
            <button
              className="btn ghost small grow-btn"
              disabled={outlining}
              onClick={async () => {
                setOutlining(true);
                try {
                  const ring = await areaBoundary(place.osm!);
                  if (ring && ring.length >= 3) {
                    const zone = mode.zoneId ? data.zoneById.get(mode.zoneId) : undefined;
                    openModal(<ZoneForm zone={zone} polygon={ring} defaultName={place.name} />);
                    setMode({ kind: 'browse' });
                    showPlace(null);
                  } else toast(`No outline for ${place.name}. Tap its corners instead.`);
                } catch (e) {
                  toast((e as Error).message);
                } finally {
                  setOutlining(false);
                }
              }}
            >
              <Hexagon size={16} /> {outlining ? 'Loading…' : `Use ${place.name}`}
            </button>
          ) : (
            <span>{mode.points.length ? `${mode.points.length} corners. Tap one to remove it.` : 'Search an area, or tap its corners'}</span>
          )}
          <button className="icon-btn" disabled={!mode.points.length} onClick={() => setMode({ ...mode, points: mode.points.slice(0, -1) })} aria-label="Undo">
            <Undo2 {...ICON} />
          </button>
          <button className="icon-btn" onClick={() => setMode({ kind: 'browse' })} aria-label="Cancel">
            <X {...ICON} />
          </button>
          <button
            className="btn primary"
            disabled={mode.points.length < 3}
            onClick={() => {
              const zone = mode.zoneId ? data.zoneById.get(mode.zoneId) : undefined;
              openModal(<ZoneForm zone={zone} polygon={mode.points} />);
              setMode({ kind: 'browse' });
            }}
          >
            <Check {...ICON} />
          </button>
        </div>
      )}

      {browsing && !selectedId && (
        <>
          <div className={`fab-stack ${place ? 'hidden' : ''}`}>
            <button className="fab" onClick={() => locate()} aria-label="Show my location" title="My location">
              <LocateFixed {...ICON} />
            </button>
            {perms.isLead && (
              <button
                className="fab"
                title="Find houses"
                aria-label="Find houses automatically"
                onClick={() => {
                  if (map) openModal(<FindHousesModal bounds={map.getBounds()} />);
                }}
              >
                <Sparkles {...ICON} />
              </button>
            )}
            {perms.assign && (
              <button className="fab" title="Select houses to assign" aria-label="Select houses to assign" onClick={() => setMode({ kind: 'select', ids: [] })}>
                <ListChecks {...ICON} />
              </button>
            )}
          </div>
          <button className={`view-switch ${place ? 'hidden' : ''}`} onClick={() => setLayerId(layerId === 'map' ? 'satellite' : 'map')} aria-label={`Switch to ${layerId === 'map' ? 'satellite' : 'map'} view`}>
            <span className={`vs-thumb ${layerId === 'map' ? 'sat' : 'map'}`} />
            <span>{layerId === 'map' ? 'Satellite' : 'Map'}</span>
          </button>
          <button className={`add-btn ${place ? 'hidden' : ''}`} onClick={() => setMode({ kind: 'add' })}>
            <Plus size={20} strokeWidth={2.2} /> Add house
          </button>
        </>
      )}
    </div>
  );
}
