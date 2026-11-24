import { Check, PenLine, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ZONE_COLORS, type Zone } from '../../shared/model';
import { base, reassignZones, save, uuid } from '../db';
import { ICON } from '../icons';
import { Avatar, Field, Modal, nul, useUI } from '../ui';

export function ZoneForm({ zone, polygon, defaultName }: { zone?: Zone; polygon?: [number, number][]; defaultName?: string }) {
  const { data, closeModal, toast, setMode, setTab } = useUI();
  const [z, setZ] = useState<Zone>(
    () =>
      zone ?? {
        id: uuid(),
        name: defaultName ?? '',
        color: ZONE_COLORS[data.zones.length % ZONE_COLORS.length],
        polygon: [],
        pastor_id: null,
        notes: null,
        ...base(),
      },
  );
  const up = (p: Partial<Zone>) => setZ({ ...z, ...p });
  const shape = polygon ?? z.polygon;
  const pastors = data.users.filter((u) => u.active && u.role !== 'member');
  const houses = data.houses.filter((h) => h.zone_id === z.id).length;

  return (
    <Modal title={zone ? zone.name : 'New zone'} onClose={closeModal}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!z.name.trim()) return toast('Give the zone a name');
          if (shape.length < 3) return toast('Draw the zone on the map first');
          await save('zones', { ...z, name: z.name.trim(), polygon: shape });
          const moved = await reassignZones();
          toast(moved ? `Zone saved, ${moved} houses updated` : 'Zone saved');
          closeModal();
        }}
      >
        <input className="big-input" value={z.name} onChange={(e) => up({ name: e.target.value })} placeholder="Zone name" aria-label="Zone name" autoFocus={!zone} />
        <div className="swatches" role="radiogroup" aria-label="Colour">
          {ZONE_COLORS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={z.color === c} className={`sw ${z.color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => up({ color: c })}>
              {z.color === c && <Check size={16} strokeWidth={3} />}
            </button>
          ))}
        </div>
        <Field label="Zone pastor">
          <div className="people-picker">
            {pastors.map((u) => (
              <button key={u.id} type="button" className={`pp ${z.pastor_id === u.id ? 'active' : ''}`} onClick={() => up({ pastor_id: z.pastor_id === u.id ? null : u.id })}>
                <span className="pp-av">
                  <Avatar user={u} size={44} />
                  {z.pastor_id === u.id && (
                    <span className="pp-check">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span>{u.name.split(' ')[0]}</span>
              </button>
            ))}
            {!pastors.length && <p className="muted small">Add a zone pastor under Team first.</p>}
          </div>
        </Field>
        <textarea rows={2} value={z.notes ?? ''} onChange={(e) => up({ notes: nul(e.target.value) })} placeholder="Notes" aria-label="Notes" />
        <div className="form-actions">
          {zone && (
            <button
              type="button"
              className="icon-btn danger"
              aria-label="Delete zone"
              onClick={async () => {
                if (!confirm(`Delete zone ${zone.name}? Its houses stay on the map.`)) return;
                await save('zones', { ...zone, deleted: true });
                await reassignZones();
                toast('Zone deleted');
                closeModal();
              }}
            >
              <Trash2 {...ICON} />
            </button>
          )}
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              closeModal();
              setTab('map');
              setMode({ kind: 'draw', zoneId: z.id, points: shape.length <= 60 ? shape : [] });
            }}
          >
            <PenLine size={16} /> {shape.length ? 'Edit shape' : 'Draw'}
          </button>
          {zone && <span className="muted small">{houses} houses</span>}
          <span className="grow" />
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
