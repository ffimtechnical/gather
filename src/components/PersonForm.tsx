import { Heart, Home, MessageSquare, Phone, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AGE_GROUPS, type Person } from '../../shared/model';
import { linkToHouse, save, setMember } from '../db';
import { ICON } from '../icons';
import { Chips, Field, Modal, Toggle, nul, useUI } from '../ui';
import { phoneLinks, todayStr } from '../util';
import { MemberSuggest } from './MemberSuggest';

export function PersonForm({ person, isNew = false }: { person: Person; isNew?: boolean }) {
  const ui = useUI();
  const { closeModal, toast, data, showHouse, setMode, setTab } = ui;
  const [p, setP] = useState(person);
  const up = (patch: Partial<Person>) => setP({ ...p, ...patch });
  const house = p.house_id ? data.houseById.get(p.house_id) : undefined;

  /** Picked someone already on the list: link them to this house instead of creating a duplicate. */
  async function useExisting(existing: Person) {
    if (!p.house_id) return;
    const from = existing.house_id ? data.houseById.get(existing.house_id) : undefined;
    if (from && !confirm(`${existing.full_name} is listed at ${from.name || from.code}. Move them to this house?`)) return;
    await linkToHouse(existing, p.house_id);
    toast(`${existing.full_name.split(' ')[0]} added to this house`);
    closeModal();
  }

  return (
    <Modal title={isNew ? (p.house_id ? 'Add person' : 'Add member') : p.full_name || 'Person'} onClose={closeModal}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!p.full_name.trim()) return toast('Add a name');
          const saved = { ...p, full_name: p.full_name.trim() };
          await save('people', saved);
          closeModal();
          const first = saved.full_name.split(' ')[0];
          if (isNew && !saved.is_member) {
            // Typed in by hand: offer to put them on the members list
            toast(`${first} saved. Add to members list?`, [{ label: 'Add as member', run: () => void setMember(saved, true).then(() => toast(`${first} is now a member`)) }]);
          } else toast(isNew ? `${first} added` : 'Saved');
        }}
      >
        {house && <p className="muted small">Lives at {house.name || house.address || house.code}</p>}
        <input
          className="big-input"
          value={p.full_name}
          onChange={(e) => up({ full_name: e.target.value })}
          placeholder={isNew && p.house_id ? 'Name (search your members list)' : 'Full name'}
          aria-label="Full name"
          autoFocus={isNew}
        />
        {isNew && p.house_id && <MemberSuggest query={p.full_name || p.phone || ''} houseId={p.house_id} onPick={(m) => void useExisting(m)} />}
        <div className="input-with-actions">
          <input type="tel" inputMode="tel" value={p.phone ?? ''} onChange={(e) => up({ phone: nul(e.target.value) })} placeholder="Phone, e.g. +233…" aria-label="Phone" />
          {p.phone && (
            <>
              <a className="icon-btn" href={phoneLinks(p.phone).tel} aria-label="Call">
                <Phone {...ICON} />
              </a>
              <a className="icon-btn" href={phoneLinks(p.phone).whatsapp} target="_blank" rel="noreferrer" aria-label="WhatsApp">
                <MessageSquare {...ICON} />
              </a>
            </>
          )}
        </div>
        <Toggle
          icon={Heart}
          checked={p.is_member}
          onChange={(v) => up({ is_member: v, member_since: v ? p.member_since ?? todayStr() : p.member_since })}
          label="Church member"
        />
        {!p.house_id && !isNew && (
          <button
            type="button"
            className="toggle"
            onClick={() => {
              closeModal();
              setTab('map');
              setMode({ kind: 'pick-house', personId: p.id, name: p.full_name });
            }}
          >
            <Home {...ICON} />
            <span className="grow">Not on the map yet. Pick their house</span>
          </button>
        )}
        <Toggle icon={ShieldCheck} checked={p.consent_contact} onChange={(v) => up({ consent_contact: v })} label="Happy to be contacted" />
        <Chips options={AGE_GROUPS} value={p.age_group} onChange={(age_group) => up({ age_group: p.age_group === age_group ? null : age_group })} />
        <Field label="Prayer requests">
          <textarea rows={2} value={p.prayer_requests ?? ''} onChange={(e) => up({ prayer_requests: nul(e.target.value) })} />
        </Field>
        <details className="advanced">
          <summary>More details</summary>
          <input type="email" inputMode="email" value={p.email ?? ''} onChange={(e) => up({ email: nul(e.target.value) })} placeholder="Email" aria-label="Email" />
          <Chips
            options={[
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
            ]}
            value={p.gender}
            onChange={(gender) => up({ gender: p.gender === gender ? null : gender })}
          />
          {p.is_member && (
            <Field label="Member since">
              <input type="date" value={p.member_since ?? ''} onChange={(e) => up({ member_since: nul(e.target.value) })} />
            </Field>
          )}
          <textarea rows={2} value={p.notes ?? ''} onChange={(e) => up({ notes: nul(e.target.value) })} placeholder="Notes" aria-label="Notes" />
          <input value={p.external_member_id ?? ''} onChange={(e) => up({ external_member_id: nul(e.target.value) })} placeholder="ID in member system" aria-label="ID in member system" />
        </details>
        <div className="form-actions">
          {!isNew && (
            <button
              type="button"
              className="icon-btn danger"
              aria-label="Delete person"
              onClick={async () => {
                if (!confirm(`Remove ${p.full_name}?`)) return;
                await save('people', { ...p, deleted: true });
                toast('Removed');
                closeModal();
              }}
            >
              <Trash2 {...ICON} />
            </button>
          )}
          {house && !isNew && (
            <button type="button" className="btn ghost" onClick={() => showHouse(house.id)}>
              {house.code}
            </button>
          )}
          <span className="grow" />
          <button className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  );
}
