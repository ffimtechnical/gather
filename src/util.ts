export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Compact relative time: "now", "12m", "3h", "5d", "2w", or a date. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'Now';
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d`;
  const w = Math.round(d / 7);
  if (w < 9) return `${w}w`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "Today", "Tomorrow", "Overdue", or a short weekday/date. */
export function dueLabel(day: string | null): { text: string; late: boolean } | null {
  if (!day) return null;
  const today = todayStr();
  if (day < today) return { text: 'Overdue', late: true };
  if (day === today) return { text: 'Today', late: false };
  if (day === todayStr(1)) return { text: 'Tomorrow', late: false };
  return { text: new Date(day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }), late: false };
}

/** Next Sunday (end of this week). */
export function endOfWeekStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return localDateStr(d);
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function todayStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return localDateStr(d);
}

export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO string → value for <input type="datetime-local"> */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${localDateStr(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function phoneLinks(phone: string) {
  const digits = phone.replace(/[^\d+]/g, '');
  return { tel: `tel:${digits}`, whatsapp: `https://wa.me/${digits.replace(/^\+/, '')}`, sms: `sms:${digits}` };
}

export function directionsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
