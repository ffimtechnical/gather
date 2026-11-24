import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { OUTCOMES, VISIT_KINDS, type House, type Visit, type VisitKind } from '../../shared/model';
import { blankPerson, completeMyTasks, db, linkToHouse, save } from '../db';
import { MemberSuggest } from './MemberSuggest';
import { ICON, KIND_ICON, OUTCOME_ICON } from '../icons';
import { Chips, Field, Modal, nul, useUI } from '../ui';
import { toLocalInput, todayStr } from '../util';

const NEXT = [
  { value: 'keep', label: 'No change' },
  { value: '7', label: '1 week' },
  { value: '14', label: '2 weeks' },
  { value: '30', label: '1 month' },
  { value: 'pick', label: 'Date' },
] as const;

export function VisitForm({ visit, house, isNew = false }: { visit: Visit; house: House; isNew?: boolean }) {
  const { closeModal, toast, data } = useUI();
  const people = data.peopleByHouse.get(house.id) ?? [];
  const [v, setV] = useState(visit);
  const up = (p: Partial<Visit>) => setV({ ...v, ...p });
  const [who, setWho] = useState<string>(v.person_id ?? (isNew && !people.length ? 'new' : ''));
  const [np, setNp] = useState({ name: '', phone: '' });
  const [next, setNext] = useState<string>('keep');
  const [nextDate, setNextDate] = useState(house.next_visit_on ?? todayStr(7));

  async function submit() {
    let person_id: string | null = who && who !== 'new' ? who : null;
    if (who === 'new' && np.name.trim()) {
      const p = { ...blankPerson(house.id), full_name: np.name.trim(), phone: nul(np.phone) };
      await save('people', p);
      person_id = p.id;
    }
    await save('visits', { ...v, person_id });
    if (isNew) await completeMyTasks(house.id);
    if (next !== 'keep') {
      const nv = next === 'pick' ? nextDate || null : todayStr(Number(next));
      const fresh = await db.houses.get(house.id);
      if (fresh && nv !== fresh.next_visit_on) await save('houses', { ...fresh, next_visit_on: nv });
    }
    toast(isNew ? 'Visit logged' : 'Visit saved');
    closeModal();
  }

  return (
    <Modal title={isNew ? 'Log visit' : 'Visit'} onClose={closeModal}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Chips<VisitKind> options={VISIT_KINDS} icons={KIND_ICON} value={v.kind} onChange={(kind) => up({ kind })} />

        <div className="outcome-grid">
          {OUTCOMES.map((o) => {
            const Icon = OUTCOME_ICON[o.value];
            return (
              <button type="button" key={o.value} className={`og ${v.outcome === o.value ? 'active' : ''}`} onClick={() => up({ outcome: o.value })}>
                <Icon {...ICON} />
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>

        {v.outcome !== 'not_home' && (
          <Field label="Spoke with">
            <div className="chips">
              {people.map((p) => (
                <button type="button" key={p.id} className={`chip ${who === p.id ? 'active' : ''}`} onClick={() => setWho(who === p.id ? '' : p.id)}>
                  {p.full_name || 'Unnamed'}
                </button>
              ))}
              <button type="button" className={`chip ${who === 'new' ? 'active' : ''}`} onClick={() => setWho(who === 'new' ? '' : 'new')}>
                New person
              </button>
            </div>
          </Field>
        )}
        {who === 'new' && v.outcome !== 'not_home' && (
          <>
            <div className="two-col">
              <input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} placeholder="Name" aria-label="Name" />
              <input type="tel" inputMode="tel" value={np.phone} onChange={(e) => setNp({ ...np, phone: e.target.value })} placeholder="+233…" aria-label="Phone" />
            </div>
            <MemberSuggest
              query={np.name || np.phone}
              houseId={house.id}
              onPick={async (m) => {
                await linkToHouse(m, house.id);
                setWho(m.id);
                setNp({ name: '', phone: '' });
              }}
            />
          </>
        )}

        <Field label="Notes">
          <textarea rows={3} value={v.notes ?? ''} onChange={(e) => up({ notes: nul(e.target.value) })} placeholder="Prayer points, needs, next step…" />
        </Field>

        <Field label="Go back in">
          <Chips options={NEXT.map((n) => ({ value: n.value, label: n.label }))} value={next} onChange={setNext} />
          {next === 'pick' && <input type="date" value={nextDate} min={todayStr()} onChange={(e) => setNextDate(e.target.value)} />}
        </Field>

        <details className="advanced">
          <summary>Time and visitor</summary>
          <div className="two-col">
            <input type="datetime-local" value={toLocalInput(v.visited_at)} onChange={(e) => e.target.value && up({ visited_at: new Date(e.target.value).toISOString() })} aria-label="When" />
            <input value={v.visited_by ?? ''} onChange={(e) => up({ visited_by: nul(e.target.value) })} placeholder="Visited by" aria-label="Visited by" />
          </div>
        </details>

        <div className="form-actions">
          {!isNew && (
            <button
              type="button"
              className="icon-btn danger"
              aria-label="Delete visit"
              onClick={async () => {
                if (!confirm('Delete this visit?')) return;
                await save('visits', { ...v, deleted: true });
                toast('Visit deleted');
                closeModal();
              }}
            >
              <Trash2 {...ICON} />
            </button>
          )}
          <span className="grow" />
          <button className="btn primary" disabled={!v.outcome}>
            {isNew ? 'Log visit' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
