/** App-wide UI state and small reusable pieces. */
import { X, type LucideIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { STATUS_INFO, type Status, type User } from '../shared/model';
import type { AppData } from './data';
import type { Place } from './geocode';
import { ICON, ICON_SM } from './icons';

export type Tab = 'map' | 'tasks' | 'ask' | 'people' | 'manage';
export type MapMode =
  | { kind: 'browse' }
  | { kind: 'add' }
  | { kind: 'select'; ids: string[] }
  | { kind: 'draw'; zoneId?: string; points: [number, number][] }
  | { kind: 'church' }
  | { kind: 'pick-house'; personId: string; name: string };

export interface ToastMsg {
  text: string;
  actions?: { label: string; run: () => void }[];
  n: number;
}

export interface UIState {
  data: AppData;
  tab: Tab;
  setTab: (t: Tab) => void;
  selectedId: string | null;
  select: (id: string | null) => void;
  showHouse: (id: string) => void;
  focus: { lat: number; lng: number; zoom?: number; bounds?: [number, number, number, number]; n: number } | null;
  /** A searched place shown with a pin */
  place: Place | null;
  showPlace: (p: Place | null) => void;
  /** A road route drawn on the map */
  route: [number, number][] | null;
  showRoute: (r: [number, number][] | null) => void;
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  fitZone: (zoneId: string) => void;
  fitArea: (pts: [number, number][]) => void;
  mode: MapMode;
  setMode: (m: MapMode) => void;
  me: { lat: number; lng: number } | null;
  setMe: (p: { lat: number; lng: number } | null) => void;
  toast: (text: string, actions?: ToastMsg['actions']) => void;
  openModal: (n: ReactNode) => void;
  closeModal: () => void;
}

export const UI = createContext<UIState>(null as unknown as UIState);
export const useUI = () => useContext(UI);

// ---------------------------------------------------------------------------

export function StatusDot({ status, size = 10 }: { status: Status; size?: number }) {
  return <span className="dot" style={{ width: size, height: size, background: STATUS_INFO[status].color }} />;
}

export function StatusTag({ status }: { status: Status }) {
  const s = STATUS_INFO[status];
  return (
    <span className="status-tag" style={{ color: s.color }}>
      <StatusDot status={status} size={8} />
      {s.label}
    </span>
  );
}

const AV_COLORS = ['#2f7a4f', '#3b6f8f', '#8a5a2b', '#6d5a8e', '#9b4d63', '#3c7f7a', '#7a7428'];
export function Avatar({ user, name, size = 32 }: { user?: Pick<User, 'id' | 'name'> | null; name?: string; size?: number }) {
  const n = user?.name ?? name ?? '?';
  const key = user?.id ?? n;
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  const initials = n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: AV_COLORS[Math.abs(h) % AV_COLORS.length] }} title={n}>
      {initials}
    </span>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X {...ICON} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

export function Toggle({ checked, onChange, label, icon: Icon }: { checked: boolean; onChange: (v: boolean) => void; label: string; icon?: LucideIcon }) {
  return (
    <button type="button" className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} aria-pressed={checked}>
      {Icon && <Icon {...ICON} />}
      <span className="grow">{label}</span>
      <span className="switch">
        <span />
      </span>
    </button>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
  icons,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  icons?: Partial<Record<string, LucideIcon>>;
}) {
  return (
    <div className="chips">
      {options.map((o) => {
        const Icon = icons?.[o.value];
        return (
          <button type="button" key={o.value} className={`chip ${value === o.value ? 'active' : ''}`} onClick={() => onChange(o.value)}>
            {Icon && <Icon {...ICON_SM} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Square icon button with a short caption underneath. */
export function Action({ icon: Icon, label, onClick, href, primary, disabled }: { icon: LucideIcon; label: string; onClick?: () => void; href?: string; primary?: boolean; disabled?: boolean }) {
  const cls = `action ${primary ? 'primary' : ''}`;
  const inner = (
    <>
      <span className="action-icon">
        <Icon {...ICON} />
      </span>
      <span className="action-label">{label}</span>
    </>
  );
  return href ? (
    <a className={cls} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
      {inner}
    </a>
  ) : (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={36} strokeWidth={1.4} />
      <p>{title}</p>
      {children}
    </div>
  );
}

export function useToastState() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), msg.actions?.length ? 6000 : 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg, (text: string, actions?: ToastMsg['actions']) => setMsg({ text, actions, n: Date.now() }), () => setMsg(null)] as const;
}

export function nul(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}
