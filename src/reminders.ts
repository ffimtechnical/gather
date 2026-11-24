/** Daily reminder notification (shown once a day when the app is opened). */
import type { AppData } from './data';
import { todayStr } from './util';

export const remindersOn = () => localStorage.getItem('ffim.remind') === '1';

export async function enableReminders(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  const p = await Notification.requestPermission();
  const ok = p === 'granted';
  localStorage.setItem('ffim.remind', ok ? '1' : '0');
  return ok;
}

export function disableReminders() {
  localStorage.setItem('ffim.remind', '0');
}

export async function maybeRemind(d: AppData) {
  if (!remindersOn() || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (localStorage.getItem('ffim.remindedOn') === todayStr()) return;
  const due = d.alerts.total;
  const members = d.alerts.membersDue.length;
  if (!due && !members) return;
  localStorage.setItem('ffim.remindedOn', todayStr());
  const body = [due && `${due} ${d.perms.isLead ? 'houses due' : 'tasks for you'}`, members && `${members} member household${members > 1 ? 's' : ''} to check on`]
    .filter(Boolean)
    .join(' · ');
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification('FFIM Gather', { body, icon: '/icon-192.png', tag: 'ffim-daily' });
    else new Notification('FFIM Gather', { body, icon: '/icon-192.png' });
  } catch {
    /* ignore */
  }
}
