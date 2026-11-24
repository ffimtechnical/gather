import { Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import { TASK_ACTIONS, type TaskAction, type Task } from '../../shared/model';
import { blankTask, saveRows } from '../db';
import { ACTION_ICON } from '../icons';
import { Avatar, Chips, Modal, nul, useUI } from '../ui';
import { endOfWeekStr, todayStr } from '../util';

const DUE = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'week', label: 'This week' },
  { value: 'next', label: 'Next week' },
  { value: 'none', label: 'Anytime' },
] as const;

function dueDate(v: string): string | null {
  if (v === 'today') return todayStr();
  if (v === 'tomorrow') return todayStr(1);
  if (v === 'week') return endOfWeekStr();
  if (v === 'next') return todayStr(7);
  return null;
}

export function AssignModal({ houseIds, onDone }: { houseIds: string[]; onDone?: () => void }) {
  const { data, closeModal, toast } = useUI();
  const houses = houseIds.map((id) => data.houseById.get(id)).filter(Boolean);
  const zones = new Set(houses.map((h) => h!.zone_id));
  const existing = houseIds.flatMap((id) => data.openTasksByHouse.get(id) ?? []);

  // Team members working in these houses' zones come first
  const team = useMemo(() => {
    const active = data.users.filter((u) => u.active);
    const inZone = (u: (typeof active)[number]) =>
      (u.zone_id && zones.has(u.zone_id)) || data.zones.some((z) => zones.has(z.id) && z.pastor_id === u.id);
    return [...active].sort((a, b) => Number(inZone(b)) - Number(inZone(a)) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.users, data.zones, houseIds.join()]);

  const first = existing[0];
  const [who, setWho] = useState<string | null>(first?.assignee_id ?? null);
  const [action, setAction] = useState<TaskAction>(
    first?.action ?? (houses.every((h) => data.statusById.get(h!.id) === 'new') ? 'first_visit' : houses.every((h) => data.statusById.get(h!.id) === 'member') ? 'member_care' : 'follow_up'),
  );
  const [due, setDue] = useState<string>('week');
  const [note, setNote] = useState(first?.note ?? '');

  async function assign() {
    if (!who) return;
    const rows: Task[] = [];
    for (const id of houseIds) {
      const open = data.openTasksByHouse.get(id)?.[0];
      const fields = { assignee_id: who, action, due_on: dueDate(due), note: nul(note), assigned_by: data.me.id };
      rows.push(open ? { ...open, ...fields } : blankTask(id, fields));
    }
    await saveRows('tasks', rows);
    const name = data.userById.get(who)?.name.split(' ')[0];
    toast(`${rows.length} ${rows.length === 1 ? 'house' : 'houses'} assigned to ${name}`);
    closeModal();
    onDone?.();
  }

  return (
    <Modal title={houses.length === 1 ? `Assign ${houses[0]!.code}` : `Assign ${houses.length} houses`} onClose={closeModal}>
      <div className="form">
        <div className="people-picker">
          {team.map((u) => (
            <button key={u.id} type="button" className={`pp ${who === u.id ? 'active' : ''}`} onClick={() => setWho(u.id)}>
              <span className="pp-av">
                <Avatar user={u} size={44} />
                {who === u.id && (
                  <span className="pp-check">
                    <Check size={14} strokeWidth={3} />
                  </span>
                )}
              </span>
              <span>{u.id === data.me.id ? 'Me' : u.name.split(' ')[0]}</span>
            </button>
          ))}
        </div>
        <Chips options={TASK_ACTIONS} icons={ACTION_ICON} value={action} onChange={setAction} />
        <Chips options={DUE.map((d) => ({ ...d }))} value={due} onChange={setDue} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
        <div className="form-actions">
          {existing.length > 0 && (
            <button
              type="button"
              className="btn ghost"
              onClick={async () => {
                await saveRows('tasks', existing.map((t) => ({ ...t, deleted: true })));
                toast('Assignment removed');
                closeModal();
                onDone?.();
              }}
            >
              Unassign
            </button>
          )}
          <span className="grow" />
          <button className="btn primary" disabled={!who} onClick={assign}>
            Assign
          </button>
        </div>
      </div>
    </Modal>
  );
}
