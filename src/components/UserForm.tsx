import { Power } from 'lucide-react';
import { useState } from 'react';
import { ROLES, type Role, type User } from '../../shared/model';
import { ROLE_ICON } from '../icons';
import { api } from '../session';
import { syncNow } from '../sync';
import { Chips, Field, Modal, Toggle, nul, useUI } from '../ui';

export function UserForm({ user }: { user?: User }) {
  const { data, closeModal, toast } = useUI();
  const isAdmin = data.perms.isAdmin;
  const isSelf = user?.id === data.me.id;
  const zones = data.zones.filter((z) => data.myZoneIds === null || data.myZoneIds.includes(z.id));
  const [f, setF] = useState({
    name: user?.name ?? '',
    phone: user?.phone ?? '',
    role: (user?.role ?? 'member') as Role,
    zone_id: user ? user.zone_id : zones.length === 1 ? zones[0].id : null,
    active: user?.active ?? true,
  });
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={user ? user.name : 'Add to team'} onClose={closeModal}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!f.name.trim()) return toast('Add a name');
          setBusy(true);
          try {
            await api('users', { id: user?.id, name: f.name.trim(), phone: nul(f.phone), role: f.role, zone_id: f.zone_id, active: f.active });
            toast(user ? 'Saved' : `${f.name.trim()} added`);
            closeModal();
            void syncNow();
          } catch (err) {
            toast((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className="big-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Full name" aria-label="Full name" autoFocus={!user} />
        <input type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Phone (optional)" aria-label="Phone" />
        {isAdmin && !isSelf && <Chips options={ROLES} icons={ROLE_ICON} value={f.role} onChange={(role) => setF({ ...f, role })} />}
        {!isSelf && zones.length > 0 && (
          <Field label={f.role === 'pastor' ? 'Home zone (pastors lead zones set under Zones)' : 'Zone'}>
            <Chips options={zones.map((z) => ({ value: z.id, label: z.name }))} value={f.zone_id} onChange={(zone_id) => setF({ ...f, zone_id: f.zone_id === zone_id ? null : zone_id })} />
          </Field>
        )}
        {user && !isSelf && <Toggle icon={Power} checked={f.active} onChange={(active) => setF({ ...f, active })} label="Can sign in" />}
        <div className="form-actions">
          <span className="grow" />
          <button className="btn primary" disabled={busy}>
            {user ? 'Save' : 'Add'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
