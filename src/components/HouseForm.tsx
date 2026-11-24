import { Ban, Heart, Minus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { House } from '../../shared/model';
import { db, deleteHouse, save } from '../db';
import { ICON } from '../icons';
import { Field, Modal, Toggle, nul, useUI } from '../ui';
import { todayStr } from '../util';

export function HouseForm({ house, onDeleted }: { house: House; onDeleted?: () => void }) {
  const { toast, closeModal, data } = useUI();
  const [f, setF] = useState(house);
  const up = (patch: Partial<House>) => setF({ ...f, ...patch });
  return (
    <Modal title={`Edit ${house.code}`} onClose={closeModal}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const fresh = (await db.houses.get(house.id)) ?? house;
          // keep the latest position (the pin may have been dragged meanwhile)
          await save('houses', { ...f, lat: fresh.lat, lng: fresh.lng, zone_id: fresh.zone_id });
          toast('Saved');
          closeModal();
        }}
      >
        <Field label="Name or landmark">
          <input value={f.name ?? ''} onChange={(e) => up({ name: nul(e.target.value) })} placeholder="Blue gate, The Mensahs…" />
        </Field>
        <Field label="Address">
          <input value={f.address ?? ''} onChange={(e) => up({ address: nul(e.target.value) })} />
        </Field>
        <Field label="People living here">
          <div className="stepper">
            <button type="button" aria-label="Fewer" onClick={() => up({ household_size: Math.max(0, (f.household_size ?? 0) - 1) })}>
              <Minus {...ICON} />
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={f.household_size ?? ''}
              onChange={(e) => up({ household_size: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value) || 0) })}
            />
            <button type="button" aria-label="More" onClick={() => up({ household_size: (f.household_size ?? 0) + 1 })}>
              <Plus {...ICON} />
            </button>
          </div>
        </Field>
        <Toggle icon={Heart} checked={f.is_member_household} onChange={(v) => up({ is_member_household: v })} label="Member household" />
        <Toggle icon={Ban} checked={f.do_not_visit} onChange={(v) => up({ do_not_visit: v })} label="Do not visit" />
        <Field label="Next visit">
          <input type="date" value={f.next_visit_on ?? ''} min={todayStr()} onChange={(e) => up({ next_visit_on: nul(e.target.value) })} />
        </Field>
        <Field label="Notes">
          <textarea rows={3} value={f.description ?? ''} onChange={(e) => up({ description: nul(e.target.value) })} />
        </Field>
        <details className="advanced">
          <summary>Advanced</summary>
          <Field label="ID in member system">
            <input value={f.external_ref ?? ''} onChange={(e) => up({ external_ref: nul(e.target.value) })} />
          </Field>
          <p className="muted small">
            Record ID <code>{house.id}</code>
          </p>
        </details>
        <div className="form-actions">
          {data.perms.deleteHouses && (
            <button
              type="button"
              className="icon-btn danger"
              aria-label="Delete house"
              onClick={async () => {
                if (!confirm(`Delete ${house.code} with its people and visits?`)) return;
                await deleteHouse(house.id);
                toast('House deleted');
                closeModal();
                onDeleted?.();
              }}
            >
              <Trash2 {...ICON} />
            </button>
          )}
          <span className="grow" />
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
