// empty.tsx — first-run empty state + no-results state
import { SOURCES, type SourceId } from './data';
import { Btn, SourceMark } from './components';
import { IcLayers, IcLink, IcPlus, IcRefresh, IcSearch, IcUpload } from './icons';

const SOURCE_HINTS: [SourceId, string][] = [
  ['scim', 'Paste a SCIM blueprint detail link'],
  ['sbp', 'Paste a Satisfactory Blueprints URL'],
  ['local', 'Drag in .sbp / .sbpcfg files'],
];

export function EmptyState({ onImport, onBrowse }: { onImport: () => void; onBrowse?: () => void }) {
  return (
    <div className="grid-bg" style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: 40, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '18%', left: '50%', transform: 'translateX(-50%)', width: 520, height: 320,
        background: 'radial-gradient(closest-side,var(--accent-glow),transparent)', opacity: .35,
        pointerEvents: 'none', filter: 'blur(10px)' }} />
      <div style={{ position: 'relative', textAlign: 'center', maxWidth: 560 }}>
        {/* emblem */}
        <div style={{ width: 88, height: 88, margin: '0 auto 24px', borderRadius: 20, position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(155deg,var(--panel-3),var(--panel))',
          border: '1px solid var(--border-strong)', boxShadow: '0 20px 50px -20px rgba(0,0,0,.7)' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: 20, padding: 1,
            background: 'linear-gradient(155deg,var(--accent-line),transparent 60%)',
            WebkitMask: 'linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0)',
            WebkitMaskComposite: 'xor', maskComposite: 'exclude', pointerEvents: 'none' }} />
          <IcLayers size={40} sw={1.3} style={{ color: 'var(--accent)' }} />
          <span style={{ position: 'absolute', top: -7, right: -7, width: 20, height: 20, borderRadius: '50%',
            background: 'var(--accent)', color: '#1a1206', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 14px var(--accent-glow)' }}><IcPlus size={13} sw={2.6} /></span>
        </div>
        <div className="tlabel" style={{ color: 'var(--accent)', marginBottom: 12 }}>Archive · 0 blueprints</div>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: '-.02em', textWrap: 'balance' }}>
          Start your blueprint archive</h1>
        <p style={{ margin: '13px auto 0', fontSize: 14.5, lineHeight: 1.6, color: 'var(--text-dim)', maxWidth: 440,
          textWrap: 'pretty' }}>
          Import blueprints from a deep link, a direct file URL, or local <span className="mono"
          style={{ color: 'var(--text)' }}>.sbp</span> files — then organize, preview, and export them straight
          into your game folder.</p>
        <div style={{ display: 'flex', gap: 11, justifyContent: 'center', marginTop: 24 }}>
          <Btn variant="primary" size="lg" icon={IcLink} onClick={onImport}>Import from URL</Btn>
          <Btn variant="solid" size="lg" icon={IcUpload} onClick={onBrowse} disabled={!onBrowse}
            title={onBrowse ? 'Add .sbp / .sbpcfg files to the current world' : 'Works in the desktop app'}>Browse local files</Btn>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 11, marginTop: 34, textAlign: 'left' }}>
          {SOURCE_HINTS.map(([id, hint]) => (
            <div key={id} style={{ padding: 14, borderRadius: 'var(--r-md)', background: 'var(--panel)',
              border: '1px solid var(--border)' }}>
              <SourceMark src={id} size={22} />
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 10 }}>{SOURCES[id].label}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-mute)', marginTop: 4, lineHeight: 1.5 }}>{hint}</div>
            </div>
          ))}
        </div>
        <div className="hazard" style={{ height: 5, borderRadius: 3, marginTop: 30, opacity: .5 }} />
      </div>
    </div>
  );
}

export function NoResults({ onReset, title = 'No blueprints match', hint = 'Try a different search or relax your filters.', resetLabel = 'Reset filters' }:
  { onReset?: () => void; title?: string; hint?: string; resetLabel?: string }) {
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 40, color: 'var(--text-mute)' }}>
      <div style={{ width: 60, height: 60, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--panel)', border: '1px solid var(--border)', marginBottom: 18 }}>
        <IcSearch size={26} /></div>
      <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      <p style={{ fontSize: 13, margin: '8px 0 18px' }}>{hint}</p>
      {onReset && <Btn variant="ghost" icon={IcRefresh} onClick={onReset}>{resetLabel}</Btn>}
    </div>
  );
}
