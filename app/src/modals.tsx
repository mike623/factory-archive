// modals.tsx — import-from-URL modal + batch export drawer
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { dimsLabel, SOURCES, type Blueprint, type SourceId } from './data';
import { Btn, Check, Dot, FilePair, HeaderGlyph, IconBtn, MiniTag, SourceBadge, SourceMark, Thumb } from './components';
import {
  IcCheck, IcCloud, IcClose, IcDimensions, IcDownload, IcExport, IcEye, IcEyeOff, IcInfo, IcFolder, IcLink, IcLock, IcMachine, IcPlus, IcPower, IcSearch, IcTrash, IcUpload,
  IcUser, IcWarn, type Icon,
} from './icons';
import { bytesLabel, backupPlan, backupSettings, backupStatus, forgetBackup, onBackupProgress, openFolder, pullBackup, revealBackupToken, runBackup, saveBackupSettings, setBackupAuto, tailPath, testBackup,
  type BackupInput, type BackupOutcome, type BackupPlan, type BackupPullSummary, type BackupStatus,
  type BackupSummary, type BackupTest } from './platform';
import type { GameFolderState } from './gameFolder';

export function detectSource(url: string): SourceId | null {
  const u = url.trim().toLowerCase();
  if (u.includes('satisfactory-calculator.com')) return 'scim';
  if (u.includes('satisfactoryblueprints.com')) return 'sbp';
  if (u.includes('.sbp') || u.includes('.sbpcfg') || u.startsWith('http')) return 'url';
  return null;
}

/** A SCIM user's blueprint list (mirrors `resolve::scim_user`). */
export function scimUser(url: string): string | null {
  const m = url.trim().match(/^https?:\/\/[^/]*satisfactory-calculator\.com\/[^?#]*\/blueprints\/index\/index\/idU\/\d+\/user\/([^/?#]+)/i);
  if (!m) return null;
  try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch { return m[1]; }
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
export interface UserImport { user: string; session: string; added: number; failed: number; save: string | null; categoryError: string | null }

export function ImportModal({ open, onClose, onAdd, onBrowse, target, importLink, importUser, findImported }: {
  open: boolean; onClose: () => void; onAdd: (b: Blueprint) => void;
  /** desktop app: download the blueprint behind the link into `target` */
  importLink?: (url: string) => Promise<LinkImport>;
  /** desktop app: download all of a SCIM user's blueprints into `target`, in one category */
  importUser?: (url: string, progress: (done: number, total: number) => void) => Promise<UserImport>;
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
  const [userSaved, setUserSaved] = useState<UserImport | null>(null);
  const [userProgress, setUserProgress] = useState<[number, number] | null>(null);
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
  const user = importUser ? scimUser(url) : null;
  const resolved = src ? mockResolve(src, url.trim()) : null;

  const resolve = async () => {
    if (!src || phase === 'resolving') return;
    setPhase('resolving'); setStep(0); setFailure(null); setSaved(null); setUserSaved(null); setUserProgress(null);
    if (user && importUser) {
      try { setUserSaved(await importUser(url.trim(), (done, total) => setUserProgress([done, total]))); setPhase('saved'); }
      catch (e) { setFailure(String(e).replace(/^Error: /, '')); setPhase('failed'); }
      return;
    }
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

          {phase === 'saved' && userSaved && <div role="status" style={{ marginTop: 14, display: 'flex', gap: 10, padding: '13px 14px',
            borderRadius: 'var(--r-md)', background: 'var(--ok-ghost)', border: '1px solid color-mix(in oklab,var(--ok) 30%,transparent)' }}>
            <IcCheck size={18} style={{ color: 'var(--ok)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5 }}>
              <div>Added <strong>{userSaved.added}</strong> of {userSaved.user}'s blueprints to <strong>{userSaved.session}</strong></div>
              {userSaved.failed > 0 && <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 4 }}>
                {userSaved.failed} couldn't be downloaded. Try those links one by one.</div>}
              {userSaved.save
                ? <div style={{ fontSize: 11.5, color: 'var(--text-mute)', marginTop: 6 }}>
                    They're in the category <strong>{userSaved.user}</strong>, saved as a new save <span className="mono">{userSaved.save}</span>. Load that save in-game to see them.</div>
                : userSaved.categoryError && <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 4 }}>
                    Couldn't put them in a category: {userSaved.categoryError}</div>}
            </div>
          </div>}

          {phase === 'failed' && failure && <div role="alert" style={{ marginTop: 14, display: 'flex', gap: 9, padding: '12px 13px',
            borderRadius: 'var(--r)', background: 'var(--warn-ghost)', border: '1px solid color-mix(in oklab,var(--warn) 30%,transparent)',
            color: 'var(--warn)', fontSize: 12.5, lineHeight: 1.5 }}>
            <IcWarn size={15} style={{ flexShrink: 0, marginTop: 2 }} /><span>{failure}</span></div>}

          {/* resolving */}
          {phase === 'resolving' && user && <div style={{ marginTop: 14, borderRadius: 'var(--r)', background: 'var(--bg-deep)',
            border: '1px solid var(--border)', padding: '14px 15px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--accent)' }}>
            <span style={{ width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent',
              borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            <span className="mono" style={{ fontSize: 11.5 }}>{userProgress
              ? `Downloading ${Math.min(userProgress[0] + 1, userProgress[1])} of ${userProgress[1]}`
              : `Finding ${user}'s blueprints`}</span>
          </div>}

          {phase === 'resolving' && !user && <div style={{ marginTop: 14, borderRadius: 'var(--r)', background: 'var(--bg-deep)',
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
                : target ? (user ? `Downloads all of ${user}'s blueprints into ${target}, in a category named after them` : `Downloads into ${target}`)
                : 'Pick a world session in the filters first')
              : phase === 'done' ? '✓ Added to library' : 'Import adds to library — export to game folder separately'}</span>
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          {phase === 'saved'
            ? <Btn variant="primary" icon={IcCheck} onClick={onClose}>Done</Btn>
            : phase === 'resolved' || phase === 'done'
            ? <Btn variant="primary" icon={phase === 'done' ? IcCheck : IcPlus} disabled={phase === 'done'} onClick={add}>
                {phase === 'done' ? 'Added' : 'Add to library'}</Btn>
            : <Btn variant="primary" icon={importLink ? IcDownload : IcSearch} disabled={!src || phase === 'resolving' || (!!importLink && (!target || !!already))} onClick={resolve}>
                {phase === 'resolving' ? (importLink ? 'Downloading…' : 'Resolving…') : user ? 'Download all & add' : importLink ? 'Download & add' : 'Resolve link'}</Btn>}
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

/* ============ WEBDAV BACKUP ============ */

const backupField: CSSProperties = {
  width: '100%', height: 38, padding: '0 11px', borderRadius: 'var(--r)', background: 'var(--bg-deep)',
  border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12,
  outline: 'none',
};

/** "3 min ago" for the last-run line. */
function agoLabel(unix: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span className="tlabel" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        {label}{hint && <span style={{ color: 'var(--text-faint)', letterSpacing: 0, textTransform: 'none', fontSize: 10 }}>{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function BackupModal({ open, onClose, root, onBackedUp }: {
  open: boolean; onClose: () => void;
  /** the game's blueprints folder (null when none was found) */
  root: string | null;
  onBackedUp?: (s: BackupSummary) => void;
}) {
  const [form, setForm] = useState<BackupInput>({ url: '', user: '', token: '', auth: 'auto', allowSelfSigned: false, removeMissing: true });
  const [auto, setAuto] = useState(false);
  const [lastRun, setLastRun] = useState(0);
  const [hasToken, setHasToken] = useState(false);
  const [folder, setFolder] = useState('');
  const [plan, setPlan] = useState<BackupPlan | null>(null);
  const [phase, setPhase] = useState<'idle' | 'testing' | 'running' | 'done'>('idle');
  const [tested, setTested] = useState<BackupTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [log, setLog] = useState<BackupOutcome[]>([]);
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [adopt, setAdopt] = useState(false);
  const [force, setForce] = useState(false);
  // the token is shown only after an explicit click, never because the dialog opened
  const [show, setShow] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [pulled, setPulled] = useState<BackupPullSummary | null>(null);
  // "this really is the folder I mean", after a different-folder warning
  const [acceptNewRoot, setAcceptNewRoot] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setPhase('idle'); setTested(null); setError(null); setNote(null); setLog([]); setSummary(null); setPulled(null); setAdopt(false); setForce(false); setShow(false); setAuto(false); setLastRun(0); setStatus(null); setAcceptNewRoot(false);
    backupSettings().then(v => {
      if (!live) return;
      setHasToken(v.hasToken);
      setFolder(v.folder);
      setAuto(v.auto);
      setLastRun(v.lastRun);
      setForm({ url: v.url, user: v.user, token: '', auth: v.auth, allowSelfSigned: v.allowSelfSigned, removeMissing: v.removeMissing });
    }).catch(e => live && setError(String(e).replace(/^Error: /, '')));
    if (root) {
      backupPlan(root).then(p => live && setPlan(p)).catch(() => live && setPlan(null));
      // which side moved? sizes only, so this is cheap even on a slow line
      backupStatus(root).then(s => live && setStatus(s)).catch(() => live && setStatus(null));
    }
    return () => { live = false; };
  }, [open, root]);

  // live list of files as they go up; listening while the dialog is open means the very
  // first files of a fast run aren't missed
  useEffect(() => {
    if (!open) return;
    let stop = () => {};
    let live = true;
    onBackupProgress(o => setLog(l => [...l, o])).then(f => { if (live) stop = f; else f(); });
    return () => { live = false; stop(); };
  }, [open]);

  const persist = async () => {
    const v = await saveBackupSettings(form);
    setHasToken(v.hasToken);
    setFolder(v.folder);
    return v;
  };

  /** Show what is in the field; the saved token is fetched the first time it is asked for. */
  const toggleReveal = async () => {
    if (show) { setShow(false); return; }
    if (!form.token && hasToken) {
      setRevealing(true);
      try {
        const saved = await revealBackupToken();
        setForm(f => ({ ...f, token: saved }));
      } catch (e) {
        setError(String(e).replace(/^Error: /, ''));
        return;
      } finally {
        setRevealing(false);
      }
    }
    setShow(true);
  };

  /** Turn the quiet run on or off; it is saved straight away, unlike the fields above. */
  const toggleAuto = async (on: boolean) => {
    try {
      const v = await setBackupAuto(on);
      setAuto(v.auto);
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''));
    }
  };

  const runTest = async () => {
    setPhase('testing'); setError(null); setNote(null); setTested(null);
    try {
      await persist();
      const t = await testBackup({ ...form, token: '' });
      setTested(t);
      setAdopt(false);
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''));
    } finally {
      setPhase('idle');
    }
  };

  /** Re-read which side moved; a failed look leaves the previous answer alone. */
  const refreshStatus = () => {
    if (!root) return;
    backupStatus(root).then(s => {
      setStatus(s);
      // the warning goes away only once this folder has become the synced one
      if (s.verdict !== 'different-folder') setAcceptNewRoot(false);
    }).catch(() => {});
  };

  const runNow = async () => {
    if (!root) return;
    setPhase('running'); setError(null); setNote(null); setLog([]); setSummary(null); setPulled(null);
    try {
      await persist();
      const s = await runBackup(root, force, adopt, acceptNewRoot);
      setSummary(s);
      onBackedUp?.(s);
      backupSettings().then(v => { setAuto(v.auto); setLastRun(v.lastRun); }).catch(() => {});
      backupPlan(root).then(setPlan).catch(() => {});
      refreshStatus();
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''));
    } finally {
      setPhase('done');
    }
  };

  /** "Use the cloud copy": the local side is replaced, with each old file kept as `.bak`. */
  const runPull = async () => {
    if (!root) return;
    setPhase('running'); setError(null); setNote(null); setLog([]); setSummary(null); setPulled(null);
    try {
      await persist();
      const s = await pullBackup(root, acceptNewRoot);
      setPulled(s);
      backupPlan(root).then(setPlan).catch(() => {});
      backupSettings().then(v => { setAuto(v.auto); setLastRun(v.lastRun); }).catch(() => {});
      refreshStatus();
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''));
    } finally {
      setPhase('done');
    }
  };

  const runForget = async () => {
    try { await forgetBackup(); } catch { /* nothing to remove */ }
    setForm({ url: '', user: '', token: '', auth: 'auto', allowSelfSigned: false, removeMissing: true });
    setHasToken(false); setFolder(''); setTested(null); setSummary(null); setPulled(null); setLog([]); setShow(false); setAuto(false); setLastRun(0); setStatus(null); setAcceptNewRoot(false);
    setNote('The saved address and token were removed from this PC.');
  };

  if (!open) return null;
  const busy = phase === 'running' || phase === 'testing';
  const ready = !!form.url.trim() && (hasToken || !!form.token.trim());
  const total = plan?.files ?? summary?.total ?? pulled?.total ?? 0;
  const done = log.length;
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const changed = status?.changes.filter(c => c.kind !== 'same') ?? [];
  const pickSide = status?.verdict === 'cloud-ahead' || status?.verdict === 'both-changed';
  const folderChanged = status?.verdict === 'different-folder';

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: 'rgba(5,6,8,.78)' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="backup-title" onClick={e => e.stopPropagation()}
        style={{ width: 580, maxWidth: 'calc(100vw - 32px)', maxHeight: '88%', overflow: 'auto',
        borderRadius: 'var(--r-lg)', background: 'var(--panel)', border: '1px solid var(--border-strong)',
        boxShadow: 'var(--shadow-lg)', animation: 'scalein .18s var(--ease)' }}>

        <DialogHeader icon={IcCloud} id="backup-title" title="Sync blueprints"
          sub={folder ? `To ${folder}` : 'Keep a copy on a WebDAV account'} onClose={onClose} />

        <div style={{ padding: 19 }}>
          <Field label="WebDAV address" hint="the mount point, not the login page">
            <input value={form.url} onChange={e => { setForm(f => ({ ...f, url: e.target.value })); setTested(null); }}
              aria-label="WebDAV address" placeholder="https://abc123.teracloud.jp/dav/" disabled={busy}
              spellCheck={false} style={backupField} />
          </Field>

          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <Field label="Username" hint="optional">
                <input value={form.user} onChange={e => { setForm(f => ({ ...f, user: e.target.value })); setTested(null); }}
                  aria-label="Username" placeholder="leave empty for a bearer token" disabled={busy} spellCheck={false} style={backupField} />
              </Field>
            </div>
            <div style={{ width: 150 }}>
              <Field label="Auth">
                <select value={form.auth} onChange={e => setForm(f => ({ ...f, auth: e.target.value as BackupInput['auth'] }))}
                  aria-label="Auth" disabled={busy}
                  style={{ ...backupField, paddingRight: 6, cursor: 'pointer' }}>
                  <option value="auto">Auto</option>
                  <option value="basic">Basic</option>
                  <option value="bearer">Bearer</option>
                </select>
              </Field>
            </div>
          </div>

          <Field label="Token" hint={show ? 'visible on this screen only'
            : hasToken ? 'saved — leave blank to keep it' : 'apps password or bearer token'}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input type={show ? 'text' : 'password'} value={form.token}
                onChange={e => { setForm(f => ({ ...f, token: e.target.value })); setTested(null); }}
                aria-label="Token" placeholder={hasToken && !show ? '••••••••' : ''} disabled={busy}
                autoComplete="off" spellCheck={false} style={{ ...backupField, paddingRight: 40 }} />
              {/* the token is never sent to the window on its own; this asks for it, once */}
              <button type="button" onClick={toggleReveal} disabled={busy || revealing}
                aria-label={show ? 'Hide token' : 'Show saved token'} aria-pressed={show}
                title={show ? 'Hide the token' : form.token ? 'Show what I typed'
                  : hasToken ? 'Show the saved token' : 'Nothing saved to show'}
                style={{ position: 'absolute', right: 4, width: 30, height: 30, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 5,
                  background: 'transparent', cursor: 'pointer',
                  color: show ? 'var(--accent)' : 'var(--text-mute)' }}>
                {show ? <IcEyeOff size={15} /> : <IcEye size={15} />}
              </button>
            </div>
          </Field>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '2px 0 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: 'var(--text-dim)' }}>
              <Check checked={form.removeMissing} onChange={v => setForm(f => ({ ...f, removeMissing: v }))} size={15}
                label="Remove deleted files from the server" />
              Remove files from the backup that I deleted here
              <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-faint)' }}>keeps it a mirror</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: 'var(--text-dim)' }}>
              <Check checked={form.allowSelfSigned} onChange={v => setForm(f => ({ ...f, allowSelfSigned: v }))} size={15} label="Allow self-signed certificate" />
              Allow a self-signed certificate <span style={{ color: 'var(--text-faint)' }}>(own server only)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: 'var(--text-dim)' }}>
              <Check checked={force} onChange={setForce} size={15} label="Upload everything again" />
              Upload everything again, even files that are already there
            </div>
            {tested && !tested.owned && tested.others > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 9,
              fontSize: 12, color: 'var(--warn)' }}>
              <Check checked={adopt} onChange={setAdopt} size={15} label="Use it anyway" />
              Use it anyway — that folder already has {tested.others} other file{tested.others === 1 ? '' : 's'}
            </div>}
            <div style={{ height: 1, background: 'var(--border)', margin: '3px 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12, color: 'var(--text-dim)',
              opacity: hasToken && lastRun ? 1 : 0.55 }}>
              <Check checked={auto} onChange={hasToken && lastRun ? toggleAuto : undefined} size={15}
                label="Sync automatically when I open the app" />
              Sync automatically when the app opens
              <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-faint)' }}>
                {lastRun ? `last ${agoLabel(lastRun)}` : 'sync once to turn this on'}
              </span>
            </div>
          </div>

          {/* the folder is fixed; say exactly where things go */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 11px', borderRadius: 'var(--r)',
            background: 'var(--bg-deep)', border: '1px solid var(--border)' }}>
            <IcLock size={15} style={{ color: 'var(--text-mute)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="tlabel" style={{ fontSize: 8.5 }}>Backups go here — nothing else is touched</div>
              <div className="mono" title={form.url} style={{ fontSize: 10.5, color: 'var(--text-dim)', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                {(folder || form.url.replace(/\/+$/, '') + '/.factory-archive') || '…/.factory-archive'}
              </div>
            </div>
            <Dot color={tested ? 'var(--ok)' : 'var(--border-strong)'} />
          </div>

          {plan && phase !== 'running' && !summary && !pulled && <div className="mono" style={{ marginTop: 10, fontSize: 11,
            color: 'var(--text-mute)' }}>
            {plan.files === 0 ? 'No blueprints in this folder yet.'
              : `${plan.files} file${plan.files === 1 ? '' : 's'} · ${bytesLabel(plan.bytes)} · ${plan.uploads} to upload`}
          </div>}

          {note && <div role="status" style={{ marginTop: 14, display: 'flex', gap: 9, padding: '11px 12px',
            borderRadius: 'var(--r)', background: 'var(--well)', border: '1px solid var(--border)',
            color: 'var(--text-dim)', fontSize: 12.5 }}><IcInfo size={15} style={{ flexShrink: 0, marginTop: 1 }} />{note}</div>}

          {tested && <div role="status" style={{ marginTop: 14, display: 'flex', gap: 9, padding: '11px 12px',
            borderRadius: 'var(--r)', background: 'var(--ok-ghost)',
            border: '1px solid color-mix(in oklab,var(--ok) 30%,transparent)', color: 'var(--ok)', fontSize: 12.5, lineHeight: 1.5 }}>
            <IcCheck size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Connected — {tested.auth === 'basic' ? 'Basic auth' : 'bearer token'} accepted.{' '}
              {!tested.folderExists ? 'The backup folder will be created.'
                : tested.owned ? 'The backup folder is already set up.'
                : tested.others > 0 ? `The backup folder has ${tested.others} other file${tested.others === 1 ? '' : 's'}.`
                : 'The backup folder is empty and ready.'}</span>
          </div>}

          {/* which side moved, and the picker when both did */}
          {status && status.verdict !== 'no-connection' && <div role="status" style={{ marginTop: 14,
            padding: '12px 13px', borderRadius: 'var(--r-md)', background: 'var(--well)',
            border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {status.verdict === 'in-sync' ? <IcCheck size={15} style={{ color: 'var(--ok)', flexShrink: 0 }} />
                : status.verdict === 'local-ahead' ? <IcUpload size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                : <IcWarn size={15} style={{ color: 'var(--warn)', flexShrink: 0 }} />}
              <span style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                {status.verdict === 'in-sync' ? 'Both sides have the same blueprints.'
                  : status.verdict === 'local-ahead'
                    ? `${changed.length || status.localFiles} change${(changed.length || status.localFiles) === 1 ? '' : 's'} here since the last sync — Sync now sends ${(changed.length || status.localFiles) === 1 ? 'it' : 'them'} up.`
                  : status.verdict === 'cloud-ahead'
                    ? `The cloud has ${changed.length} file${changed.length === 1 ? '' : 's'} this PC doesn't have yet.`
                  : status.verdict === 'both-changed'
                    ? `Both this PC and the cloud changed since the last sync (${changed.length} file${changed.length === 1 ? '' : 's'} differ).`
                  : 'This PC is pointing at a folder other than the one it synced last.'}
              </span>
            </div>

            {changed.length > 0 && <div className="mono" style={{ marginTop: 8, display: 'flex', flexDirection: 'column',
              gap: 2, maxHeight: 84, overflowY: 'auto', fontSize: 10.5, color: 'var(--text-mute)' }}>
              {changed.slice(0, 8).map(c => (
                <div key={`${c.session}/${c.name}.${c.ext}`} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}.{c.ext}<span style={{ color: 'var(--text-faint)' }}> · {c.session}</span></span>
                  <span style={{ color: 'var(--text-faint)' }}>
                    {c.kind === 'local-only' ? 'only here' : c.kind === 'cloud-only' ? 'only in the cloud' : 'differs'}</span>
                </div>
              ))}
              {changed.length > 8 && <div style={{ color: 'var(--text-faint)' }}>and {changed.length - 8} more…</div>}
            </div>}

            {folderChanged && <>
              <div style={{ marginTop: 9, fontSize: 11.5, color: 'var(--text-mute)', lineHeight: 1.5 }}>
                Last synced folder: <span className="mono">{status.previousRoot}</span>. Uploading is safe, but
                nothing is removed from the cloud until you confirm this is the folder you mean.
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 8, fontSize: 12, color: 'var(--warn)' }}>
                <Check checked={acceptNewRoot} onChange={setAcceptNewRoot} size={15} label="I mean this folder" />
                I mean this folder — mirror it and remove what it no longer has
              </div>
            </>}

            {(pickSide || folderChanged) && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Btn size="sm" variant="primary" icon={IcDownload} onClick={runPull}
                disabled={busy || !ready || !root || (folderChanged && !acceptNewRoot)}>Use the cloud copy</Btn>
              {pickSide && <Btn size="sm" variant="solid" icon={IcUpload} onClick={runNow}
                disabled={busy || !ready || !root}>Keep this PC's version</Btn>}
              <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>
                files replaced here are kept next to them as .bak</span>
            </div>}
          </div>}

          {error && <div role="alert" style={{ marginTop: 14, display: 'flex', gap: 9, padding: '11px 12px',
            borderRadius: 'var(--r)', background: 'var(--warn-ghost)',
            border: '1px solid color-mix(in oklab,var(--warn) 30%,transparent)', color: 'var(--warn)',
            fontSize: 12.5, lineHeight: 1.5 }}>
            <IcWarn size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>{error}</span></div>}

          {(phase === 'running' || (phase === 'done' && log.length > 0)) && <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
              <span className="tlabel" style={{ color: phase === 'running' ? 'var(--accent)' : 'var(--text-dim)' }}>
                {phase === 'running' ? 'Syncing…' : 'Finished'}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {done}{total ? ` / ${total}` : ''}</span>
            </div>
            <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
              style={{ height: 6, borderRadius: 99, background: 'var(--bg-deep)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99,
                background: 'linear-gradient(90deg,var(--accent-deep),var(--accent-bright))',
                boxShadow: '0 0 12px var(--accent-glow)', transition: 'width .2s' }} /></div>
            <div style={{ marginTop: 10, maxHeight: 132, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {log.slice(-40).reverse().map((o, i) => (
                <div key={`${o.session}/${o.name}.${o.ext}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 11.5, color: o.status === 'failed' ? 'var(--warn)' : 'var(--text-dim)' }}>
                  {o.status === 'failed' || o.status === 'pending' ? <IcWarn size={12} />
                    : o.status === 'removed' ? <IcTrash size={12} />
                    : o.status === 'skipped' ? <IcInfo size={12} /> : <IcCheck size={12} />}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.name}.{o.ext}<span style={{ color: 'var(--text-faint)' }}> · {o.session}</span></span>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                    {o.status === 'written' ? 'from the cloud'
                      : o.status === 'skipped' ? 'already there' : o.status === 'replaced' ? 'replaced'
                      : o.status === 'removed' ? 'removed' : o.status === 'pending' ? (o.error ?? 'left for next time')
                      : o.status === 'failed' ? (o.error ?? 'failed') : 'uploaded'}</span>
                </div>
              ))}
            </div>
          </div>}

          {summary && <div role="status" style={{ marginTop: 14, display: 'flex', gap: 10, padding: '13px 14px',
            borderRadius: 'var(--r-md)', background: summary.failed ? 'var(--warn-ghost)' : 'var(--ok-ghost)',
            border: `1px solid color-mix(in oklab,${summary.failed ? 'var(--warn)' : 'var(--ok)'} 30%,transparent)` }}>
            {summary.failed ? <IcWarn size={18} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 1 }} />
              : <IcCheck size={18} style={{ color: 'var(--ok)', flexShrink: 0, marginTop: 1 }} />}
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5,
              color: summary.failed ? 'var(--warn)' : 'var(--ok)' }}>
              <div>{summary.total === 0 ? 'No blueprints in this folder yet.'
                : <>{summary.uploaded} uploaded{summary.bytes ? ` (${bytesLabel(summary.bytes)})` : ''}{summary.replaced ? `, ${summary.replaced} replacing ${summary.replaced === 1 ? 'an older copy' : 'older copies'}` : ''}{summary.removed ? `, ${summary.removed} removed` : ''}{summary.skipped ? `, ${summary.skipped} already there` : ''}.</>}</div>
              {summary.pendingRemovals > 0 && <div style={{ marginTop: 3 }}>
                {summary.pendingRemovals} file{summary.pendingRemovals === 1 ? ' is' : 's are'} gone here but left on the server — sync again to remove {summary.pendingRemovals === 1 ? 'it' : 'them'}.</div>}
              {summary.failed > 0 && <div style={{ marginTop: 3 }}>{summary.failed} couldn't be uploaded. They'll be tried again next time.</div>}
            </div>
          </div>}
          {pulled && <div role="status" style={{ marginTop: 14, display: 'flex', gap: 10, padding: '13px 14px',
            borderRadius: 'var(--r-md)', background: pulled.failed ? 'var(--warn-ghost)' : 'var(--ok-ghost)',
            border: `1px solid color-mix(in oklab,${pulled.failed ? 'var(--warn)' : 'var(--ok)'} 30%,transparent)` }}>
            {pulled.failed ? <IcWarn size={18} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 1 }} />
              : <IcCheck size={18} style={{ color: 'var(--ok)', flexShrink: 0, marginTop: 1 }} />}
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5,
              color: pulled.failed ? 'var(--warn)' : 'var(--ok)' }}>
              <div>{pulled.written} copied from the cloud{pulled.bytes ? ` (${bytesLabel(pulled.bytes)})` : ''}
                {pulled.same ? `, ${pulled.same} already the same` : ''}. Reload the save to see them in game.</div>
              {pulled.written > 0 && <div style={{ marginTop: 3 }}>
                The files they replaced are kept next to them as <span className="mono">.bak</span>.</div>}
              {pulled.failed > 0 && <div style={{ marginTop: 3 }}>{pulled.failed} couldn't be copied. Nothing was written for those.</div>}
            </div>
          </div>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '15px 19px', borderTop: '1px solid var(--border)' }}>
          <Btn variant="ghost" icon={IcClose} onClick={runForget} disabled={busy || (!hasToken && !form.url)}>Forget</Btn>
          <span className="tlabel" style={{ fontSize: 9, color: 'var(--text-faint)' }}>
            {root ? 'Every .sbp and .sbpcfg is checked by reading it back' : 'No blueprints folder found'}
          </span>
          <div style={{ flex: 1 }} />
          <Btn variant="solid" icon={IcCloud} onClick={runTest} disabled={busy || !ready}>Test</Btn>
          <Btn variant="primary" icon={IcUpload} onClick={runNow} disabled={busy || !ready || !root}>
            {phase === 'running' ? 'Syncing…' : 'Sync now'}</Btn>
        </div>
      </div>
    </div>
  );
}
