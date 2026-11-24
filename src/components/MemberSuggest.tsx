import { Heart } from 'lucide-react';
import { useMemo } from 'react';
import type { Person } from '../../shared/model';
import { Avatar, useUI } from '../ui';

/**
 * While a name is being typed for a house, shows matching people already on the
 * members list (or living elsewhere), so their details don't need retyping.
 */
export function MemberSuggest({ query, houseId, onPick }: { query: string; houseId: string | null; onPick: (p: Person) => void }) {
  const { data } = useUI();
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const digits = q.replace(/\D/g, '');
    return data.people
      .filter((p) => p.house_id !== houseId)
      .filter((p) => p.full_name.toLowerCase().includes(q) || (digits.length >= 4 && (p.phone ?? '').replace(/\D/g, '').includes(digits)))
      .sort((a, b) => Number(b.is_member) - Number(a.is_member) || Number(!a.house_id) - Number(!b.house_id))
      .slice(0, 5);
  }, [query, houseId, data.people]);

  if (!matches.length) return null;
  return (
    <div className="member-suggest">
      <span className="field-label">Already on your list?</span>
      {matches.map((p) => {
        const h = p.house_id ? data.houseById.get(p.house_id) : undefined;
        return (
          <button type="button" key={p.id} className="ms-row" onClick={() => onPick(p)}>
            <Avatar name={p.full_name} size={32} />
            <span className="row-text">
              <b>
                {p.full_name}
                {p.is_member && <Heart size={13} strokeWidth={2.2} className="member-heart" />}
              </b>
              <small>{[p.phone, h ? `lives at ${h.name || h.code}` : 'no house yet'].filter(Boolean).join(', ')}</small>
            </span>
            <span className="ms-use">Use</span>
          </button>
        );
      })}
    </div>
  );
}
