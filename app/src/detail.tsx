// detail.tsx — blueprint detail screen
import { useEffect, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { SOURCES, STATUS, type Blueprint } from './data';
import { Btn, IconBtn, MetaStat, ModdedBadge, SourceBadge, SourceMark, StatusPill, Tag, Thumb } from './components';
import {
  IcArrowLeft, IcCalendar, IcFolder, IcCheck, IcChevron, IcCopy, IcDimensions, IcDownload, IcExternal, IcFile, IcInfo,
  IcLayers, IcLink, IcMachine, IcMaterial, IcPencil, IcPower, IcRefresh, IcStar, IcTag, IcTrash, IcUpload, IcUser, IcWarn, type Icon,
} from './icons';
import { copyText, openExternal } from './platform';
import { BlueprintImage, useBlueprintImage } from './blueprintImage';
import { BreakdownSection, ConfigSwatch, useBlueprintInfo } from './breakdown';
import type { CategoryNode } from './library';

const overlayChip = {
  fontSize: 10, padding: '4px 9px', borderRadius: 5, background: 'rgba(8,9,11,.7)',
  backdropFilter: 'blur(6px)', border: '1px solid var(--border)', color: 'var(--text-dim)',
} as const;

function DetailHeader({ bp, onBack, fav, onToggleFav, onExport, onOpenFolder, onDelete }: {
  bp: Blueprint; onBack: () => void; fav: boolean; onToggleFav: () => void; onExport: () => void; onOpenFolder: () => void;
  onDelete?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!bp.url) return;
    if (await copyText(bp.url)) { setCopied(true); setTimeout(() => setCopied(false), 1400); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, height: 60, flexShrink: 0, padding: '0 18px',
      borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 34, padding: '0 12px 0 9px',
        borderRadius: 'var(--r)', background: 'var(--well)', border: '1px solid var(--border)', color: 'var(--text-dim)',
        fontSize: 12.5, fontWeight: 500, fontFamily: 'var(--font-display)' }}>
        <IcArrowLeft size={16} />Library</button>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-mute)', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
        <span>{bp.onDisk ? bp.session : bp.category}</span><IcChevron size={12} /><span style={{ color: 'var(--text-dim)' }}>{bp.onDisk ? `${bp.name}.sbp` : bp.id.toUpperCase()}</span>
      </div>
      <div style={{ flex: 1 }} />
      {onDelete && <IconBtn icon={IcTrash} title="Delete (moves the files to the Trash)" onClick={onDelete} />}
      <IconBtn icon={IcStar} active={fav} title={fav ? 'Remove from favorites' : 'Add to favorites'} onClick={onToggleFav} />
      <Btn variant="ghost" icon={copied ? IcCheck : IcCopy} onClick={copy} disabled={!bp.url}
        title={bp.url ? 'Copy source link' : 'No source link for local imports'}>{copied ? 'Copied' : 'Copy link'}</Btn>
      <Btn variant="ghost" icon={IcExternal} onClick={() => bp.url && openExternal(bp.url)} disabled={!bp.url}
        title={bp.url ? `Open ${bp.url}` : 'No source link for local imports'}>Open link</Btn>
      {bp.onDisk
        ? <Btn variant="primary" icon={IcFolder} onClick={onOpenFolder}>Open folder</Btn>
        : <Btn variant="primary" icon={IcDownload} onClick={onExport}>Export to game folder</Btn>}
    </div>
  );
}

/** Hero camera view. Dropping an image file replaces the placeholder art for this session. */
function HeroShot({ bp, active, shots, image, onDropImage }: {
  bp: Blueprint; active: number; shots: number; image?: string; onDropImage: (url: string) => void;
}) {
  const [over, setOver] = useState(false);
  const label = `CAMERA ${String(active + 1).padStart(2, '0')}`;
  const picture = useBlueprintImage(bp);
  const shown = image ?? (active === 0 ? picture : null);
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setOver(false);
    const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
    if (f) onDropImage(URL.createObjectURL(f));
  };
  return (
    <div onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
      style={{ borderRadius: 'var(--r-md)', overflow: 'hidden', border: `1px solid ${over ? 'var(--accent)' : 'var(--border)'}`,
      background: 'var(--panel)', position: 'relative', transition: 'border-color .15s' }}>
      <div style={{ position: 'relative', width: '100%', height: 380 }}>
        {shown
          ? <img src={shown} alt={`${bp.name} — ${label}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <Thumb hue={bp.hue} seed={bp.seed + active} label={label} />}
        {over && <div style={{ position: 'absolute', inset: 0, background: 'var(--accent-ghost)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', gap: 8 }}>
          <IcUpload size={18} /><span className="mono" style={{ fontSize: 12 }}>Drop screenshot {active + 1} — .png / .jpg</span></div>}
      </div>
      <div style={{ position: 'absolute', top: 11, left: 11, display: 'flex', gap: 7, pointerEvents: 'none', zIndex: 2 }}>
        <span className="mono" style={overlayChip}>{active + 1} / {shots}</span>
      </div>
      <div style={{ position: 'absolute', top: 11, right: 11, display: 'flex', gap: 6, pointerEvents: 'none', zIndex: 2 }}>
        <span className="mono" style={{ ...overlayChip, fontSize: 9, padding: '4px 8px', border: '1px solid var(--accent-line)',
          color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <IcUpload size={11} />DROP TO REPLACE</span>
      </div>
    </div>
  );
}

/** Blueprint name, with an inline editor when `onRename` is given. */
function NameTitle({ bp, onRename }: { bp: Blueprint; onRename?: (b: Blueprint, name: string) => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(null); setError(null); }, [bp.id]);
  const title = { margin: 0, fontSize: 27, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.1 } as const;

  if (draft === null) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <h1 style={{ ...title, textWrap: 'balance' }}>{bp.name}</h1>
      {onRename && <IconBtn icon={IcPencil} title="Rename" onClick={() => setDraft(bp.name)} />}
    </div>
  );
  const name = draft.trim();
  const save = async () => {
    if (busy) return;
    if (!name || name === bp.name) { setDraft(null); return; }
    setBusy(true); setError(null);
    try { await onRename!(bp, name); setDraft(null); }
    catch (e) { setError(String(e).replace(/^Error: /, '')); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input autoFocus value={draft} aria-label="Blueprint name" disabled={busy} maxLength={128}
          onChange={e => { setDraft(e.target.value); setError(null); }}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); } }}
          style={{ ...title, flex: 1, minWidth: 0, padding: '2px 8px', borderRadius: 'var(--r)', background: 'var(--bg-deep)',
          border: `1px solid ${error ? 'var(--warn)' : 'var(--accent-line)'}`, color: 'var(--text)',
          fontFamily: 'inherit', outline: 'none' }} />
        <Btn variant="primary" icon={IcCheck} disabled={busy || !name} onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn>
        <Btn variant="ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</Btn>
      </div>
      <div role={error ? 'alert' : undefined} style={{ marginTop: 6, fontSize: 11.5, color: error ? 'var(--warn)' : 'var(--text-mute)' }}>
        {error ?? (bp.onDisk ? 'Renames the files in the game folder. Reload the save in-game to see the new name.' : '')}</div>
    </div>
  );
}

const fieldStyle = {
  width: '100%', height: 32, padding: '0 10px', borderRadius: 'var(--r-sm)', background: 'var(--bg-deep)',
  border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
} as const;

/** Category › sub-category, with an inline editor when `onSave` is given. */
function CategoryCard({ bp, categories, onSave }: {
  bp: Blueprint; categories: CategoryNode[];
  onSave?: (b: Blueprint, category: string, subcategory: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<{ cat: string; sub: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(null); setError(null); }, [bp.id]);

  if (!draft) return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="tlabel">Category</span>
        {onSave && <IconBtn icon={IcPencil} title="Edit category" onClick={() => setDraft({ cat: bp.category, sub: bp.subcategory ?? '' })} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, flexWrap: 'wrap',
        color: bp.category ? 'var(--text)' : 'var(--text-mute)' }}>
        {bp.category || 'Uncategorized'}
        {bp.subcategory && <><IcChevron size={12} style={{ color: 'var(--text-mute)' }} />{bp.subcategory}</>}
      </div>
    </div>
  );
  const { cat, sub } = draft;
  const subs = categories.find(c => c.name === cat.trim())?.subs ?? [];
  const save = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await onSave!(bp, cat, sub); setDraft(null); }
    catch (e) { setError(String(e).replace(/^Error: /, '')); }
    finally { setBusy(false); }
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); }
  };
  return (
    <div>
      <div className="tlabel" style={{ marginBottom: 8 }}>Category</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <input autoFocus value={cat} list="fa-categories" placeholder="Category" aria-label="Category" maxLength={64} disabled={busy}
          onChange={e => { setDraft({ cat: e.target.value, sub }); setError(null); }} onKeyDown={keys} style={fieldStyle} />
        <input value={sub} list="fa-subcategories" placeholder="Sub-category (optional)" aria-label="Sub-category" maxLength={64}
          disabled={busy || !cat.trim()} onChange={e => { setDraft({ cat, sub: e.target.value }); setError(null); }} onKeyDown={keys}
          style={fieldStyle} />
        <datalist id="fa-categories">{categories.filter(c => c.name).map(c => <option key={c.name} value={c.name} />)}</datalist>
        <datalist id="fa-subcategories">{subs.filter(x => x.name).map(x => <option key={x.name} value={x.name} />)}</datalist>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn variant="primary" size="sm" icon={IcCheck} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Btn>
          <Btn variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>Cancel</Btn>
        </div>
      </div>
      <div role={error ? 'alert' : undefined} style={{ marginTop: 6, fontSize: 11, lineHeight: 1.45, color: error ? 'var(--warn)' : 'var(--text-mute)' }}>
        {error ?? 'Kept in Factory Archive, not in the game files. Leave empty to clear.'}</div>
    </div>
  );
}

export function BlueprintDetail({ bp, onBack, onExport, onOpenFolder, onRename, onDelete, onSetCategory, categories = [], fav, onToggleFav, root = null }: {
  bp: Blueprint; onBack: () => void; onExport: (b: Blueprint) => void; onOpenFolder: (b: Blueprint) => void;
  onRename?: (b: Blueprint, name: string) => Promise<void>;
  onDelete?: (b: Blueprint) => void;
  onSetCategory?: (b: Blueprint, category: string, subcategory: string) => Promise<void>;
  /** every category in the library, for suggestions */
  categories?: CategoryNode[];
  fav: boolean; onToggleFav: () => void;
  /** game blueprints folder, to read this blueprint's own files */
  root?: string | null;
}) {
  const [active, setActive] = useState(0);
  const [images, setImages] = useState<Record<number, string>>({});
  useEffect(() => { setActive(0); setImages({}); }, [bp.id]);
  useEffect(() => () => Object.values(images).forEach(URL.revokeObjectURL), [images]);

  const s = STATUS[bp.status];
  const src = SOURCES[bp.source];
  const shots = Math.min(bp.shots, 6);
  const info = useBlueprintInfo(bp, root);
  const notes = bp.notes || info?.config?.description
    || (bp.onDisk ? `Saved in the “${bp.session}” world. Satisfactory loads it when that save is loaded.` : '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <DetailHeader bp={bp} onBack={onBack} fav={fav} onToggleFav={onToggleFav} onExport={() => onExport(bp)}
        onOpenFolder={() => onOpenFolder(bp)} onDelete={onDelete && (() => onDelete(bp))} />
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 350px', alignItems: 'start' }}>
          {/* ---- MAIN ---- */}
          <div style={{ padding: '22px 24px', minWidth: 0 }}>
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <SourceBadge src={bp.source} full />
                {bp.modded && <ModdedBadge large />}
                {bp.gameVersion && <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)' }}>v{bp.gameVersion}</span>}
              </div>
              <NameTitle bp={bp} onRename={onRename} />
              {(bp.title || info?.config) && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 14, color: 'var(--text-dim)' }}>
                {info?.config && <ConfigSwatch config={info.config} />}{bp.title}</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, color: 'var(--text-dim)', flexWrap: 'wrap' }}>
                {bp.author && <MetaInline icon={IcUser}>{bp.author}</MetaInline>}
                {bp.session && <MetaInline icon={IcFolder}>{bp.session}</MetaInline>}
                <MetaInline icon={IcCalendar}>{bp.added}</MetaInline>
                {bp.downloads != null && <MetaInline icon={IcDownload}>{bp.downloads.toLocaleString()}</MetaInline>}
              </div>
            </div>

            {/* gallery */}
            <HeroShot bp={bp} active={active} shots={shots} image={images[active]}
              onDropImage={url => setImages(m => ({ ...m, [active]: url }))} />
            <div style={{ display: 'flex', gap: 9, marginTop: 11, flexWrap: 'wrap' }}>
              {Array.from({ length: shots }).map((_, i) => (
                <button key={i} onClick={() => setActive(i)} aria-label={`Camera ${i + 1}`} aria-pressed={i === active}
                  style={{ width: 92, height: 60, borderRadius: 7,
                  overflow: 'hidden', flexShrink: 0, padding: 0, cursor: 'pointer', position: 'relative',
                  border: `${i === active ? 2 : 1}px solid ${i === active ? 'var(--accent)' : 'var(--border)'}`,
                  boxShadow: i === active ? '0 0 0 1px var(--accent-line),0 6px 16px -8px var(--accent-glow)' : 'none',
                  transition: 'all .14s' }}>
                  {images[i]
                    ? <img src={images[i]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : i === 0 ? <BlueprintImage bp={bp} /> : <Thumb hue={bp.hue} seed={bp.seed + i} label="" />}
                  <span className="mono" style={{ position: 'absolute', bottom: 3, left: 5, fontSize: 8,
                    color: 'rgba(255,255,255,.5)' }}>{String(i + 1).padStart(2, '0')}</span>
                </button>
              ))}
            </div>

            {info && (info.breakdown || info.error) && <Block title="Breakdown" icon={IcLayers}>
              <BreakdownSection info={info} />
            </Block>}

            <Block title="Notes" icon={IcInfo}>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.65, color: 'var(--text-dim)', textWrap: 'pretty', maxWidth: 640, whiteSpace: 'pre-line' }}>
                {notes}</p>
            </Block>

            {bp.materials.length > 0 && <Block title="Primary outputs & materials" icon={IcMaterial}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {bp.materials.map(m => (
                  <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 34, padding: '0 13px 0 10px',
                    borderRadius: 'var(--r)', background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: `hsl(${bp.hue} 60% 55%)`,
                      boxShadow: `0 0 6px hsl(${bp.hue} 60% 55% / .6)` }} />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{m}</span></span>
                ))}
              </div>
            </Block>}

            {bp.tags.length > 0 && <Block title="Tags" icon={IcTag}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {bp.tags.map(t => <Tag key={t}>{t}</Tag>)}
              </div>
            </Block>}
          </div>

          {/* ---- RIGHT RAIL ---- */}
          <div style={{ borderLeft: '1px solid var(--border)', padding: '22px 20px',
            display: 'flex', flexDirection: 'column', gap: 18, position: 'sticky', top: 0 }}>
            {/* sync status card */}
            <div style={{ borderRadius: 'var(--r-md)', border: `1px solid color-mix(in oklab,${s.color} 30%,var(--border))`,
              background: s.ghost, padding: 15 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span className="tlabel" style={{ color: 'var(--text-dim)' }}>Game folder status</span>
                <StatusPill status={bp.status} small />
              </div>
              {bp.status === 'config' && <div style={{ display: 'flex', gap: 8, marginBottom: 12, fontSize: 12,
                color: 'var(--warn)', lineHeight: 1.5 }}><IcWarn size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Missing <span className="mono">.sbpcfg</span> — blueprint will import without its config pairing.</span></div>}
              {bp.status === 'update' && <div style={{ display: 'flex', gap: 8, marginBottom: 12, fontSize: 12,
                color: 'var(--info)', lineHeight: 1.5 }}><IcRefresh size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>A newer revision is available from {src.label}.</span></div>}
              {bp.onDisk
                ? <Btn variant="primary" full icon={IcFolder} onClick={() => onOpenFolder(bp)}>Open in {bp.session}</Btn>
                : <Btn variant="primary" full icon={IcDownload} onClick={() => onExport(bp)}>
                    {bp.status === 'installed' ? 'Re-export to folder' : bp.status === 'update' ? 'Update in folder' : 'Export to game folder'}</Btn>}
            </div>

            <CategoryCard bp={bp} categories={categories} onSave={onSetCategory} />

            {(bp.dims || bp.power || bp.machines != null) && <div>
              <div className="tlabel" style={{ marginBottom: 11 }}>Specifications</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                {bp.dims && <MetaStat icon={IcDimensions} label="Footprint" value={`${bp.dims.x}×${bp.dims.y}`} />}
                {bp.dims && <MetaStat icon={IcLayers} label="Height" value={`${bp.dims.z}m`} />}
                {bp.machines != null && <MetaStat icon={IcMachine} label="Machines" value={bp.machines} />}
                {bp.power && <MetaStat icon={IcPower} label={bp.power.gen ? 'Output' : 'Draw'}
                  value={`${bp.power.gen || bp.power.use} MW`} accent={!bp.power.gen} />}
              </div>
            </div>}

            <div>
              <div className="tlabel" style={{ marginBottom: 11 }}>Files</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <FileRow file={`${bp.onDisk ? bp.name : 'blueprint'}.sbp`} ok={bp.files.sbp} size={bp.sizeKB} desc="Blueprint geometry" />
                <FileRow file={`${bp.onDisk ? bp.name : 'blueprint'}.sbpcfg`} ok={bp.files.sbpcfg}
                  size={bp.onDisk ? undefined : Math.round(bp.sizeKB * 0.06)} desc="Icon & description (optional)" />
              </div>
            </div>

            <div>
              <div className="tlabel" style={{ marginBottom: 11 }}>Source</div>
              <div style={{ borderRadius: 'var(--r)', border: '1px solid var(--border)', background: 'var(--panel-2)',
                padding: '12px 13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: bp.url ? 10 : 0 }}>
                  <SourceMark src={bp.source} size={18} />
                  <div><div style={{ fontSize: 13, fontWeight: 600 }}>{src.label}</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>{src.host}</div></div>
                </div>
                {bp.url && <a href={bp.url} onClick={e => { e.preventDefault(); openExternal(bp.url); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 7,
                  fontSize: 11, color: 'var(--steel)', textDecoration: 'none', padding: '8px 10px', borderRadius: 6,
                  background: 'var(--well)', border: '1px solid var(--border)' }}>
                  <IcLink size={13} /><span className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap' }}>{bp.url.replace(/^https?:\/\//, '')}</span><IcExternal size={13} /></a>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaInline({ icon: Ic, children }: { icon: Icon; children: ReactNode }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><Ic size={14} />
      <span className="mono" style={{ fontSize: 12 }}>{children}</span></span>
  );
}

function Block({ title, icon: Ic, children }: { title: string; icon: Icon; children: ReactNode }) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 13 }}>
        <Ic size={15} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-soft)' }} />
      </div>
      {children}
    </div>
  );
}

function FileRow({ file, ok, size, desc }: { file: string; ok: boolean; size?: number; desc: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', borderRadius: 'var(--r)',
      background: 'var(--panel-2)', border: `1px solid ${ok ? 'var(--border)' : 'var(--border-soft)'}`, opacity: ok ? 1 : .6 }}>
      <div style={{ width: 34, height: 34, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: ok ? 'var(--accent-ghost)' : 'var(--well)',
        border: `1px solid ${ok ? 'var(--accent-line)' : 'var(--border)'}`, color: ok ? 'var(--accent)' : 'var(--text-faint)' }}>
        <IcFile size={16} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: ok ? 'var(--text)' : 'var(--text-mute)' }}>
          {file}</div>
        <div style={{ fontSize: 11, color: 'var(--text-mute)' }}>{desc}</div>
      </div>
      {ok
        ? <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>{size != null ? `${size} KB` : '✓'}</span>
        : <span className="mono" style={{ fontSize: 10, color: 'var(--warn)' }}>MISSING</span>}
    </div>
  );
}
