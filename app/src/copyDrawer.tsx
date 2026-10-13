// copyDrawer.tsx — copy selected on-disk blueprints into another world session
import { useEffect, useState } from 'react';
import type { Blueprint } from './data';
import { Btn, FilePair, HeaderGlyph, IconBtn, Thumb } from './components';
import { IcCheck, IcClose, IcCopy, IcFolder, IcInfo, IcWarn } from './icons';
import type { Outcome } from './platform';

type Phase = 'idle' | 'running' | 'done';

export function CopyDrawer({ open, items, sessions, defaultTarget, onClose, onRemove, onCopy, onOpenTarget }: {
  open: boolean; items: Blueprint[];
  /** world sessions that exist, newest first */
  sessions: string[]; defaultTarget: string | null;
  onClose: () => void; onRemove: (id: string) => void;
  onCopy: (target: string) => Promise<Outcome[]>;
  onOpenTarget: (target: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [target, setTarget] = useState<string>('');
  const [results, setResults] = useState<Map<string, Outcome>>(new Map());
  const [snapshot, setSnapshot] = useState<Blueprint[]>([]);

  useEffect(() => {
    if (!open) return;
    setPhase('idle'); setResults(new Map()); setSnapshot([]);
    // default to the current world unless everything selected already lives there
    const from = new Set(items.map(b => b.session));
    const pick = defaultTarget && !(from.size === 1 && from.has(defaultTarget)) ? defaultTarget : sessions.find(s => !from.has(s));
    setTarget(pick ?? sessions[0] ?? '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = phase === 'idle' ? items : snapshot;
  const sameWorld = list.filter(b => b.session === target).length;
  const copyable = list.length - sameWorld;

  const run = async () => {
    if (!target || !copyable) return;
    setSnapshot(items); setPhase('running');
    try {
      const out = await onCopy(target);
      setResults(new Map(out.map(o => [o.name, o])));
    } catch (e) {
      setResults(new Map(items.map(b => [b.name, { name: b.name, ok: false, error: String(e) }])));
    }
    setPhase('done');
  };

  if (!open) return null;
  const copied = [...results.values()].filter(o => o.ok).length;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 45, background: 'rgba(5,6,8,.6)',
      display: 'flex', justifyContent: 'flex-end' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="copy-title" onClick={e => e.stopPropagation()}
        style={{ width: 420, maxWidth: '100vw', height: '100%', background: 'var(--panel)',
        borderLeft: '1px solid var(--border-strong)', boxShadow: '-20px 0 60px -20px rgba(0,0,0,.7)',
        display: 'flex', flexDirection: 'column', animation: 'drawerin .22s var(--ease)' }}>
        <div style={{ padding: '17px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <HeaderGlyph icon={IcCopy} />
            <div style={{ flex: 1 }}>
              <div id="copy-title" style={{ fontSize: 15, fontWeight: 700 }}>Copy to another world</div>
              <div className="tlabel" style={{ fontSize: 9, marginTop: 2 }}>
                {list.length} selected · {list.filter(b => b.files.sbpcfg).length} with .sbpcfg</div>
            </div>
            <IconBtn icon={IcClose} onClick={onClose} title="Close" />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 13, padding: '10px 11px',
            borderRadius: 'var(--r)', background: 'var(--bg-deep)', border: '1px solid var(--border)' }}>
            <IcFolder size={16} style={{ color: 'var(--steel)', flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="tlabel" style={{ fontSize: 8.5, display: 'block' }}>Into world session</span>
              <select value={target} onChange={e => setTarget(e.target.value)} disabled={phase !== 'idle'}
                style={{ width: '100%', marginTop: 3, height: 26, padding: '0 4px', borderRadius: 5,
                background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)',
                fontFamily: 'var(--font-mono)', fontSize: 11, outline: 'none' }}>
                {sessions.map(s => <option key={s} value={s}>{s}{s === defaultTarget ? '  (current)' : ''}</option>)}
              </select>
            </span>
          </label>
          {phase === 'idle' && <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 9,
            fontSize: 11, color: 'var(--warn)' }}>
            <IcInfo size={13} style={{ flexShrink: 0 }} />Then reload that save in-game to see them</div>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {list.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '40px 20px',
            fontSize: 13 }}>No blueprints selected.<br />Tick cards in the library to copy them.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map(b => {
              const r = results.get(b.name);
              const skip = b.session === target;
              return (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px',
                  borderRadius: 'var(--r)', background: 'var(--panel-2)', border: '1px solid var(--border)', opacity: skip && phase === 'idle' ? .55 : 1 }}>
                  <div style={{ width: 48, height: 34, borderRadius: 5, overflow: 'hidden', flexShrink: 0,
                    border: '1px solid var(--border)' }}><Thumb hue={b.hue} seed={b.seed} label="" /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                    <div className="mono" style={{ marginTop: 4, fontSize: 10, color: 'var(--text-mute)' }}>
                      {r ? (r.ok
                        ? <span style={{ color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 5 }}><IcCheck size={12} />Copied</span>
                        : <span style={{ color: 'var(--warn)' }}>{r.error}</span>)
                        : skip ? 'Already in this world' : <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            from {b.session}<FilePair files={b.files} compact /></span>}
                    </div>
                  </div>
                  {phase === 'idle' && <button onClick={() => onRemove(b.id)} aria-label={`Remove ${b.name}`}
                    style={{ color: 'var(--text-mute)', background: 'none', border: 'none', display: 'flex', padding: 4 }}>
                    <IcClose size={15} /></button>}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ padding: '15px 18px', borderTop: '1px solid var(--border)' }}>
          {phase === 'done'
            ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600,
                  color: copied ? 'var(--ok)' : 'var(--warn)' }}>
                  {copied ? <IcCheck size={18} /> : <IcWarn size={18} />}Copied {copied} of {snapshot.length}</div>
                <Btn variant="ghost" icon={IcFolder} onClick={() => onOpenTarget(target)}>Open</Btn>
                <Btn variant="solid" onClick={onClose}>Done</Btn></div>
            : <Btn variant="primary" full size="lg" icon={IcCopy} disabled={!copyable || !target || phase === 'running'} onClick={run}>
                {phase === 'running' ? 'Copying…' : `Copy ${copyable} to ${target || '…'}`}</Btn>}
        </div>
      </div>
    </div>
  );
}
