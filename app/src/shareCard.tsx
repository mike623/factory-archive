// shareCard.tsx — "Share with players" panel (sidebar) + import toasts
import { useState } from 'react';
import { copyText } from './platform';
import type { ShareStateUI } from './share';
import { Dot } from './components';
import { IcCheck, IcClose, IcCopy, IcShare } from './icons';

const AUTO = '__auto__';
const SOURCE_LABEL = { autosave: 'latest autosave', blueprints: 'last used' } as const;

export function ShareCard({ share }: { share: ShareStateUI }) {
  const { info, busy, error, available, toggle, sessions, pinSession } = share;
  const [copied, setCopied] = useState(false);
  const on = !!info;
  const url = info?.urls[0];
  const detected = sessions?.detected;
  const target = sessions?.pinned ?? detected?.name;

  const copy = async () => {
    if (url && await copyText(url)) { setCopied(true); setTimeout(() => setCopied(false), 1400); }
  };

  return (
    <div style={{ padding: '10px 11px', borderRadius: 'var(--r)', background: 'var(--panel)',
      border: `1px solid ${on ? 'var(--accent-line)' : 'var(--border)'}`, transition: 'border-color .15s' }}>
      <button role="switch" aria-checked={on} onClick={toggle} disabled={!available || busy}
        title={available ? undefined : 'Available in the desktop app'}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 0, background: 'none', border: 'none',
          color: on ? 'var(--text)' : 'var(--text-dim)', fontSize: 12.5, fontWeight: 600, opacity: available ? 1 : .5 }}>
        <IcShare size={15} style={{ color: on ? 'var(--accent)' : 'var(--text-mute)', flexShrink: 0 }} />
        <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap' }}>Share on LAN</span>
        <span style={{ width: 28, height: 16, borderRadius: 99, flexShrink: 0, position: 'relative',
          background: on ? 'var(--accent)' : 'var(--track-off)', transition: 'background .15s' }}>
          <span style={{ position: 'absolute', top: 2, left: on ? 14 : 2, width: 12, height: 12, borderRadius: '50%',
            background: 'var(--knob)', transition: 'left .15s var(--ease)' }} />
        </span>
      </button>

      {!available && <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-mute)', marginTop: 7 }}>Desktop app only</div>}

      {on && url && <>
        <button onClick={copy} title="Copy link for players"
          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', marginTop: 9, height: 28, padding: '0 8px',
            borderRadius: 5, background: 'var(--well)', border: '1px solid var(--border)', color: 'var(--accent-bright)' }}>
          <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 10.5, textAlign: 'left', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url.replace(/^http:\/\//, '')}</span>
          {copied ? <IcCheck size={13} /> : <IcCopy size={13} />}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
          <Dot />
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-mute)' }}>Same network · no PIN</span>
        </div>
      </>}

      {available && sessions && <label style={{ display: 'block', marginTop: 9 }}>
        <span className="tlabel" style={{ fontSize: 8.5 }}>Imports go to</span>
        <select value={sessions.pinned ?? AUTO} onChange={e => pinSession(e.target.value === AUTO ? null : e.target.value)}
          style={{ width: '100%', marginTop: 4, height: 26, padding: '0 4px', borderRadius: 5, background: 'var(--well)',
            border: '1px solid var(--border)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 10.5, outline: 'none' }}>
          <option value={AUTO}>{detected ? `Auto · ${detected.name} (${SOURCE_LABEL[detected.source]})` : 'Auto · no world found'}</option>
          {sessions.sessions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {!target && <div style={{ fontSize: 10.5, color: 'var(--warn)', marginTop: 5, lineHeight: 1.4 }}>
          Play the world once (or save a blueprint in it) so it can be detected.</div>}
      </label>}

      {error && <div style={{ fontSize: 10.5, color: 'var(--danger)', marginTop: 7, lineHeight: 1.4 }}>{error}</div>}
    </div>
  );
}

export function ImportToasts({ share }: { share: ShareStateUI }) {
  if (!share.imports.length) return null;
  return (
    <div aria-live="polite" style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 60, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {share.imports.map(i => (
        <div key={i.at} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: 320, padding: '11px 12px',
          borderRadius: 10, background: 'var(--floatbar)', backdropFilter: 'blur(10px)', border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-lg)', animation: 'fadein .2s' }}>
          <IcShare size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.45 }}>
            A player added <strong>{i.name}</strong> to <strong>{i.session}</strong>.
            <div style={{ color: 'var(--text-mute)', fontSize: 11.5 }}>Load the session again to see it in-game.</div>
          </div>
          <button onClick={() => share.dismiss(i.at)} aria-label="Dismiss"
            style={{ background: 'none', border: 'none', color: 'var(--text-mute)', display: 'flex', padding: 2 }}><IcClose size={14} /></button>
        </div>
      ))}
    </div>
  );
}
