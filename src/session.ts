/** Who is signed in on this phone, and calls to the server. */
import type { User } from '../shared/model';

export const API = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

interface Session {
  token: string;
  user: User;
}

const KEY = 'ffim.session';

export function getSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function setSession(s: Session | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
  listeners.forEach((fn) => fn(s));
}

const listeners = new Set<(s: Session | null) => void>();
export function onSession(fn: (s: Session | null) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export const myName = () => getSession()?.user.name ?? null;
export const myId = () => getSession()?.user.id ?? null;

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: Record<string, unknown>) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const token = getSession()?.token;
  let res: Response;
  try {
    res = await fetch(`${API}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'No connection. Try again when you have signal.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Server error ${res.status}`, data);
  return data as T;
}
