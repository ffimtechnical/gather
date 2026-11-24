/** Common one-tap actions shared by several screens. */
import { createElement } from 'react';
import { OUTCOMES, type House, type Person, type Status, type Visit, type VisitKind } from '../shared/model';
import { blankPerson, blankVisit, completeMyTasks, db, save, saveRows, setMember } from './db';
import type { UIState } from './ui';
import { PersonForm } from './components/PersonForm';
import { VisitForm } from './components/VisitForm';

export function kindFor(status: Status | undefined): VisitKind {
  return status === 'member' ? 'member_care' : status === 'new' ? 'evangelism' : 'follow_up';
}

/** Log a visit with one tap. Completes my tasks at the house; offers Undo. */
export async function quickLog(ui: UIState, house: House, outcome: string) {
  const v: Visit = { ...blankVisit(house.id), kind: kindFor(ui.data.statusById.get(house.id)), outcome };
  await save('visits', v);
  const done = await completeMyTasks(house.id);
  const label = OUTCOMES.find((o) => o.value === outcome)?.label ?? 'Visit';
  const hasPeople = (ui.data.peopleByHouse.get(house.id) ?? []).length > 0;
  const spoke = outcome !== 'not_home';
  if (!spoke) {
    // "Not home" can also mean nobody lives there at all: one tap to mark it empty
    ui.toast(`${label} logged`, [
      { label: 'Undo', run: () => void undoVisit(v, done) },
      { label: 'House is empty', run: () => void markVacant(ui, house, true, v) },
    ]);
    return;
  }
  ui.toast(`${label} logged`, [
    {
      label: 'Undo',
      run: async () => {
        await save('visits', { ...v, deleted: true });
        await saveRows('tasks', done.map((t) => ({ ...t, status: 'open' as const, done_at: null })));
      },
    },
    spoke && !hasPeople
      ? { label: 'Add contact', run: () => ui.openModal(createElement(PersonForm, { person: blankPerson(house.id), isNew: true })) }
      : { label: 'Add note', run: () => ui.openModal(createElement(VisitForm, { visit: v, house })) },
  ]);
}

async function undoVisit(v: Visit, done: Awaited<ReturnType<typeof completeMyTasks>>) {
  await save('visits', { ...v, deleted: true });
  await saveRows('tasks', done.map((t) => ({ ...t, status: 'open' as const, done_at: null })));
}

/**
 * Marks a house as empty (nobody lives there) or lived-in again, with Undo.
 * `visit`: the "not home" visit just logged, recorded as "empty house" instead.
 */
export async function markVacant(ui: UIState, house: House, vacant: boolean, visit?: Visit) {
  const fresh = (await db.houses.get(house.id)) ?? house;
  await save('houses', { ...fresh, vacant });
  if (visit) await save('visits', { ...visit, outcome: vacant ? 'vacant' : 'not_home' });
  ui.toast(vacant ? 'Marked as empty house' : 'Marked as lived in', [
    {
      label: 'Undo',
      run: async () => {
        const now = (await db.houses.get(house.id)) ?? fresh;
        await save('houses', { ...now, vacant: !vacant });
        if (visit) await save('visits', visit);
      },
    },
  ]);
}

/** One tap: make someone a member or a contact again, with Undo. */
export async function toggleMember(ui: UIState, p: Person) {
  const becoming = !p.is_member;
  await setMember(p, becoming);
  const first = p.full_name.split(' ')[0] || 'They';
  ui.toast(becoming ? `${first} is now a member` : `${first} is no longer a member`, [{ label: 'Undo', run: () => void setMember(p, !becoming) }]);
}
