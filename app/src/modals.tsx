// modals.tsx — import-from-URL modal + batch export drawer
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { dimsLabel, SOURCES, type Blueprint, type SourceId } from './data';
import { Btn, Dot, FilePair, HeaderGlyph, IconBtn, MiniTag, SourceBadge, SourceMark, Thumb } from './components';
import {
  IcCheck, IcClose, IcDimensions, IcDownload, IcExport, IcInfo, IcFolder, IcLink, IcMachine, IcPlus, IcPower, IcSearch, IcUpload,
  IcUser, IcWarn, type Icon,
} from './icons';
import { openFolder, tailPath } from './platform';
import type { GameFolderState } from './gameFolder';

export function detectSource(url: string): SourceId | null {
  const u = url.trim().toLowerCase();
  if (u.includes('satisfactory-calculator.com')) return 'scim';
  if (u.includes('satisfactoryblueprints.com')) return 'sbp';
  if (u.includes('.sbp') || u.includes('.sbpcfg') || u.startsWith('http')) return 'url';
  return null;
}

const EXAMPLES: { src: SourceId; url: string }[] = [
  { src: 'scim', url: 'https://satisfactory-calculator.com/en/blueprints/index/details/id/12162/name/Modular+Manufacturer+L' },
  { src: 'sbp',  url: 'https://satisfactoryblueprints.com/blueprint/c4ae7a98-699a-4aab-af31-61f99cfd71f0' },
];

const STEPS = ['Connecting to source', 'Reading blueprint metadata', 'Locating .sbp / .sbpcfg pair', 'Rendering preview'];

/** Mock resolver result — swap for a real fetch/parse in the Tauri backend. */
function mockResolve(src: SourceId, url: string): Blueprint {
  return {
    id: 'bp-new-' + Date.now(), name: 'Modular Manufacturer L', author: 'KapitanWalnut', source: src,
    category: 'Manufacturing', tags: ['Production', 'Modular', 'World Grid'], gameVersion: '1.0', modded: false,
    dims: { x: 32, y: 24, z: 18 }, power: { use: 480, gen: 0 }, machines: 42, materials: ['Heavy Modular Frame'],
    shots: 5, files: { sbp: true, sbpcfg: src !== 'url' }, status: 'none', hue: 38, seed: 7, sizeKB: 180,
    downloads: 0, added: new Date().toISOString().slice(0, 10), notes: 'Imported via deep link.', url,
  };
}

type ImportPhase = 'idle' | 'resolving' | 'resolved' | 'done' | 'failed' | 'saved';

export interface LinkImport { name: string; session: string; hasCfg: boolean; sizeKb: number }

export function ImportModal({ open, onClose, onAdd, onBrowse, target, importLink, findImported }: {
  open: boolean; onClose: () => void; onAdd: (b: Blueprint) => void;
  /** desktop app: download the blueprint behind the link into `target` */
  importLink?: (url: string) => Promise<LinkImport>;
  /** desktop app: name of the blueprint in `target` already downloaded from this link */
  findImported?: (url: string) => Promise<string | null>;
  /** desktop app: pick local .sbp files instead (they go to `target`) */
  onBrowse?: () => void; target?: string | null;
}) {
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [step, setStep] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState<LinkImport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = () => { timers.current.forEach(t => { clearInterval(t); clearTimeout(t); }); timers.current = []; };
  useEffect(() => {
    if (open) { setUrl(''); setPhase('idle'); setStep(0); timers.current.push(window.setTimeout(() => inputRef.current?.focus(), 60)); }
    return clearTimers;
  }, [open]);

  // spot links already in the target world, so they can't be added twice
  const [already, setAlready] = useState<string | null>(null);
  useEffect(() => {
    setAlready(null);
    if (!findImported || !url.trim() || phase === 'saved') return;
    let live = true;
    const t = window.setTimeout(() => findImported(url.trim()).then(n => { if (live) setAlready(n); }).catch(() => {}), 250);
    return () => { live = false; clearTimeout(t); };
  }, [url, target, phase, findImported]);

  const src = detectSource(url);
  const resolved = src ? mockResolve(src, url.trim()) : null;

  const resolve = async () => {
    if (!src || phase === 'resolving') return;
    setPhase('resolving'); setStep(0); setFailure(null); setSaved(null);
    if (importLink) {
      // desktop app: really download and save it; step through the checklist while that runs
      let i = 0;
      const t = window.setInterval(() => { i = Math.min(i + 1, STEPS.length - 1); setStep(i); }, 700);
      timers.current.push(t);
      try { setSaved(await importLink(url.trim())); setStep(STEPS.length); setPhase('saved'); }
      catch (e) { setFailure(String(e).replace(/^Error: /, '')); setPhase('failed'); }
      finally { clearInterval(t); }
      return;
    }
    let i = 0;
    const t = window.setInterval(() => { i++; setStep(i); if (i >= STEPS.length) { clearInterval(t); setPhase('resolved'); } }, 480);
    timers.current.push(t);
  };
  const add = () => {
    if (!resolved) return;
    setPhase('done');
    timers.current.push(window.setTimeout(() => { onAdd(resolved); onClose(); }, 900));
  };

  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'rgba(5,6,8,.78)' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="import-title" onClick={e => e.stopPropagation()}
        style={{ width: 560, maxWidth: 'calc(100vw - 32px)', maxHeight: '88%', overflow: 'auto',
        borderRadius: 'var(--r-lg)', background: 'var(--panel)', border: '1px solid var(--border-strong)',
        boxShadow: 'var(--shadow-lg)', animation: 'scalein .18s var(--ease)' }}>
        <DialogHeader icon={IcLink} id="import-title" title="Import blueprint" sub="Paste a deep link or direct file URL" onClose={onClose} />

        <div style={{ padding: 19 }}>
          {/* URL input */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            {src ? <div style={{ position: 'absolute', left: 11, display: 'flex' }}><SourceMark src={src} size={17} /></div>
                 : <IcLink size={16} style={{ position: 'absolute', left: 12, color: 'var(--text-mute)' }} />}
            <input ref={inputRef} value={url} onChange={e => { setUrl(e.target.value); setPhase('idle'); }}
              aria-label="Blueprint URL"
              onKeyDown={e => e.key === 'Enter' && resolve()} placeholder="https://satisfactory-calculator.com/…"
              disabled={phase === 'resolving' || phase === 'done'}
              style={{ width: '100%', height: 46, paddingLeft: 38, paddingRight: 14, borderRadius: 'var(--r)',
              background: 'var(--bg-deep)', border: `1px solid ${src ? 'var(--accent-line)' : 'var(--border)'}`,
              color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)', outline: 'none' }} />
          </div>
          {/* source detected */}
          <div style={{ height: 22, display: 'flex', alignItems: 'center', marginTop: 8 }} aria-live="polite">
            {url && (src
              ? <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: SOURCES[src].color }}>
                  <IcCheck size={13} />Detected source: <strong style={{ fontWeight: 600 }}>{SOURCES[src].label}</strong></span>
              : <span style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>Unrecognized URL — paste a SCIM, Satisfactory Blueprints, or direct .sbp link</span>)}
          </div>

          {/* examples */}
          {phase === 'idle' && <div style={{ marginTop: 6 }}>
            <div className="tlabel" style={{ marginBottom: 9 }}>Try an example</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {EXAMPLES.map((e, i) => (
                <button key={i} onClick={() => setUrl(e.url)} style={{ display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 11px', borderRadius: 'var(--r)', background: 'var(--panel-2)', border: '1px solid var(--border)',
                  textAlign: 'left', cursor: 'pointer' }}>
                  <SourceMark src={e.src} size={15} />
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)', flex: 1, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.url.replace(/^https?:\/\//, '')}</span>
                  <IcPlus size={14} style={{ color: 'var(--text-mute)' }} />
                </button>
              ))}
              <button onClick={onBrowse} disabled={!onBrowse} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 11,
                borderRadius: 'var(--r)', background: 'transparent', textAlign: 'left', cursor: onBrowse ? 'pointer' : 'default',
                border: '1.5px dashed var(--border-strong)', color: 'var(--text-mute)', marginTop: 2 }}>
                <IcUpload size={16} /><span style={{ fontSize: 12, flex: 1 }}>
                  …or <span style={{ color: onBrowse ? 'var(--accent-bright)' : undefined }}>browse</span> for local <span className="mono">.sbp</span> / <span className="mono">.sbpcfg</span> files, or drop them anywhere on the window
                  {onBrowse && target && <span style={{ display: 'block', marginTop: 2, fontSize: 11 }}>They'll be added to <strong style={{ color: 'var(--text-dim)' }}>{target}</strong></span>}
                  {!onBrowse && <span style={{ display: 'block', marginTop: 2, fontSize: 11 }}>Desktop app only</span>}</span>
              </button>
            </div>
          </div>}

          {phase === 'saved' && saved && <div role="status" style={{ marginTop: 14, display: 'flex', gap: 10, padding: '13px 14px',
            borderRadius: 'var(--r-md)', background: 'var(--ok-ghost)', border: '1px solid color-mix(in oklab,var(--ok) 30%,transparent)' }}>
            <IcCheck size={18} style={{ color: 'var(--ok)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5 }}>
              <div>Added <strong>{saved.name}</strong> to <strong>{saved.session}</strong></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <FilePair files={{ sbp: true, sbpcfg: saved.hasCfg }} compact />
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)' }}>{saved.sizeKb} KB</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-mute)', marginTop: 6 }}>Reload that save in-game to see it.</div>
            </div>
          </div>}

          {phase === 'failed' && failure && <div role="alert" style={{ marginTop: 14, display: 'flex', gap: 9, padding: '12px 13px',
            borderRadius: 'var(--r)', background: 'var(--warn-ghost)', border: '1px solid color-mix(in oklab,var(--warn) 30%,transparent)',
            color: 'var(--warn)', fontSize: 12.5, lineHeight: 1.5 }}>
            <IcWarn size={15} style={{ flexShrink: 0, marginTop: 2 }} /><span>{failure}</span></div>}

          {/* resolving */}
          {phase === 'resolving' && <div style={{ marginTop: 14, borderRadius: 'var(--r)', background: 'var(--bg-deep)',
            border: '1px solid var(--border)', padding: '14px 15px' }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0',
                color: i < step ? 'var(--ok)' : i === step ? 'var(--accent)' : 'var(--text-faint)', fontSize: 12.5 }}>
                {i < step ? <IcCheck size={15} /> : i === step
                  ? <span style={{ width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent',
                      borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                  : <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid currentColor', opacity: .4 }} />}
                <span className="mono" style={{ fontSize: 11.5 }}>{s}</span>
              </div>
            ))}
          </div>}

          {/* resolved preview */}
          {(phase === 'resolved' || phase === 'done') && resolved && <div style={{ marginTop: 14, borderRadius: 'var(--r-md)',
            overflow: 'hidden', border: '1px solid var(--border-strong)', background: 'var(--panel-2)' }}>
            <div style={{ display: 'flex', gap: 13, padding: 13 }}>
              <div style={{ width: 120, height: 80, borderRadius: 7, overflow: 'hidden', flexShrink: 0,
                border: '1px solid var(--border)' }}>
                <Thumb hue={resolved.hue} seed={resolved.seed} label="" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <SourceBadge src={resolved.source} /><span className="mono" style={{ fontSize: 10,
                    color: 'var(--text-mute)' }}>v{resolved.gameVersion}</span></div>
                <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.01em' }}>{resolved.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color: 'var(--text-mute)' }}>
                  <IcUser size={12} /><span className="mono" style={{ fontSize: 11 }}>{resolved.author}</span></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 9 }}>
                  <Meta icon={IcDimensions}>{dimsLabel(resolved)}</Meta>
                  <Meta icon={IcMachine}>{resolved.machines}</Meta>
                  <Meta icon={IcPower}>{`${resolved.power?.use ?? 0}MW`}</Meta>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px',
              borderTop: '1px solid var(--border)', background: 'var(--bg-deep)' }}>
              <FilePair files={resolved.files} />
              {!resolved.files.sbpcfg && <span style={{ fontSize: 11, color: 'var(--warn)', display: 'flex',
                alignItems: 'center', gap: 5 }}><IcWarn size={13} />config not bundled</span>}
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', gap: 5 }}>{resolved.tags.slice(0, 2).map(t => <MiniTag key={t} size={9.5}>{t}</MiniTag>)}</div>
            </div>
          </div>}
        </div>

        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 19px',
          borderTop: '1px solid var(--border)' }}>
          <span className="tlabel" style={{ fontSize: 9, color: 'var(--text-faint)' }}>
            {importLink
              ? (already ? <span style={{ color: 'var(--warn)' }}>{`Already imported: in ${target} as "${already}"`}</span>
                : target ? `Downloads into ${target}` : 'Pick a world session in the filters first')
              : phase === 'done' ? '✓ Added to library' : 'Import adds to library — export to game folder separately'}</span>
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          {phase === 'saved'
            ? <Btn variant="primary" icon={IcCheck} onClick={onClose}>Done</Btn>
            : phase === 'resolved' || phase === 'done'
            ? <Btn variant="primary" icon={phase === 'done' ? IcCheck : IcPlus} disabled={phase === 'done'} onClick={add}>
                {phase === 'done' ? 'Added' : 'Add to library'}</Btn>
            : <Btn variant="primary" icon={importLink ? IcDownload : IcSearch} disabled={!src || phase === 'resolving' || (!!importLink && (!target || !!already))} onClick={resolve}>
                {phase === 'resolving' ? (importLink ? 'Downloading…' : 'Resolving…') : importLink ? 'Download & add' : 'Resolve link'}</Btn>}
        </div>
      </div>
    </div>
  );
}

function DialogHeader({ icon, id, title, sub, onClose }: { icon: Icon; id: string; title: string; sub: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '17px 19px', borderBottom: '1px solid var(--border)' }}>
      <HeaderGlyph icon={icon} />
      <div style={{ flex: 1 }}>
        <div id={id} style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '-.01em' }}>{title}</div>
        <div className="tlabel" style={{ fontSize: 9, marginTop: 2 }}>{sub}</div>
      </div>
      <IconBtn icon={IcClose} onClick={onClose} title="Close" />
    </div>
  );
}

function Meta({ icon: Ic, children }: { icon: Icon; children: ReactNode }) {
  return <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text-dim)' }}>
    <Ic size={13} style={{ color: 'var(--text-mute)' }} /><span className="mono" style={{ fontSize: 11.5 }}>{children}</span></span>;
}

/* ============ EXPORT DRAWER ============ */
type ExportPhase = 'idle' | 'running' | 'done';

export function ExportDrawer({ open, items, gameFolder, onClose, onRemove, onExported }: {
  open: boolean; items: Blueprint[]; gameFolder: GameFolderState; onClose: () => void;
  onRemove: (id: string) => void; onExported: (ids: string[]) => void;
}) {
  const { folders, current, select, pickCustom } = gameFolder;
  const [phase, setPhase] = useState<ExportPhase>('idle');
  const [prog, setProg] = useState(0);
  const [exported, setExported] = useState<Blueprint[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    if (open) { setPhase('idle'); setProg(0); setExported([]); }
    return () => { timers.current.forEach(t => { clearInterval(t); clearTimeout(t); }); timers.current = []; };
  }, [open]);

  // freeze the list once an export finishes so marking items installed doesn't reshuffle it
  const list = phase === 'done' ? exported : items;

  const run = () => {
    setPhase('running'); setProg(0);
    const snapshot = items;
    let p = 0;
    const t = window.setInterval(() => {
      p += Math.random() * 18 + 8;
      if (p >= 100) {
        p = 100; clearInterval(t);
        timers.current.push(window.setTimeout(() => {
          setExported(snapshot); setPhase('done'); onExported(snapshot.map(b => b.id));
        }, 300));
      }
      setProg(Math.min(p, 100));
    }, 220);
    timers.current.push(t);
  };

  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 45, background: 'rgba(5,6,8,.6)',
      display: 'flex', justifyContent: 'flex-end' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={e => e.stopPropagation()}
        style={{ width: 420, maxWidth: '100vw', height: '100%', background: 'var(--panel)',
        borderLeft: '1px solid var(--border-strong)', boxShadow: '-20px 0 60px -20px rgba(0,0,0,.7)',
        display: 'flex', flexDirection: 'column', animation: 'drawerin .22s var(--ease)' }}>
        <div style={{ padding: '17px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <HeaderGlyph icon={IcExport} />
            <div style={{ flex: 1 }}>
              <div id="export-title" style={{ fontSize: 15, fontWeight: 700 }}>Batch export</div>
              <div className="tlabel" style={{ fontSize: 9, marginTop: 2 }}>
                {list.length} selected · {list.filter(b => b.files.sbpcfg).length} file pairs</div>
            </div>
            <IconBtn icon={IcClose} onClick={onClose} title="Close" />
          </div>
          {/* target */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 13, padding: '10px 11px',
            borderRadius: 'var(--r)', background: 'var(--bg-deep)', border: '1px solid var(--border)' }}>
            <IcFolder size={16} style={{ color: 'var(--steel)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="tlabel" style={{ fontSize: 8.5 }}>
                Target folder{current && current.kind !== 'native' ? ` · ${current.label}` : ''}</div>
              {folders.length > 1 && phase === 'idle'
                ? <select value={current?.path ?? ''} aria-label="Target folder"
                    onChange={e => { const f = folders.find(x => x.path === e.target.value); if (f) select(f); }}
                    style={{ width: '100%', marginTop: 3, height: 24, padding: '0 4px', borderRadius: 5,
                    background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)', fontSize: 10.5, outline: 'none' }}>
                    {folders.map(f => <option key={f.path} value={f.path}>{f.label}</option>)}
                  </select>
                : <div className="mono" title={current?.path} style={{ fontSize: 10.5, color: current ? 'var(--text-dim)' : 'var(--warn)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {current ? tailPath(current.path, 4) : 'Satisfactory not found — choose a folder'}</div>}
            </div>
            {phase === 'idle' && <button onClick={pickCustom} style={{ height: 26, padding: '0 9px', borderRadius: 5, flexShrink: 0,
              background: 'var(--well)', border: '1px solid var(--border)', color: 'var(--text-dim)',
              fontFamily: 'var(--font-mono)', fontSize: 10 }}>Change…</button>}
            <Dot color={current?.found ? 'var(--ok)' : 'var(--warn)'} />
          </div>
          {phase === 'idle' && <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 9,
            fontSize: 11, color: 'var(--warn)' }}>
            <IcInfo size={13} style={{ flexShrink: 0 }} />After exporting, reload the save in-game to see them</div>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {list.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-mute)', padding: '40px 20px',
            fontSize: 13 }}>No blueprints selected.<br />Select cards in the library to batch export.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map(b => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 10px',
                borderRadius: 'var(--r)', background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
                <div style={{ width: 48, height: 34, borderRadius: 5, overflow: 'hidden', flexShrink: 0,
                  border: '1px solid var(--border)' }}><Thumb hue={b.hue} seed={b.seed} label="" /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
                    textOverflow: 'ellipsis' }}>{b.name}</div>
                  <div style={{ marginTop: 4 }}>{phase === 'done'
                    ? <span className="mono" style={{ fontSize: 10, color: 'var(--ok)', display: 'flex',
                        alignItems: 'center', gap: 5 }}><IcCheck size={12} />Installed</span>
                    : <FilePair files={b.files} compact />}</div>
                </div>
                {phase === 'idle' && <button onClick={() => onRemove(b.id)} aria-label={`Remove ${b.name}`}
                  style={{ color: 'var(--text-mute)', background: 'none', border: 'none', display: 'flex', padding: 4 }}>
                  <IcClose size={15} /></button>}
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '15px 18px', borderTop: '1px solid var(--border)' }}>
          {phase === 'running' && <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
              <span className="tlabel" style={{ color: 'var(--accent)' }}>Copying files…</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{Math.round(prog)}%</span></div>
            <div role="progressbar" aria-valuenow={Math.round(prog)} aria-valuemin={0} aria-valuemax={100}
              style={{ height: 6, borderRadius: 99, background: 'var(--bg-deep)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${prog}%`, borderRadius: 99,
                background: 'linear-gradient(90deg,var(--accent-deep),var(--accent-bright))',
                boxShadow: '0 0 12px var(--accent-glow)', transition: 'width .2s' }} /></div>
          </div>}
          {phase === 'done'
            ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ok)', fontSize: 13, fontWeight: 600 }}>
                  <IcCheck size={18} /><span>Exported {list.length} blueprint{list.length !== 1 ? 's' : ''}
                    <span style={{ display: 'block', marginTop: 2, fontSize: 11, fontWeight: 500, color: 'var(--text-mute)' }}>
                      Reload that save in-game to see them</span></span></div>
                {current && <Btn variant="ghost" icon={IcFolder} title="Open the target folder"
                  onClick={() => openFolder(current.path).catch(() => {})}>Open</Btn>}
                <Btn variant="solid" onClick={onClose}>Done</Btn></div>
            : <Btn variant="primary" full size="lg" icon={IcExport} disabled={!items.length || !current || phase === 'running'} onClick={run}>
                {phase === 'running' ? 'Exporting…' : `Export ${items.length} to game folder`}</Btn>}
        </div>
      </div>
    </div>
  );
}
