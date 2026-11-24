import { Navigation } from 'lucide-react';
import { directionsUrl } from '../util';

/** Small corner button: turn-by-turn directions in Google Maps (or the phone's maps app). */
export function Directions({ lat, lng }: { lat: number; lng: number }) {
  return (
    <a className="icon-btn directions-btn" href={directionsUrl(lat, lng)} target="_blank" rel="noreferrer" aria-label="Directions in Google Maps" title="Directions in Google Maps">
      <Navigation size={19} strokeWidth={2} />
    </a>
  );
}
