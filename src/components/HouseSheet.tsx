import {
  Car,
  Footprints,
  Church as ChurchIcon,
  CalendarClock, ChevronDown, ChevronUp, Clock, Heart, ListPlus, MoreHorizontal, Navigation, Pencil, Phone,
  MessageSquare, UserPlus, Users, X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useBranding } from '../branding';
import { routeToChurch } from '../churchDistance';
import type { Route } from '../routing';
import { OUTCOMES, TASK_ACTIONS, VISIT_KINDS, type House, type Person, type Task, type Visit } from '../../shared/model';
import { quickLog, kindFor, toggleMember } from '../actions';
import { blankPerson, blankVisit } from '../db';
import { ACTION_ICON, ICON, ICON_SM, KIND_ICON, OUTCOME_ICON } from '../icons';
import { Action, Avatar, StatusTag, useUI } from '../ui';
import { directionsUrl, distanceM, dueLabel, fmtDateTime, fmtDistance, phoneLinks, timeAgo } from '../util';
import { AssignModal } from './AssignModal';
import { HouseForm } from './HouseForm';
import { PersonForm } from './PersonForm';
import { VisitForm } from './VisitForm';

const QUICK = ['prayed', 'good_chat', 'invited', 'not_home'];

export function HouseSheet() {
  const { data, selectedId, select } = useUI();
  const [expanded, setExpanded] = useState(false);
  const house = selectedId ? data.houseById.get(selectedId) : undefined;
  useEffect(() => setExpanded(false), [selectedId]);
  if (!house) return null;
  return (
    <div className={`sheet ${expanded ? 'expanded' : ''}`}>
      <button className="sheet-handle" onClick={() => setExpanded(!expanded)} aria-label={expanded ? 'Show less' : 'Show more'}>
        {expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
      </button>
      <HouseDetails key={house.id} house={house} onClose={() => select(null)} />
    </div>
  );
}

function HouseDetails({ house, onClose }: { house: House; onClose: () => void }) {
  const ui = useUI();
  const { data, openModal, me } = ui;
  const status = data.statusById.get(house.id)!;
  const people = data.peopleByHouse.get(house.id) ?? [];
  const visits = data.visitsByHouse.get(house.id) ?? [];
  const tasks = data.openTasksByHouse.get(house.id) ?? [];
  const members = people.filter((p) => p.is_member).length;
  const phone = people.find((p) => p.phone)?.phone;
  const zone = house.zone_id ? data.zoneById.get(house.zone_id) : undefined;
  const [showAll, setShowAll] = useState(false);
  const { church } = useBranding();
  const [showChurch, setShowChurch] = useState(false);

  const fullLog = () => openModal(<VisitForm visit={{ ...blankVisit(house.id), kind: kindFor(status) }} house={house} isNew />);

  return (
    <div className="sheet-body">
      <header className="house-head">
        <div className="grow">
          <StatusTag status={status} />
          <h2>{house.name || house.address || house.code}</h2>
          <div className="meta">
            {(house.name || house.address) && <span className="code">{house.code}</span>}
            {zone && (
              <span className="meta-item">
                <span className="swatch" style={{ background: zone.color }} />
                {zone.name}
              </span>
            )}
            {me && <span className="meta-item">{fmtDistance(distanceM(me, house))}</span>}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X {...ICON} />
        </button>
      </header>

      <div className="stat-row">
        <span title="People living here">
          <Users {...ICON_SM} />
          {house.household_size ?? people.length}
        </span>
        <span title="Members" className={members ? 'pos' : ''}>
          <Heart {...ICON_SM} />
          {members}
        </span>
        <span title="Last spoke with someone">
          <Clock {...ICON_SM} />
          {timeAgo(data.lastContactById.get(house.id))}
        </span>
        {house.next_visit_on && (
          <span title="Planned visit" className={dueLabel(house.next_visit_on)?.late ? 'late' : ''}>
            <CalendarClock {...ICON_SM} />
            {dueLabel(house.next_visit_on)?.text}
          </span>
        )}
      </div>

      {tasks.map((t) => (
        <TaskLine key={t.id} t={t} />
      ))}

      {status !== 'dnv' && (
        <div className="quick-log" role="group" aria-label="Log a visit">
          {QUICK.map((o) => {
            const info = OUTCOMES.find((x) => x.value === o)!;
            const Icon = OUTCOME_ICON[o];
            return (
              <button key={o} className="ql" onClick={() => void quickLog(ui, house, o)}>
                <Icon {...ICON} />
                <span>{info.label}</span>
              </button>
            );
          })}
          <button className="ql" onClick={fullLog} aria-label="More visit details">
            <MoreHorizontal {...ICON} />
            <span>More</span>
          </button>
        </div>
      )}

      <div className="actions">
        {phone && <Action icon={Phone} label="Call" href={phoneLinks(phone).tel} />}
        {phone && <Action icon={MessageSquare} label="WhatsApp" href={phoneLinks(phone).whatsapp} />}
        <Action icon={Navigation} label="Go" href={directionsUrl(house.lat, house.lng)} />
        {church && <Action icon={ChurchIcon} label="To church" onClick={() => setShowChurch(!showChurch)} primary={showChurch} />}
        <Action icon={UserPlus} label="Person" onClick={() => openModal(<PersonForm person={blankPerson(house.id)} isNew />)} />
        {data.perms.assign && <Action icon={ListPlus} label="Assign" onClick={() => openModal(<AssignModal houseIds={[house.id]} />)} />}
        <Action icon={Pencil} label="Edit" onClick={() => openModal(<HouseForm house={house} onDeleted={onClose} />)} />
      </div>

      {showChurch && <ChurchDistance house={house} onClose={() => setShowChurch(false)} />}

      {people.length > 0 && (
        <section>
          {people.map((p) => (
            <PersonRow key={p.id} p={p} />
          ))}
        </section>
      )}

      {house.description && <p className="note">{house.description}</p>}

      {visits.length > 0 && (
        <section className="timeline">
          {(showAll ? visits : visits.slice(0, 4)).map((v) => (
            <VisitRow key={v.id} v={v} house={house} people={people} />
          ))}
          {visits.length > 4 && !showAll && (
            <button className="link" onClick={() => setShowAll(true)}>
              All {visits.length} visits
            </button>
          )}
        </section>
      )}
    </div>
  );
}

/** Shown only when asked for: road distance to church, walking time and a rough driving time. */
function ChurchDistance({ house, onClose }: { house: House; onClose: () => void }) {
  const { showRoute } = useUI();
  const [r, setR] = useState<Route | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setR(undefined);
    routeToChurch(house)?.then((x) => {
      if (!alive) return;
      setR(x);
      if (x) showRoute(x.path);
    });
    return () => {
      alive = false;
      showRoute(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [house.id, house.lat, house.lng]);
  const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
  return (
    <div className="church-info">
      <ChurchIcon {...ICON_SM} />
      {r === undefined ? (
        <span className="grow muted">Measuring the road distance to church…</span>
      ) : r === null ? (
        <span className="grow muted">No road route found to the church.</span>
      ) : (
        <span className="grow">
          <span>
            <b>{km(r.meters)}</b> by road to church
          </span>
          <small>
            <Footprints size={13} /> {r.minutes < 60 ? `${Math.max(1, r.minutes)} min` : `${Math.floor(r.minutes / 60)} h ${r.minutes % 60} min`} walking
            <Car size={13} /> about {r.driveMinutes} min by car
          </small>
        </span>
      )}
      <button className="icon-btn" onClick={onClose} aria-label="Hide distance to church">
        <X size={18} />
      </button>
    </div>
  );
}

function TaskLine({ t }: { t: Task }) {
  const { data } = useUI();
  const Icon = ACTION_ICON[t.action];
  const who = t.assignee_id ? data.userById.get(t.assignee_id) : undefined;
  const due = dueLabel(t.due_on);
  return (
    <div className="task-line">
      <Icon {...ICON_SM} />
      <b>{TASK_ACTIONS.find((a) => a.value === t.action)?.label}</b>
      {due && <span className={`due ${due.late ? 'late' : ''}`}>{due.text}</span>}
      <span className="grow" />
      {who && (
        <span className="who">
          <Avatar user={who} size={22} />
          {who.id === data.me.id ? 'You' : who.name.split(' ')[0]}
        </span>
      )}
    </div>
  );
}

function PersonRow({ p }: { p: Person }) {
  const ui = useUI();
  const links = p.phone ? phoneLinks(p.phone) : null;
  return (
    <div className="row-item">
      <button className="row-main" onClick={() => ui.openModal(<PersonForm person={p} />)}>
        <Avatar name={p.full_name} size={36} />
        <span className="row-text">
          <b>{p.full_name || 'Unnamed'}</b>
          <small>{[p.is_member ? 'Member' : null, p.phone].filter(Boolean).join(', ') || 'Contact'}</small>
        </span>
      </button>
      <MemberHeart p={p} />
      {links && (
        <a className="icon-btn" href={links.tel} aria-label={`Call ${p.full_name}`}>
          <Phone {...ICON_SM} />
        </a>
      )}
    </div>
  );
}

/** Tap to make someone a member (green) or back to a contact. */
export function MemberHeart({ p }: { p: Person }) {
  const ui = useUI();
  return (
    <button
      className={`heart-btn ${p.is_member ? 'on' : ''}`}
      onClick={() => void toggleMember(ui, p)}
      aria-pressed={p.is_member}
      aria-label={p.is_member ? `${p.full_name} is a member. Tap to undo.` : `Make ${p.full_name} a member`}
      title={p.is_member ? 'Member' : 'Make member'}
    >
      <Heart size={18} strokeWidth={2} />
    </button>
  );
}

function VisitRow({ v, house, people }: { v: Visit; house: House; people: Person[] }) {
  const { openModal } = useUI();
  const outcome = OUTCOMES.find((o) => o.value === v.outcome);
  const Icon = (v.outcome && OUTCOME_ICON[v.outcome]) || KIND_ICON[v.kind];
  const who = people.find((p) => p.id === v.person_id)?.full_name;
  return (
    <button className="visit-row" onClick={() => openModal(<VisitForm visit={v} house={house} />)}>
      <span className="visit-icon">
        <Icon {...ICON_SM} />
      </span>
      <span className="row-text">
        <b>{outcome?.label ?? VISIT_KINDS.find((k) => k.value === v.kind)?.label}</b>
        <small title={fmtDateTime(v.visited_at)}>
          {timeAgo(v.visited_at)}
          {v.visited_by && `, ${v.visited_by}`}
          {who && ` with ${who}`}
        </small>
        {v.notes && <span className="visit-notes">{v.notes}</span>}
      </span>
    </button>
  );
}
