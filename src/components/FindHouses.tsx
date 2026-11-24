import type L from 'leaflet';
import { Home } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { pointInPolygon } from '../../shared/model';
import { addBuildings, areaSize, findBuildings, notYetPinned, type FoundBuilding } from '../osm';
import { Chips, Modal, Toggle, useUI } from '../ui';
import type { Bounds } from '../vtiles';

export function FindHousesModal({ bounds }: { bounds: L.LatLngBounds }) {
  const { closeModal, toast, data } = useUI();
  const myZones = data.zones.filter((z) => z.polygon.length >= 3 && (data.myZoneIds === null || data.myZoneIds.includes(z.id)));
  const [scope, setScope] = useState<string>('screen');
  const [homesOnly, setHomesOnly] = useState(true);
  const [found, setFound] = useState<FoundBuilding[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);

  const area = useMemo((): { b: Bounds; inside: (lat: number, lng: number) => boolean } => {
    const zone = myZones.find((z) => z.id === scope);
    if (zone) {
      const lats = zone.polygon.map((p) => p[0]), lngs = zone.polygon.map((p) => p[1]);
      return {
        b: { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lngs), east: Math.max(...lngs) },
        inside: (lat, lng) => pointInPolygon(lat, lng, zone.polygon),
      };
    }
    return {
      b: { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() },
      inside: data.perms.canPlace,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const [tooBig, setTooBig] = useState(false);
  useEffect(() => {
    let alive = true;
    setFound(null);
    setErr(null);
    setTooBig(false);
    setProgress(null);
    areaSize(area.b)
      .then(({ tooBig: big }) => {
        if (!alive) return;
        if (big) {
          // the screen is too big: suggest the first zone instead
          if (scope === 'screen' && myZones[0]) setScope(myZones[0].id);
          else setTooBig(true);
          return;
        }
        return findBuildings(area.b, { homesOnly, inside: area.inside, onProgress: (d, t) => alive && setProgress([d, t]) })
          .then((f) => alive && setFound(f));
      })
      .catch((e) => alive && setErr(e.message || 'Could not load building data. Check your connection and try again.'));
    return () => {
      alive = false;
    };
  }, [area, homesOnly]);

  const fresh = useMemo(() => (found ? notYetPinned(found, data.houses) : []), [found, data.houses]);
  const already = (found?.length ?? 0) - fresh.length;

  return (
    <Modal title="Find houses" onClose={closeModal}>
      <div className="form">
        {myZones.length > 0 && (
          <Chips options={[{ value: 'screen', label: 'On screen' }, ...myZones.map((z) => ({ value: z.id, label: z.name }))]} value={scope} onChange={setScope} />
        )}
        <Toggle icon={Home} checked={homesOnly} onChange={setHomesOnly} label="Homes only (skip sheds and big buildings)" />
        <div className="find-result">
          {tooBig ? (
            <p className="error">That area is too big. Zoom in or pick a zone.</p>
          ) : err ? (
            <p className="error">{err}</p>
          ) : !found ? (
            <div className="grow">
              <p className="muted">Loading building data…</p>
              {progress && progress[1] > 1 && (
                <div className="progress">
                  <div style={{ width: `${(progress[0] / progress[1]) * 100}%` }} />
                </div>
              )}
            </div>
          ) : fresh.length === 0 ? (
            <p className="muted">{already ? `All ${already} buildings here are already on your map.` : 'No buildings found here.'}</p>
          ) : (
            <p className="big-number">
              <b>{fresh.length.toLocaleString()}</b>
              <small>new buildings found{already ? `, ${already} already on your map` : ''}</small>
            </p>
          )}
        </div>
        <p className="muted small">Buildings from OpenStreetMap, Google and Microsoft, checked so each building gets one pin. Buildings that already have a pin are skipped.</p>
        <div className="form-actions">
          <span className="grow" />
          <button
            className="btn primary"
            disabled={!fresh.length || busy}
            onClick={async () => {
              setBusy(true);
              const n = await addBuildings(fresh);
              closeModal();
              toast(n ? `${n.toLocaleString()} houses added` : 'All of these are already on your map');
            }}
          >
            {busy ? 'Adding…' : 'Add to map'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
