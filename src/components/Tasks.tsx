import { Check, ChevronDown, Church, Circle, CircleCheck, Loader2, Navigation, Sprout } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useBranding } from '../branding';
import { roadDistancesFrom } from '../routing';
import { OUTCOMES, STATUS_INFO, STATUS_ORDER, TASK_ACTIONS, type House, type Status, type Task } from '../../shared/model';
import { quickLog } from '../actions';
import { ACTION_ICON, ICON, ICON_SM, OUTCOME_ICON } from '../icons';
import { Avatar, Empty, Modal, StatusDot, useUI } from '../ui';
import { directionsUrl, distanceM, dueLabel, fmtDistance, timeAgo } from '../util';
import { AssignModal } from './AssignModal';

export function Tasks() {
  const { data } = useUI();
  return data.perms.isLead ? <LeadBoard /> : <MyTasks />;
}

function houseTitle(h: House, data: ReturnType<typeof useUI>['data']) {
  const p = data.peopleByHouse.get(h.id)?.[0];
  return h.name || h.address || (p ? p.full_name : h.code);
}

// ---------------------------------------------------------------------------
// Team member: my list
// ---------------------------------------------------------------------------

function MyTasks() {
  const { data, me } = useUI();
  const near = (a: House, b: House) => (me ? distanceM(me, a) - distanceM(me, b) : 0);
  const assigned = new Set(data.tasks.filter((t) => t.status === 'open').map((t) => t.house_id));
  const nearby = data.alerts.followUpsDue.filter((h) => !assigned.has(h.id)).sort(near).slice(0, 30);

  return (
    <div className="page">
      <header className="page-head">
        <h1>My tasks</h1>
        <span className="count-big">{data.myTasks.length}</span>
      </header>
      {data.myTasks.length === 0 ? (
        <Empty icon={Sprout} title="Nothing assigned to you right now" />
      ) : (
        <div className="list">
          {data.myTasks.map((t) => (
            <TaskCard key={t.id} t={t} />
          ))}
        </div>
      )}
      {nearby.length > 0 && (
        <>
          <h2 className="section-title">Due in your zone</h2>
          <div className="list">
            {nearby.map((h) => (
              <HouseRow key={h.id} h={h} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TaskCard({ t }: { t: Task }) {
  const { data, showHouse, openModal, me } = useUI();
  const h = data.houseById.get(t.house_id);
  if (!h) return null;
  const Icon = ACTION_ICON[t.action];
  const due = dueLabel(t.due_on);
  return (
    <div className="task-card">
      <button className="row-main" onClick={() => showHouse(h.id)}>
        <StatusDot status={data.statusById.get(h.id)!} size={12} />
        <span className="row-text">
          <b>{houseTitle(h, data)}</b>
          <span className="task-meta">
            <span>
              <Icon {...ICON_SM} />
              {TASK_ACTIONS.find((a) => a.value === t.action)?.label}
            </span>
            {due && <span className={`due ${due.late ? 'late' : ''}`}>{due.text}</span>}
            {me && <span>{fmtDistance(distanceM(me, h))}</span>}
          </span>
          {t.note && <small>{t.note}</small>}
        </span>
      </button>
      <a className="icon-btn" href={directionsUrl(h.lat, h.lng)} target="_blank" rel="noreferrer" aria-label="Directions">
        <Navigation {...ICON} />
      </a>
      <button className="icon-btn solid" onClick={() => openModal(<QuickLogModal house={h} />)} aria-label="Log visit">
        <Check {...ICON} />
      </button>
    </div>
  );
}

function HouseRow({ h, selectable, selected, onToggle, churchM }: { h: House; selectable?: boolean; selected?: boolean; onToggle?: () => void; churchM?: number | null }) {
  const { data, showHouse, openModal } = useUI();
  const people = data.peopleByHouse.get(h.id) ?? [];
  return (
    <div className={`row-item ${selected ? 'selected' : ''}`}>
      {selectable && (
        <button className="check" onClick={onToggle} aria-label={selected ? 'Unselect' : 'Select'} aria-pressed={selected}>
          {selected ? <CircleCheck {...ICON} /> : <Circle {...ICON} />}
        </button>
      )}
      <button className="row-main" onClick={() => showHouse(h.id)}>
        <StatusDot status={data.statusById.get(h.id)!} size={12} />
        <span className="row-text">
          <b>{houseTitle(h, data)}</b>
          {(houseTitle(h, data) !== h.code || people.length > 0) && (
            <small>{[houseTitle(h, data) !== h.code ? h.code : null, ...people.map((p) => p.full_name.split(' ')[0]).slice(0, 3)].filter(Boolean).join(', ')}</small>
          )}
        </span>
        <span className="ago">{churchM != null ? (churchM < 1000 ? `${Math.round(churchM)} m` : `${(churchM / 1000).toFixed(1)} km`) : timeAgo(data.lastContactById.get(h.id))}</span>
      </button>
      {!selectable && (
        <button className="icon-btn solid" onClick={() => openModal(<QuickLogModal house={h} />)} aria-label="Log visit">
          <Check {...ICON} />
        </button>
      )}
    </div>
  );
}

export function QuickLogModal({ house }: { house: House }) {
  const ui = useUI();
  const { data, closeModal } = ui;
  return (
    <Modal title={houseTitle(house, data)} onClose={closeModal}>
      <div className="outcome-grid">
        {OUTCOMES.map((o) => {
          const Icon = OUTCOME_ICON[o.value];
          return (
            <button
              key={o.value}
              className="og"
              onClick={() => {
                closeModal();
                void quickLog(ui, house, o.value);
              }}
            >
              <Icon {...ICON} />
              <span>{o.label}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Admin / zone pastor: zone overview and assigning
// ---------------------------------------------------------------------------

type Seg = 'due' | 'new' | 'members' | 'assigned';

function LeadBoard() {
  const { data, openModal, me } = useUI();
  const [seg, setSeg] = useState<Seg>('due');
  const [zoneId, setZoneId] = useState<string>('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const { church } = useBranding();
  const [byChurch, setByChurch] = useState(false);
  const [churchDist, setChurchDist] = useState<Map<string, number | null> | null>(null);
  const [measuring, setMeasuring] = useState(false);

  const myZones = data.zones.filter((z) => data.myZoneIds === null || data.myZoneIds.includes(z.id));
  const inZone = (h: House) => !zoneId || h.zone_id === zoneId;
  const assigned = useMemo(() => new Set(data.tasks.filter((t) => t.status === 'open').map((t) => t.house_id)), [data.tasks]);

  const lists = useMemo(() => {
    const free = (hs: House[]) => hs.filter((h) => !assigned.has(h.id) && inZone(h));
    const due = [...new Map([...data.alerts.scheduledDue, ...data.alerts.followUpsDue].map((h) => [h.id, h])).values()];
    return {
      due: free(due),
      new: free(data.houses.filter((h) => data.statusById.get(h.id) === 'new')),
      members: free(data.alerts.membersDue),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, assigned, zoneId]);

  const byPerson = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of data.tasks) {
      if (t.status !== 'open' || !t.assignee_id) continue;
      const h = data.houseById.get(t.house_id);
      if (!h || !inZone(h)) continue;
      m.set(t.assignee_id, [...(m.get(t.assignee_id) ?? []), t]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tasks, data.houseById, zoneId]);

  const baseRows = seg === 'assigned' ? [] : lists[seg];
  // Road distance from the church to every listed house in one Dijkstra pass
  useEffect(() => {
    if (!byChurch || !church || !baseRows.length) return;
    let alive = true;
    setMeasuring(true);
    const list = baseRows.slice(0, 400);
    roadDistancesFrom(church, list)
      .then((d) => alive && setChurchDist(new Map(list.map((h, i) => [h.id, d[i]]))))
      .catch(() => alive && setChurchDist(new Map()))
      .finally(() => alive && setMeasuring(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byChurch, church, seg, zoneId, baseRows.length]);
  const dist = (h: House) => churchDist?.get(h.id) ?? Infinity;
  const rows = [...baseRows].sort((a, b) =>
    byChurch && churchDist ? dist(a) - dist(b) : me ? distanceM(me, a) - distanceM(me, b) : 0,
  );
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const SEGS: { id: Seg; label: string; n: number }[] = [
    { id: 'due', label: 'Due', n: lists.due.length },
    { id: 'new', label: 'New', n: lists.new.length },
    { id: 'members', label: 'Members', n: lists.members.length },
    { id: 'assigned', label: 'Assigned', n: byPerson.reduce((s, [, t]) => s + t.length, 0) },
  ];

  return (
    <div className="page">
      <header className="page-head">
        <h1>Zones</h1>
      </header>

      <div className="zone-growth">
        {myZones.map((z) => (
          <ZoneBar key={z.id} name={z.name} color={z.color} pastorId={z.pastor_id} houses={data.houses.filter((h) => h.zone_id === z.id)} active={zoneId === z.id} onClick={() => setZoneId(zoneId === z.id ? '' : z.id)} />
        ))}
        {data.perms.isAdmin && data.houses.some((h) => !h.zone_id) && (
          <ZoneBar name="Outside zones" color="#8c958d" houses={data.houses.filter((h) => !h.zone_id)} />
        )}
        {!myZones.length && <p className="muted small">{data.perms.isAdmin ? 'Draw your first zone under Manage.' : 'No zone assigned to you yet.'}</p>}
      </div>

      <div className="segments">
        {SEGS.map((s) => (
          <button
            key={s.id}
            className={seg === s.id ? 'active' : ''}
            onClick={() => {
              setSeg(s.id);
              setSel(new Set());
            }}
          >
            {s.label}
            <i>{s.n}</i>
          </button>
        ))}
      </div>

      {seg === 'assigned' ? (
        byPerson.length === 0 ? (
          <Empty icon={Sprout} title="No open assignments" />
        ) : (
          <div className="list">
            {byPerson.map(([uid, tasks]) => (
              <PersonTasks key={uid} uid={uid} tasks={tasks} />
            ))}
          </div>
        )
      ) : rows.length === 0 ? (
        <Empty icon={Sprout} title="All covered" />
      ) : (
        <>
          <div className="select-all">
            {church && (
              <button className={`chip small-chip ${byChurch ? 'active' : ''}`} onClick={() => setByChurch(!byChurch)}>
                {measuring ? <Loader2 size={14} className="spin" /> : <Church size={14} />} Nearest to church
              </button>
            )}
            <span className="grow" />
            <button className="link" onClick={() => setSel(sel.size === rows.length ? new Set() : new Set(rows.slice(0, 200).map((h) => h.id)))}>
              {sel.size === rows.length ? 'Clear' : 'Select all'}
            </button>
          </div>
          <div className="list">
            {rows.slice(0, 200).map((h) => (
              <HouseRow key={h.id} h={h} selectable selected={sel.has(h.id)} onToggle={() => toggle(h.id)} churchM={byChurch ? churchDist?.get(h.id) : undefined} />
            ))}
          </div>
        </>
      )}

      {sel.size > 0 && (
        <div className="assign-bar">
          <span>{sel.size} selected</span>
          <button className="btn primary" onClick={() => openModal(<AssignModal houseIds={[...sel]} onDone={() => setSel(new Set())} />)}>
            Assign
          </button>
        </div>
      )}
    </div>
  );
}

function ZoneBar({ name, color, houses, pastorId, active, onClick }: { name: string; color: string; houses: House[]; pastorId?: string | null; active?: boolean; onClick?: () => void }) {
  const { data } = useUI();
  const counts: Record<Status, number> = { new: 0, due: 0, done: 0, member: 0, vacant: 0, dnv: 0 };
  for (const h of houses) counts[data.statusById.get(h.id)!]++;
  const total = houses.length || 1;
  const pastor = pastorId ? data.userById.get(pastorId) : undefined;
  const reached = houses.length ? Math.round(((counts.done + counts.member + counts.due) / houses.length) * 100) : 0;
  return (
    <button className={`zone-bar ${active ? 'active' : ''}`} onClick={onClick} disabled={!onClick}>
      <span className="zb-head">
        <span className="swatch" style={{ background: color }} />
        <b>{name}</b>
        {pastor && <Avatar user={pastor} size={22} />}
        <span className="grow" />
        <span className="zb-pct">{reached}%</span>
      </span>
      <span className="growth" aria-label={STATUS_ORDER.map((s) => `${STATUS_INFO[s].label}: ${counts[s]}`).join(', ')}>
        {(['member', 'done', 'due', 'new', 'vacant', 'dnv'] as Status[]).map((s) =>
          counts[s] ? <span key={s} style={{ flexGrow: counts[s] / total, background: STATUS_INFO[s].color }} /> : null,
        )}
        {!houses.length && <span style={{ flexGrow: 1 }} className="growth-empty" />}
      </span>
      <span className="zb-legend">
        {(['member', 'done', 'due', 'new'] as Status[]).map((s) => (
          <span key={s}>
            <StatusDot status={s} size={7} />
            {counts[s]}
          </span>
        ))}
      </span>
    </button>
  );
}

function PersonTasks({ uid, tasks }: { uid: string; tasks: Task[] }) {
  const { data, showHouse } = useUI();
  const [open, setOpen] = useState(false);
  const u = data.userById.get(uid);
  const late = tasks.filter((t) => dueLabel(t.due_on)?.late).length;
  return (
    <div className="person-tasks">
      <button className="row-main" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Avatar user={u} name="?" size={36} />
        <span className="row-text">
          <b>{u?.name ?? 'Former member'}</b>
          <small>
            {tasks.length} open{late ? `, ${late} overdue` : ''}
          </small>
        </span>
        <ChevronDown {...ICON} className={open ? 'rot' : ''} />
      </button>
      {open &&
        tasks.map((t) => {
          const h = data.houseById.get(t.house_id)!;
          const Icon = ACTION_ICON[t.action];
          const due = dueLabel(t.due_on);
          return (
            <button key={t.id} className="sub-row" onClick={() => showHouse(h.id)}>
              <StatusDot status={data.statusById.get(h.id)!} />
              <span className="grow">{houseTitle(h, data)}</span>
              <Icon {...ICON_SM} />
              {due && <span className={`due ${due.late ? 'late' : ''}`}>{due.text}</span>}
            </button>
          );
        })}
    </div>
  );
}
