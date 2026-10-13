// UpdateBanner.tsx — "Update available" pill at the top of the window
import type { UpdaterState } from './updater';
import { Btn } from './components';
import { IcClose, IcDownload, IcRefresh } from './icons';

export function UpdateBanner({ u }: { u: UpdaterState }) {
  if (!u.visible) return null;
  const busy = u.phase === 'downloading' || u.phase === 'ready';
  return (
    <div role="status" style={{ position: 'fixed', top: 12, left: 'calc(50% + 105px)', transform: 'translateX(-50%)',
      zIndex: 70, display: 'flex', alignItems: 'center', gap: 12, padding: '7px 7px 7px 14px', borderRadius: 11,
      background: 'var(--floatbar)', backdropFilter: 'blur(10px)', border: '1px solid var(--accent-line)',
      boxShadow: 'var(--shadow-lg)', animation: 'fadein .2s', maxWidth: 'calc(100vw - 260px)' }}>
      <IcRefresh size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <span style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
        {u.phase === 'error'
          ? <span style={{ color: 'var(--danger)' }}>Update failed — {u.error}</span>
          : busy
            ? <>Updating to <strong className="mono">v{u.version}</strong>
                {u.progress >= 0 && u.phase === 'downloading' && <span className="mono" style={{ color: 'var(--text-mute)' }}> · {Math.round(u.progress * 100)}%</span>}
                {u.phase === 'ready' && <span style={{ color: 'var(--text-mute)' }}> · restarting…</span>}</>
            : <>Version <strong className="mono">v{u.version}</strong> is available</>}
      </span>
      {!busy && <Btn variant="primary" size="sm" icon={IcDownload} onClick={u.install}>
        {u.phase === 'error' ? 'Try again' : 'Install & restart'}</Btn>}
      {!busy && <button onClick={u.dismiss} aria-label="Later" title="Later"
        style={{ display: 'flex', padding: 6, background: 'none', border: 'none', color: 'var(--text-mute)' }}><IcClose size={14} /></button>}
    </div>
  );
}
