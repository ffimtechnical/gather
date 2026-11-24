/** The church's logo and name: set by an admin, cached on the phone for offline use. */
import { useEffect, useState } from 'react';
import { api } from './session';

export const DEFAULT_LOGO = '/logo.png';
export const DEFAULT_NAME = 'FFIM Gather';

export interface Church {
  lat: number;
  lng: number;
  name: string;
}

export interface Branding {
  logo: string | null;
  name: string | null;
  church?: Church | null;
  version?: string | null;
}

const KEY = 'ffim.brand';
let current: Branding = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? { logo: null, name: null };
  } catch {
    return { logo: null, name: null };
  }
})();
const subs = new Set<(b: Branding) => void>();

function apply(b: Branding) {
  current = b;
  localStorage.setItem(KEY, JSON.stringify(b));
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = b.logo ?? '/favicon.png';
  document.title = b.name || DEFAULT_NAME;
  subs.forEach((fn) => fn(b));
}

export async function refreshBranding() {
  try {
    const b = await api<Branding>('branding');
    if (b.version !== current.version || b.logo !== current.logo || b.name !== current.name || JSON.stringify(b.church) !== JSON.stringify(current.church)) apply(b);
  } catch {
    /* offline: keep cached */
  }
}

export const getChurch = () => current.church ?? null;

export async function saveBranding(patch: Partial<Branding>) {
  apply(await api<Branding>('branding', patch));
}

export function useBranding() {
  const [b, setB] = useState(current);
  useEffect(() => {
    subs.add(setB);
    return () => void subs.delete(setB);
  }, []);
  return { logo: b.logo ?? DEFAULT_LOGO, name: b.name || DEFAULT_NAME, custom: Boolean(b.logo), church: b.church ?? null };
}

/** Shrinks a picked image to a small square-ish PNG so it loads fast on every phone. */
export function imageToDataUrl(file: File, max = 384): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      const webp = c.toDataURL('image/webp', 0.9);
      resolve(webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = URL.createObjectURL(file);
  });
}
