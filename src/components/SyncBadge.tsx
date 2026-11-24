import { AlertTriangle, Check, CloudOff, LogIn, RefreshCw, UploadCloud, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { subscribeSync, syncNow, type SyncState } from '../sync';
import { useUI } from '../ui';
import { timeAgo } from '../util';

export function useSyncState() {
  const [s, setS] = useState<SyncState>({ kind: 'idle', lastSync: null, pending: 0 });
  useEffect(() => subscribeSync(setS), []);
  return s;
}

export function syncLabel(s: SyncState): { icon: LucideIcon; text: string; tone: 'ok' | 'warn' | 'busy' | 'bad' } {
  switch (s.kind) {
    case 'syncing':
      return { icon: RefreshCw, text: s.progress !== undefined ? `Syncing ${Math.round(s.progress * 100)}%` : 'Syncing', tone: 'busy' };
    case 'offline':
      return { icon: CloudOff, text: s.pending ? `Offline, ${s.pending} saved on this phone` : 'Offline, all saved on this phone', tone: 'warn' };
    case 'signed-out':
      return { icon: LogIn, text: 'Sign in to sync', tone: 'bad' };
    case 'error':
      return { icon: AlertTriangle, text: s.message ?? 'Sync problem', tone: 'bad' };
    default:
      return s.pending
        ? { icon: UploadCloud, text: `${s.pending} waiting to sync`, tone: 'busy' }
        : { icon: Check, text: s.lastSync ? `Synced ${timeAgo(s.lastSync).toLowerCase()} ago`.replace('now ago', 'just now') : 'Up to date', tone: 'ok' };
  }
}

export function SyncBadge() {
  const s = useSyncState();
  const { toast } = useUI();
  const l = syncLabel(s);
  const Icon = l.icon;
  return (
    <button
      className={`sync-badge ${l.tone}`}
      onClick={() => {
        toast(l.text);
        void syncNow();
      }}
      title={l.text}
      aria-label={l.text}
    >
      {s.kind === 'syncing' && s.progress !== undefined ? (
        <span className="sync-pct">{Math.round(s.progress * 100)}%</span>
      ) : (
        <Icon size={19} strokeWidth={1.9} className={s.kind === 'syncing' ? 'spin' : ''} />
      )}
      {s.pending > 0 && s.kind !== 'syncing' && <i>{s.pending > 99 ? '99+' : s.pending}</i>}
      {s.kind === 'syncing' && s.progress !== undefined && (
        <svg className="sync-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="16" />
          <circle cx="18" cy="18" r="16" style={{ strokeDasharray: `${s.progress * 100.5} 100.5` }} />
        </svg>
      )}
    </button>
  );
}
