import { KeyRound, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Role, User } from '../../shared/model';
import { refreshBranding, useBranding } from '../branding';
import { db, wipeLocalData } from '../db';
import { ROLE_ICON } from '../icons';
import { api, setSession } from '../session';
import { Avatar } from '../ui';

interface TeamEntry {
  id: string;
  name: string;
  role: Role;
  has_pin: boolean;
  zone_name: string | null;
}

async function signedIn(res: { token: string; user: User }) {
  const prev = (await db.meta.get('userId'))?.value;
  if (prev && prev !== res.user.id) await wipeLocalData();
  await db.meta.put({ key: 'userId', value: res.user.id });
  setSession(res);
}

export function Login() {
  const brand = useBranding();
  const [state, setState] = useState<{ team: TeamEntry[]; needsSetup: boolean; setupCode: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [q, setQ] = useState('');
  const [pinFor, setPinFor] = useState<TeamEntry | null>(null);
  const [pin, setPin] = useState('');

  const load = () => {
    setError(null);
    api<{ team: TeamEntry[]; needsSetup: boolean; setupCode: boolean }>('auth/team')
      .then(setState)
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);
  useEffect(() => void refreshBranding(), []);

  async function enter(u: TeamEntry, withPin?: string) {
    if (u.has_pin && !withPin) return setPinFor(u);
    setBusy(true);
    try {
      await signedIn(await api('auth/login', { user_id: u.id, pin: withPin }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const team = (state?.team ?? []).filter((u) => !q || u.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand">
          <img src={brand.logo} alt={brand.name} />
          {brand.custom && <h1>{brand.name}</h1>}
        </div>

        {error && (
          <div className="login-error">
            <span>{error}</span>
            <button className="icon-btn" onClick={load} aria-label="Try again">
              <RefreshCw size={18} />
            </button>
          </div>
        )}

        {!state && !error && <p className="muted center">Loading team…</p>}

        {state?.needsSetup && (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              setBusy(true);
              try {
                await signedIn(await api('auth/setup', { name: name.trim(), code }));
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="lead">Set up your church’s space. You’ll be the admin.</p>
            <input className="big-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" autoFocus />
            {state.setupCode && <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Setup code" aria-label="Setup code" />}
            <button className="btn primary big" disabled={busy || !name.trim()}>
              Start
            </button>
          </form>
        )}

        {state && !state.needsSetup && !pinFor && (
          <>
            <p className="lead">Who’s signing in?</p>
            {state.team.length > 8 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find your name" aria-label="Find your name" />}
            <div className="who-list">
              {team.map((u) => {
                const Icon = ROLE_ICON[u.role];
                return (
                  <button key={u.id} className="who" disabled={busy} onClick={() => void enter(u)}>
                    <Avatar user={u} size={40} />
                    <span className="row-text">
                      <b>{u.name}</b>
                      <small className="inline-icons">
                        {u.role !== 'member' && <Icon size={13} />}
                        {u.role === 'admin' ? 'Admin' : u.role === 'pastor' ? 'Zone pastor' : u.zone_name ?? 'Team'}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="muted small center">Not listed? Ask your zone pastor to add you.</p>
          </>
        )}

        {pinFor && (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void enter(pinFor, pin);
            }}
          >
            <p className="lead">
              <KeyRound size={18} /> PIN for {pinFor.name}
            </p>
            <input className="big-input center" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus aria-label="PIN" />
            <div className="form-actions">
              <button type="button" className="btn ghost" onClick={() => setPinFor(null)}>
                Back
              </button>
              <span className="grow" />
              <button className="btn primary" disabled={busy || !pin}>
                Sign in
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
