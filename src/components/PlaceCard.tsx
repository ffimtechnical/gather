import { Church, Hexagon, MapPin, Navigation, Plus, X } from 'lucide-react';
import { saveBranding } from '../branding';
import { useState } from 'react';
import { newHouse } from '../db';
import { areaBoundary } from '../geocode';
import { ICON } from '../icons';
import { Action, useUI } from '../ui';
import { directionsUrl } from '../util';
import { ZoneForm } from './ZoneForm';

/** Card for a place found with search: add a house there, turn an area into a zone, or get directions. */
export function PlaceCard() {
  const { place, showPlace, data, select, toast, openModal, setMode } = useUI();
  const [busy, setBusy] = useState(false);
  if (!place) return null;
  const canAdd = data.perms.canPlace(place.lat, place.lng);

  async function makeZone() {
    if (!place) return;
    if (place.osm) {
      setBusy(true);
      try {
        const ring = await areaBoundary(place.osm);
        if (ring && ring.length >= 3) {
          openModal(<ZoneForm polygon={ring} defaultName={place.name} />);
          return;
        }
      } catch (e) {
        toast((e as Error).message);
      } finally {
        setBusy(false);
      }
    }
    toast(`No outline for ${place.name} on OpenStreetMap. Tap its corners instead.`);
    setMode({ kind: 'draw', points: [] });
  }

  return (
    <div className="sheet place-card">
      <div className="sheet-body">
        <header className="house-head">
          <span className="place-icon">
            <MapPin {...ICON} />
          </span>
          <div className="grow">
            <h2>{place.name}</h2>
            {place.detail && <div className="meta">{place.detail}</div>}
          </div>
          <button className="icon-btn" onClick={() => showPlace(null)} aria-label="Close">
            <X {...ICON} />
          </button>
        </header>
        <div className="actions">
          {place.kind !== 'area' && (
            <Action
              icon={Plus}
              label="Add house"
              disabled={!canAdd}
              onClick={async () => {
                const h = await newHouse(place.lat, place.lng, { name: place.kind === 'landmark' ? place.name : null });
                showPlace(null);
                select(h.id);
                toast(`${h.code} added. Drag the pin to adjust.`);
              }}
            />
          )}
          {data.perms.manageZones && place.kind === 'area' && <Action icon={Hexagon} label={busy ? 'Loading…' : 'Make zone'} disabled={busy} onClick={() => void makeZone()} />}
          {data.perms.isAdmin && place.kind !== 'area' && (
            <Action
              icon={Church}
              label="Set as church"
              onClick={async () => {
                try {
                  await saveBranding({ church: { lat: place.lat, lng: place.lng, name: place.kind === 'landmark' ? place.name : 'Church' } });
                  toast('Church location saved');
                  showPlace(null);
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            />
          )}
          <Action icon={Navigation} label="Go" href={directionsUrl(place.lat, place.lng)} />
        </div>
        {!canAdd && place.kind !== 'area' && <p className="muted small">This spot is outside your zone.</p>}
      </div>
    </div>
  );
}
