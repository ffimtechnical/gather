import {
  Bell, DatabaseBackup, FileSpreadsheet, Heart, House, ListChecks, LogOut, Map as MapIcon, PenLine, Plus,
  RefreshCw, RotateCcw, Upload, Users, ImageUp, Church, MapPin,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { ROLES } from '../../shared/model';
import { DEFAULT_NAME, imageToDataUrl, saveBranding, useBranding } from '../branding';
import { db, wipeLocalData } from '../db';
import { exportBackup, exportHouses, exportPeople, exportTasks, exportVisits, importBackup } from '../exporter';
import { ICON, ICON_SM, ROLE_ICON } from '../icons';
import { disableReminders, enableReminders, remindersOn } from '../reminders';
import { setSession } from '../session';
import { syncNow } from '../sync';
import { Avatar, Toggle, useUI } from '../ui';
import { syncLabel, useSyncState } from './SyncBadge';
import { UserForm } from './UserForm';
import { ZoneForm } from './ZoneForm';

export function Manage() {
  const { data, toast, openModal, setMode, setTab, fitZone, flyTo } = useUI();
  const fitPoint = (p: { lat: number; lng: number }) => {
    setTab('map');
    flyTo(p.lat, p.lng, 18);
  };
  const { me, perms } = data;
  const sync = useSyncState();
  const label = syncLabel(sync);
  const SyncIcon = label.icon;
  const RoleIcon = ROLE_ICON[me.role];
  const [remind, setRemind] = useState(remindersOn());
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const brand = useBranding();
  const [churchName, setChurchName] = useState(brand.name);
  const [premisesName, setPremisesName] = useState(brand.church?.name ?? '');

  const openTasks = (uid: string) => data.tasks.filter((t) => t.status === 'open' && t.assignee_id === uid).length;
  const team = data.users
    .filter((u) => u.id !== me.id && (perms.isAdmin || u.role === 'member'))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  const myZone = me.zone_id ? data.zoneById.get(me.zone_id) : undefined;

  async function signOut() {
    const pending = await db.outbox.count();
    if (pending && !confirm(`${pending} changes haven’t synced yet and will be lost. Sign out anyway?`)) return;
    await wipeLocalData();
    setSession(null);
  }

  return (
    <div className="page">
      <section className="profile">
        <Avatar user={me} size={52} />
        <div className="grow">
          <h1>{me.name}</h1>
          <span className="role-line">
            <RoleIcon {...ICON_SM} />
            {ROLES.find((r) => r.value === me.role)?.label}
            {myZone && `, ${myZone.name}`}
          </span>
        </div>
        <button className="icon-btn" onClick={() => openModal(<UserForm user={me} />)} aria-label="Edit my details">
          <PenLine {...ICON} />
        </button>
        <button className="icon-btn" onClick={signOut} aria-label="Sign out">
          <LogOut {...ICON} />
        </button>
      </section>

      <button className={`sync-row ${label.tone}`} onClick={() => void syncNow()}>
        <SyncIcon {...ICON} className={sync.kind === 'syncing' ? 'spin' : ''} />
        <span className="grow">{label.text}</span>
        <RefreshCw {...ICON_SM} />
      </button>

      {perms.isAdmin && (
        <section className="block brand-block">
          <img src={brand.logo} alt="" className="brand-preview" />
          <div className="grow brand-fields">
            <input
              value={churchName}
              onChange={(e) => setChurchName(e.target.value)}
              onBlur={() => churchName !== brand.name && void saveBranding({ name: churchName.trim() === DEFAULT_NAME ? null : churchName }).then(() => toast('Name saved')).catch((e) => toast(e.message))}
              aria-label="App name"
            />
            <div className="row gap">
              <button className="btn ghost small" onClick={() => logoRef.current?.click()}>
                <ImageUp size={16} /> Change logo
              </button>
              {brand.custom && (
                <button
                  className="icon-btn"
                  aria-label="Use the original logo"
                  onClick={() => void saveBranding({ logo: null }).then(() => toast('Original logo restored')).catch((e) => toast(e.message))}
                >
                  <RotateCcw size={18} />
                </button>
              )}
            </div>
          </div>
          <input
            ref={logoRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                await saveBranding({ logo: await imageToDataUrl(f) });
                toast('Logo updated for everyone');
              } catch (err) {
                toast((err as Error).message);
              }
            }}
          />
        </section>
      )}

      {perms.isAdmin && (
        <section className="block">
          <div className="block-head">
            <h2>Church</h2>
            <span className="grow" />
            <button
              className="btn ghost small"
              onClick={() => {
                setTab('map');
                setMode({ kind: 'church' });
              }}
            >
              <MapPin size={16} /> {brand.church ? 'Move' : 'Set on map'}
            </button>
          </div>
          {brand.church ? (
            <div className="row gap church-row">
              <Church {...ICON} />
              <input
                value={premisesName}
                onChange={(e) => setPremisesName(e.target.value)}
                onBlur={() =>
                  brand.church && premisesName.trim() && premisesName !== brand.church.name &&
                  void saveBranding({ church: { ...brand.church, name: premisesName.trim() } }).then(() => toast('Saved'))
                }
                aria-label="Church name"
              />
              <button className="icon-btn" onClick={() => brand.church && fitPoint(brand.church)} aria-label="Show church on map">
                <MapIcon {...ICON_SM} />
              </button>
            </div>
          ) : (
            <p className="muted small">Mark your church building to see how far each house is by road.</p>
          )}
        </section>
      )}

      {perms.manageTeam && (
        <section className="block">
          <div className="block-head">
            <h2>Team</h2>
            <span className="count">{team.length}</span>
            <span className="grow" />
            <button className="icon-btn" onClick={() => openModal(<UserForm />)} aria-label="Add team member">
              <Plus {...ICON} />
            </button>
          </div>
          {team.map((u) => {
            const Icon = ROLE_ICON[u.role];
            const z = u.zone_id ? data.zoneById.get(u.zone_id) : undefined;
            const n = openTasks(u.id);
            return (
              <button key={u.id} className={`row-item row-main ${u.active ? '' : 'inactive'}`} onClick={() => openModal(<UserForm user={u} />)}>
                <Avatar user={u} size={36} />
                <span className="row-text">
                  <b>{u.name}</b>
                  <small className="inline-icons">
                    <Icon size={13} />
                    {ROLES.find((r) => r.value === u.role)?.label}
                    {z && (
                      <>
                        <span className="swatch" style={{ background: z.color }} />
                        {z.name}
                      </>
                    )}
                  </small>
                </span>
                {n > 0 && (
                  <span className="pill-count" title="Open tasks">
                    <ListChecks size={13} />
                    {n}
                  </span>
                )}
              </button>
            );
          })}
          {!team.length && <p className="muted small">Add the people who go out visiting.</p>}
        </section>
      )}

      {perms.manageZones && (
        <section className="block">
          <div className="block-head">
            <h2>Zones</h2>
            <span className="count">{data.zones.length}</span>
            <span className="grow" />
            <button
              className="btn ghost small"
              onClick={() => {
                setTab('map');
                setMode({ kind: 'draw', points: [] });
              }}
            >
              <PenLine size={16} /> Draw zone
            </button>
          </div>
          {data.zones.map((z) => {
            const pastor = z.pastor_id ? data.userById.get(z.pastor_id) : undefined;
            return (
              <div key={z.id} className="row-item">
                <button className="row-main" onClick={() => openModal(<ZoneForm zone={z} />)}>
                  <span className="swatch big" style={{ background: z.color }} />
                  <span className="row-text">
                    <b>{z.name}</b>
                    <small className="inline-icons">
                      <House size={13} />
                      {data.houses.filter((h) => h.zone_id === z.id).length}
                      {pastor && (
                        <>
                          <ROLE_ICON.pastor size={13} />
                          {pastor.name}
                        </>
                      )}
                    </small>
                  </span>
                </button>
                <button className="icon-btn" onClick={() => fitZone(z.id)} aria-label={`Show ${z.name} on map`}>
                  <MapIcon {...ICON_SM} />
                </button>
              </div>
            );
          })}
          {!data.zones.length && <p className="muted small">Outline the areas your church covers, then give each a zone pastor.</p>}
        </section>
      )}

      {perms.export && (
        <section className="block">
          <div className="block-head">
            <h2>Export</h2>
          </div>
          <div className="tile-grid">
            <button className="tile" onClick={() => exportHouses(data)}>
              <House {...ICON} />
              Houses
            </button>
            <button className="tile" onClick={() => exportPeople(data)}>
              <Users {...ICON} />
              People
            </button>
            <button className="tile" onClick={() => exportPeople(data, true)}>
              <Heart {...ICON} />
              Members
            </button>
            <button className="tile" onClick={() => exportVisits(data)}>
              <FileSpreadsheet {...ICON} />
              Visits
            </button>
            <button className="tile" onClick={() => exportTasks(data)}>
              <ListChecks {...ICON} />
              Tasks
            </button>
            <button className="tile" onClick={() => void exportBackup()}>
              <DatabaseBackup {...ICON} />
              Backup
            </button>
            {perms.isAdmin && (
              <button className="tile" onClick={() => fileRef.current?.click()}>
                <Upload {...ICON} />
                Restore
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                toast(`Restored ${await importBackup(f)} records`);
              } catch (err) {
                toast((err as Error).message);
              }
              e.target.value = '';
            }}
          />
        </section>
      )}

      <section className="block">
        <Toggle
          icon={Bell}
          checked={remind}
          label="Daily reminder"
          onChange={async (v) => {
            if (v) {
              const ok = await enableReminders();
              setRemind(ok);
              if (!ok) toast('Notifications are blocked in your browser settings');
            } else {
              disableReminders();
              setRemind(false);
            }
          }}
        />
      </section>

      <p className="muted center small foot">FFIM Gather 1.1</p>
    </div>
  );
}
