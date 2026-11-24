import { Crosshair, Landmark, Loader2, MapPinned, Route, Search, X, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isDirect, isGhanaPostGps, lookup, type Place } from '../geocode';
import { StatusDot, useUI } from '../ui';

const KIND_ICON: Record<Place['kind'], LucideIcon> = { coords: Crosshair, area: MapPinned, landmark: Landmark, street: Route, place: MapPinned };

function mapCentre(me: { lat: number; lng: number } | null) {
  try {
    const v = JSON.parse(localStorage.getItem('ffim.view') ?? 'null');
    if (v && typeof v.lat === 'number') return { lat: v.lat, lng: v.lng };
  } catch {
    /* ignore */
  }
  return me ?? { lat: 5.6037, lng: -0.187 };
}

export function SearchBar() {
  const { data, showHouse, showPlace, me, mode } = useUI();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Draw mode starts with the search box ready
  useEffect(() => {
    if (mode.kind === 'draw' && !mode.points.length) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode.kind]);

  const direct = isDirect(q);
  const local = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2 || direct) return [];
    const out: { id: string; title: string; sub: string }[] = [];
    for (const h of data.houses) {
      const people = data.peopleByHouse.get(h.id) ?? [];
      const hay = [h.code, h.name, h.address, ...people.flatMap((p) => [p.full_name, p.phone])].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(s)) continue;
      const who = people.find((p) => p.full_name.toLowerCase().includes(s))?.full_name;
      out.push({ id: h.id, title: who ?? h.name ?? h.address ?? h.code, sub: [h.code, h.address].filter((x) => x && x !== (who ?? h.name ?? h.address ?? h.code)).join(', ') });
      if (out.length >= 6) break;
    }
    return out;
  }, [q, data, direct]);

  useEffect(() => {
    const t = q.trim();
    setErr(null);
    if (!t || isGhanaPostGps(t) || (!direct && t.length < 3)) {
      setPlaces([]);
      setBusy(false);
      return;
    }
    const n = ++seq.current;
    setBusy(true);
    const timer = setTimeout(
      () => {
        lookup(t, mapCentre(me))
          .then((r) => n === seq.current && setPlaces(r))
          .catch((e) => n === seq.current && setErr(e.message))
          .finally(() => n === seq.current && setBusy(false));
      },
      direct ? 0 : 400,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, direct]);

  // A pasted link or coordinates goes straight there
  useEffect(() => {
    if (direct && places.length === 1) pick(places[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places]);

  function pick(p: Place) {
    showPlace(p);
    setQ(p.name);
    setOpen(false);
    inputRef.current?.blur();
  }

  const t = q.trim();
  const showBox = open && t.length >= 2;

  return (
    <div className="search">
      {busy ? <Loader2 size={18} className="muted spin" /> : <Search size={18} strokeWidth={1.75} className="muted" />}
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          if (places[0]) pick(places[0]);
          else if (local[0]) showHouse(local[0].id);
        }}
        placeholder={mode.kind === 'draw' ? 'Search an area to outline' : 'Places, houses, people, links'}
        aria-label="Search"
        enterKeyHint="search"
      />
      {q && (
        <button
          className="search-clear"
          onClick={() => {
            setQ('');
            setPlaces([]);
            showPlace(null);
          }}
          aria-label="Clear"
        >
          <X size={16} />
        </button>
      )}
      {showBox && (
        <div className="search-results">
          {local.map((r) => (
            <button key={r.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { showHouse(r.id); setOpen(false); }}>
              <span className="sr-icon">
                <StatusDot status={data.statusById.get(r.id)!} size={10} />
              </span>
              <span className="row-text">
                <b>{r.title}</b>
                {r.sub && <small>{r.sub}</small>}
              </span>
            </button>
          ))}
          {local.length > 0 && places.length > 0 && <hr />}
          {places.map((p) => {
            const Icon = KIND_ICON[p.kind];
            return (
              <button key={p.id} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
                <span className="sr-icon">
                  <Icon size={17} strokeWidth={1.8} />
                </span>
                <span className="row-text">
                  <b>{p.name}</b>
                  {p.detail && <small>{p.detail}</small>}
                </span>
              </button>
            );
          })}
          {isGhanaPostGps(t) && <p className="sr-note">GhanaPost GPS addresses can’t be looked up here. Paste a Google Maps link or the coordinates instead.</p>}
          {err && <p className="sr-note error">{err}</p>}
          {!busy && !err && !isGhanaPostGps(t) && !local.length && !places.length && (t.length >= 3 || direct) && <p className="sr-note">Nothing found</p>}
        </div>
      )}
    </div>
  );
}
