import { Check, CircleOff, Copy, House, MapPinPlus } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ICON } from '../icons';
import { pointInPolygon as zoneOf } from '../../shared/model';
import { addBuildings, planTidy, removePins, type TidyPlan } from '../osm';
import { Chips, Modal, useUI } from '../ui';

/**
 * Checks automatically added pins against the building data: removes pins that aren't on a
 * building and second pins on the same building, and adds buildings that were missed.
 * Pins anyone has worked with (visits, people, tasks, notes, marks) are never removed.
 */
export function TidyPinsModal() {
  const { data, closeModal, toast } = useUI();
  const [plan, setPlan] = useState<TidyPlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [pick, setPick] = useState({ notBuildings: true, doubles: true, missing: true });
  const [busy, setBusy] = useState(false);
  const zones = data.zones.filter((z) => z.polygon.length >= 3 && (data.myZoneIds === null || data.myZoneIds.includes(z.id)));
  const [scope, setScope] = useState<string>('all');
  const pins = useMemo(() => (scope === 'all' ? data.houses : data.houses.filter((h) => h.zone_id === scope)), [scope, data.houses]);

  const used = useMemo(() => {
    const s = new Set<string>();
    for (const p of data.people) if (p.house_id) s.add(p.house_id);
    for (const v of data.visits) s.add(v.house_id);
    for (const t of data.tasks) if (!t.deleted) s.add(t.house_id);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    setPlan(null);
    setErr(null);
    setProgress(null);
    const zone = zones.find((z) => z.id === scope);
    const inside = zone ? (lat: number, lng: number) => data.perms.canPlace(lat, lng) && zoneOf(lat, lng, zone.polygon) : data.perms.canPlace;
    planTidy(pins, used, { inside, onProgress: (d, t) => alive && setProgress([d, t]) })
      .then((p) => alive && setPlan(p))
      .catch((e) => alive && setErr(e.message || 'Could not load building data. Check your connection and try again.'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const remove = plan ? [...(pick.notBuildings ? plan.notBuildings : []), ...(pick.doubles ? plan.doubles : [])] : [];
  const add = plan && pick.missing ? plan.missing : [];
  const nothing = plan && !plan.notBuildings.length && !plan.doubles.length && !plan.missing.length;

  return (
    <Modal title="Tidy up pins" onClose={closeModal}>
      <div className="form">
        {zones.length > 0 && (
          <Chips options={[{ value: 'all', label: 'All my pins' }, ...zones.map((z) => ({ value: z.id, label: z.name }))]} value={scope} onChange={setScope} />
        )}
        {err ? (
          <p className="error">{err}</p>
        ) : !plan ? (
          <div className="find-result">
            <div className="grow">
              <p className="muted">Checking {pins.length.toLocaleString()} pins against building outlines…</p>
              {progress && progress[1] > 1 && (
                <div className="progress">
                  <div style={{ width: `${(progress[0] / progress[1]) * 100}%` }} />
                </div>
              )}
            </div>
          </div>
        ) : nothing ? (
          <div className="find-result">
            <p className="muted">
              <Check {...ICON} /> Every pin is on its own building.
            </p>
          </div>
        ) : (
          <div className="tidy-list">
            <TidyRow icon={<CircleOff {...ICON} />} n={plan.notBuildings.length} on={pick.notBuildings} onChange={(v) => setPick({ ...pick, notBuildings: v })}>
              not on a building <small>Remove</small>
            </TidyRow>
            <TidyRow icon={<Copy {...ICON} />} n={plan.doubles.length} on={pick.doubles} onChange={(v) => setPick({ ...pick, doubles: v })}>
              extra pins on the same building <small>Remove</small>
            </TidyRow>
            <TidyRow icon={<MapPinPlus {...ICON} />} n={plan.missing.length} on={pick.missing} onChange={(v) => setPick({ ...pick, missing: v })}>
              homes without a pin <small>Add</small>
            </TidyRow>
          </div>
        )}
        {plan && plan.kept > 0 && (
          <p className="muted small inline-icons">
            <House size={14} /> {plan.kept.toLocaleString()} pins you’ve worked with (visits, people, notes, marks) are kept as they are.
          </p>
        )}
        <div className="form-actions">
          <span className="grow" />
          <button
            className="btn primary"
            disabled={!plan || busy || (!remove.length && !add.length)}
            onClick={async () => {
              setBusy(true);
              const removed = remove.length ? await removePins(remove) : 0;
              const added = add.length ? await addBuildings(add) : 0;
              closeModal();
              toast([removed && `${removed.toLocaleString()} removed`, added && `${added.toLocaleString()} added`].filter(Boolean).join(', ') || 'Nothing changed');
            }}
          >
            {busy ? 'Working…' : 'Apply'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TidyRow({ icon, n, on, onChange, children }: { icon: ReactNode; n: number; on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  if (!n) return null;
  return (
    <button type="button" className={`tidy-row ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on}>
      {icon}
      <span className="grow">
        <b>{n.toLocaleString()}</b> {children}
      </span>
      <span className="check">{on && <Check size={16} strokeWidth={2.5} />}</span>
    </button>
  );
}
