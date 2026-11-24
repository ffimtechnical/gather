import { MapPin, MapPinOff, Phone, Search, UserPlus, Users } from 'lucide-react';
import { blankPerson } from '../db';
import { MemberHeart } from './HouseSheet';
import { useMemo, useState } from 'react';
import { ICON_SM } from '../icons';
import { Avatar, Empty, useUI } from '../ui';
import { phoneLinks } from '../util';
import { PersonForm } from './PersonForm';

export function PeopleList() {
  const { data, openModal, showHouse } = useUI();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'members' | 'contacts'>('all');

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.people
      .filter((p) => (filter === 'members' ? p.is_member : filter === 'contacts' ? !p.is_member : true))
      .filter((p) => !s || [p.full_name, p.phone, p.email, (p.house_id ? data.houseById.get(p.house_id)?.code : '')].join(' ').toLowerCase().includes(s))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [data, q, filter]);

  const members = data.people.filter((p) => p.is_member).length;

  return (
    <div className="page">
      <header className="page-head">
        <h1>People</h1>
        <span className="count-big">{data.people.length}</span>
        <span className="grow" />
        {data.perms.isLead && (
          <button className="btn ghost small" onClick={() => openModal(<PersonForm person={{ ...blankPerson(null), is_member: true, member_since: new Date().toISOString().slice(0, 10) }} isNew />)}>
            <UserPlus size={16} /> Add member
          </button>
        )}
      </header>
      <div className="search inline">
        <Search size={18} strokeWidth={1.75} className="muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or phone" aria-label="Search people" />
      </div>
      <div className="segments">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          All<i>{data.people.length}</i>
        </button>
        <button className={filter === 'members' ? 'active' : ''} onClick={() => setFilter('members')}>
          Members<i>{members}</i>
        </button>
        <button className={filter === 'contacts' ? 'active' : ''} onClick={() => setFilter('contacts')}>
          Contacts<i>{data.people.length - members}</i>
        </button>
      </div>
      {rows.length === 0 ? (
        <Empty icon={Users} title="No people yet" />
      ) : (
        <div className="list">
          {rows.map((p) => {
            const h = p.house_id ? data.houseById.get(p.house_id) : undefined;
            return (
              <div className="row-item" key={p.id}>
                <button className="row-main" onClick={() => openModal(<PersonForm person={p} />)}>
                  <Avatar name={p.full_name} size={36} />
                  <span className="row-text">
                    <b>{p.full_name || 'Unnamed'}</b>
                    <small className="inline-icons">
                      {!p.house_id && <MapPinOff size={12} />}
                      {[p.phone, h ? h.name || h.code : p.house_id ? null : 'No house yet'].filter(Boolean).join(', ')}
                    </small>
                  </span>
                </button>
                <MemberHeart p={p} />
                {p.phone && (
                  <a className="icon-btn" href={phoneLinks(p.phone).tel} aria-label={`Call ${p.full_name}`}>
                    <Phone {...ICON_SM} />
                  </a>
                )}
                {h && (
                  <button className="icon-btn" onClick={() => showHouse(h.id)} aria-label="Show house on map">
                    <MapPin {...ICON_SM} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
