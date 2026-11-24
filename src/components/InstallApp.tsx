import { Download, Share, SquarePlus, X } from 'lucide-react';
import { useState } from 'react';
import { installApp, useInstall } from '../install';
import { ICON, ICON_SM } from '../icons';

/** "Install app" row. Hidden when the app is already installed or the browser can't install it. */
export function InstallApp({ compact = false }: { compact?: boolean }) {
  const way = useInstall();
  const [iosHelp, setIosHelp] = useState(false);
  if (way === 'installed' || way === 'none') return null;

  const onTap = () => (way === 'prompt' ? void installApp() : setIosHelp(true));

  return (
    <>
      <button className={compact ? 'install-link' : 'install-row'} onClick={onTap}>
        <Download {...(compact ? ICON_SM : ICON)} />
        <span className="grow">{compact ? 'Install app' : 'Install on this phone'}</span>
        {!compact && <small>Opens full screen</small>}
      </button>
      {iosHelp && (
        <div className="ios-help" role="dialog" aria-label="Add to Home Screen" onClick={() => setIosHelp(false)}>
          <div className="ios-card" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn ios-close" onClick={() => setIosHelp(false)} aria-label="Close">
              <X {...ICON} />
            </button>
            <h2>Add to Home Screen</h2>
            <ol>
              <li>
                <span className="ios-step"><Share {...ICON} /></span>
                Tap <b>Share</b> in Safari’s toolbar
              </li>
              <li>
                <span className="ios-step"><SquarePlus {...ICON} /></span>
                Choose <b>Add to Home Screen</b>
              </li>
            </ol>
            <p className="muted small">Then open Gather from its icon. It runs full screen, like any app.</p>
          </div>
        </div>
      )}
    </>
  );
}
