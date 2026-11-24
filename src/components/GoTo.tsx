import { Church, Home, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useBranding } from '../branding';
import { ICON_SM } from '../icons';
import { useUI } from '../ui';

/** Quick jumps on the map: the church, each of my zones, all my houses. */
export function GoToMenu({ onClose }: { onClose: () => void }) {
  const { data, flyTo, fitZone, fitArea } = useUI();
  const { church } = useBranding();
  const ref = useRef<HTMLDivElement>(null);
  const zones = data.zones.filter((z) => z.polygon.length >= 3 && (data.myZoneIds === null || data.myZoneIds.includes(z.id)));

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.('[data-goto]')) onClose();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);

  const go = (fn: () => void) => {
    fn();
    onClose();
  };

  return (
    <div className="goto-menu" ref={ref} role="menu" aria-label="Go to">
      <div className="goto-head">
        <b>Go to</b>
        <button className="icon-btn small" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      {church && (
        <button role="menuitem" className="goto-item" onClick={() => go(() => flyTo(church.lat, church.lng, 18))}>
          <span className="goto-icon church">
            <Church {...ICON_SM} />
          </span>
          <span className="grow">{church.name || 'Church'}</span>
        </button>
      )}
      {zones.map((z) => (
        <button key={z.id} role="menuitem" className="goto-item" onClick={() => go(() => fitZone(z.id))}>
          <span className="goto-icon" style={{ background: z.color }} />
          <span className="grow">{z.name}</span>
          <small>{data.houses.filter((h) => h.zone_id === z.id).length.toLocaleString()}</small>
        </button>
      ))}
      {data.houses.length > 0 && (
        <button role="menuitem" className="goto-item" onClick={() => go(() => fitArea(data.houses.map((h) => [h.lat, h.lng])))}>
          <span className="goto-icon plain">
            <Home {...ICON_SM} />
          </span>
          <span className="grow">All my houses</span>
        </button>
      )}
      {!church && !zones.length && !data.houses.length && <p className="muted small goto-empty">No church or zones yet.</p>}
    </div>
  );
}
