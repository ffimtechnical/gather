import L from 'leaflet';
import { ListChecks, Map as MapIcon, Settings2, Sparkles, UserRound, Users, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '../shared/model';
import { Assistant } from './components/Assistant';
import { HouseSheet } from './components/HouseSheet';
import { Login } from './components/Login';
import { Manage } from './components/Manage';
import { MapView } from './components/MapView';
import { PeopleList } from './components/PeopleList';
import { PlaceCard } from './components/PlaceCard';
import { Tasks } from './components/Tasks';
import { useAppData } from './data';
import { refreshBranding } from './branding';
import { maybeRemind } from './reminders';
import { getSession, onSession } from './session';
import { startAutoSync, syncNow } from './sync';
import { UI, useToastState, type MapMode, type Tab, type UIState } from './ui';

export default function App() {
  const [session, setSessionState] = useState(getSession);
  useEffect(() => onSession(setSessionState), []);
  if (!session) return <Login />;
  return <Main key={session.user.id} sessionUser={session.user} />;
}

function Main({ sessionUser }: { sessionUser: User }) {
  const data = useAppData(sessionUser);
  const [tab, setTab] = useState<Tab>('map');
  const [selectedId, select] = useState<string | null>(null);
  const [focus, setFocus] = useState<UIState['focus']>(null);
  const [mode, setMode] = useState<MapMode>({ kind: 'browse' });
  const [me, setMe] = useState<UIState['me']>(null);
  const [place, setPlace] = useState<UIState['place']>(null);
  const [route, showRoute] = useState<UIState['route']>(null);
  useEffect(() => {
    showRoute(null);
  }, [selectedId]);
  const [modal, setModal] = useState<ReactNode>(null);
  const [toastMsg, toast, hideToast] = useToastState();

  useEffect(() => {
    startAutoSync();
    void syncNow();
    void refreshBranding();
    const t = setInterval(() => void refreshBranding(), 10 * 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (data.ready) void maybeRemind(data);
  }, [data]);

  const flyTo = useCallback((lat: number, lng: number, zoom?: number) => setFocus({ lat, lng, zoom, n: Date.now() }), []);
  const showHouse = useCallback(
    (id: string) => {
      const h = data.houseById.get(id);
      if (!h) return;
      setModal(null);
      setMode({ kind: 'browse' });
      setTab('map');
      select(id);
      showRoute(null);
      flyTo(h.lat, h.lng);
    },
    [data.houseById, flyTo],
  );
  const showPlace = useCallback((p: UIState['place']) => {
    setPlace(p);
    if (!p) return;
    setModal(null);
    setTab('map');
    select(null);
    const zoom = p.kind === 'area' ? 15 : p.kind === 'street' ? 17 : 18;
    setFocus({ lat: p.lat, lng: p.lng, zoom, bounds: p.kind === 'area' ? p.bounds : undefined, n: Date.now() });
  }, []);
  const fitZone = useCallback(
    (zoneId: string) => {
      const z = data.zoneById.get(zoneId);
      if (!z || z.polygon.length < 3) return;
      const c = L.latLngBounds(z.polygon).getCenter();
      setTab('map');
      select(null);
      setFocus({ lat: c.lat, lng: c.lng, zoom: 16, n: Date.now() });
    },
    [data.zoneById],
  );

  const ui: UIState = useMemo(
    () => ({
      data, tab, selectedId, select, showHouse, focus, flyTo, fitZone, mode, setMode, me, setMe, toast, place, showPlace, route, showRoute,
      setTab: (t) => {
        setTab(t);
        if (t !== 'map') setMode({ kind: 'browse' });
      },
      openModal: setModal,
      closeModal: () => setModal(null),
    }),
    [data, tab, selectedId, showHouse, focus, flyTo, fitZone, mode, me, toast, place, showPlace, route],
  );

  const tabs: { id: Tab; icon: LucideIcon; label: string; badge?: number }[] = [
    { id: 'map', icon: MapIcon, label: 'Map' },
    { id: 'tasks', icon: ListChecks, label: data.perms.isLead ? 'Zones' : 'Tasks', badge: data.alerts.total },
    { id: 'ask', icon: Sparkles, label: 'Ask' },
    { id: 'people', icon: Users, label: 'People' },
    { id: 'manage', icon: data.perms.isLead ? Settings2 : UserRound, label: data.perms.isLead ? 'Manage' : 'Me' },
  ];

  return (
    <UI.Provider value={ui}>
      <div className="app">
        <main className="main">
          <MapView visible={tab === 'map'} />
          {tab === 'map' && mode.kind === 'browse' && <HouseSheet />}
          {tab === 'map' && mode.kind === 'browse' && !selectedId && place && <PlaceCard />}
          {tab === 'tasks' && <Tasks />}
          {tab === 'ask' && <Assistant />}
          {tab === 'people' && <PeopleList />}
          {tab === 'manage' && <Manage />}
        </main>

        <nav className="tabbar">
          {tabs.map(({ id, icon: Icon, label, badge }) => (
            <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => ui.setTab(id)} aria-current={tab === id}>
              <span className="tab-icon">
                <Icon size={22} strokeWidth={tab === id ? 2.1 : 1.7} />
                {!!badge && <i>{badge > 99 ? '99+' : badge}</i>}
              </span>
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {modal}
        {toastMsg && (
          <div className="toast" key={toastMsg.n} role="status">
            <span>{toastMsg.text}</span>
            {toastMsg.actions?.map((a) => (
              <button
                key={a.label}
                onClick={() => {
                  hideToast();
                  a.run();
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </UI.Provider>
  );
}
