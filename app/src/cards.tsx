// cards.tsx — top bar, blueprint card/row, library body
import { useState, type Ref } from 'react';
import { dimsLabel, type Blueprint } from './data';
import type { BlueprintGroup } from './library';
import { Btn, Check, FilePair, IconBtn, MiniTag, ModdedBadge, SourceBadge, StatusPill } from './components';
import { BlueprintImage } from './blueprintImage';
import { IcChevron, IcClose, IcFilter, IcFolder, IcGrid, IcList, IcMachine, IcPlus, IcPower, IcSearch, IcUser } from './icons';

export type SortKey = 'recent' | 'name' | 'downloads' | 'power';
export type ViewMode = 'grid' | 'list';

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

/* ============ TOP BAR ============ */
export function TopBar({ query, setQuery, searchRef, view, setView, filterOpen, setFilterOpen, onImport, sortKey, setSortKey }: {
  query: string; setQuery: (q: string) => void; searchRef: Ref<HTMLInputElement>;
  view: ViewMode; setView: (v: ViewMode) => void;
  filterOpen: boolean; setFilterOpen: (fn: (o: boolean) => boolean) => void;
  onImport: () => void; sortKey: SortKey; setSortKey: (k: SortKey) => void;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ height: 60, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12,
      padding: '0 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
      <IconBtn icon={IcFilter} active={filterOpen} title="Toggle filters" onClick={() => setFilterOpen(o => !o)} />
      {/* search */}
      <div style={{ flex: 1, maxWidth: 560, position: 'relative', display: 'flex', alignItems: 'center' }}>
        <IcSearch size={16} style={{ position: 'absolute', left: 13, color: 'var(--text-mute)' }} />
        <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
          aria-label="Search blueprints"
          placeholder="Search blueprints, authors, tags…"
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          style={{ width: '100%', height: 38, paddingLeft: 38, paddingRight: query ? 34 : 80, borderRadius: 'var(--r)',
          background: 'var(--panel)', border: `1px solid ${focus ? 'var(--accent-line)' : 'var(--border)'}`, color: 'var(--text)',
          fontSize: 13, outline: 'none', fontFamily: 'var(--font-display)' }} />
        {query
          ? <button onClick={() => setQuery('')} aria-label="Clear search" style={{ position: 'absolute', right: 10, color: 'var(--text-mute)',
              background: 'none', border: 'none', display: 'flex' }}><IcClose size={15} /></button>
          : <kbd className="mono" style={{ position: 'absolute', right: 10, fontSize: 10, color: 'var(--text-faint)',
              padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 4 }}>{isMac ? '⌘K' : 'Ctrl K'}</kbd>}
      </div>

      <div style={{ flex: 1 }} />

      {/* sort */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-mute)' }}>
        <span className="tlabel" style={{ fontSize: 9 }}>Sort</span>
        <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}
          style={{ height: 34, padding: '0 8px', borderRadius: 'var(--r)', background: 'var(--panel)',
          border: '1px solid var(--border)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)',
          fontSize: 11, outline: 'none' }}>
          <option value="recent">Recently added</option>
          <option value="name">Name A–Z</option>
          <option value="downloads">Most downloaded</option>
          <option value="power">Power draw</option>
        </select>
      </label>

      {/* view toggle */}
      <div role="group" aria-label="View" style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 'var(--r)', background: 'var(--panel)',
        border: '1px solid var(--border)' }}>
        {([['grid', IcGrid], ['list', IcList]] as const).map(([v, Ic]) => (
          <button key={v} onClick={() => setView(v)} aria-label={`${v} view`} aria-pressed={view === v}
            style={{ width: 30, height: 28, borderRadius: 5,
            display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none',
            background: view === v ? 'var(--raise)' : 'transparent',
            color: view === v ? 'var(--accent)' : 'var(--text-mute)', transition: 'all .14s' }}>
            <Ic size={16} /></button>
        ))}
      </div>

      <Btn variant="primary" icon={IcPlus} onClick={onImport}>Import</Btn>
    </div>
  );
}

interface ItemProps { bp: Blueprint; selected: boolean; onSelect: () => void; onOpen: () => void }

/* ============ GRID CARD ============ */
export function BlueprintCard({ bp, selected, onSelect, onOpen }: ItemProps) {
  const [hover, setHover] = useState(false);
  return (
    <div onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      role="link" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
      onFocus={() => setHover(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setHover(false); }}
      style={{ borderRadius: 'var(--r-md)', overflow: 'hidden', cursor: 'pointer', position: 'relative', outline: 'none',
      background: 'var(--panel)', border: `1px solid ${selected ? 'var(--accent-line)' : hover ? 'var(--border-strong)' : 'var(--border)'}`,
      boxShadow: hover ? '0 14px 30px -14px rgba(0,0,0,.7)' : 'none',
      transform: hover ? 'translateY(-2px)' : 'none', transition: 'all .18s var(--ease)' }}>
      {/* thumb */}
      <div style={{ position: 'relative', height: 158, borderBottom: '1px solid var(--border-soft)' }}>
        <BlueprintImage bp={bp} label={dimsLabel(bp) ? `${dimsLabel(bp)} · ${bp.shots} SHOTS` : `${bp.sizeKB} KB · .SBP`} />
        <div style={{ position: 'absolute', top: 9, left: 9, right: 9, display: 'flex', justifyContent: 'space-between',
          alignItems: 'flex-start', pointerEvents: 'none' }}>
          <div style={{ pointerEvents: 'auto', opacity: hover || selected ? 1 : 0, transition: 'opacity .15s' }}>
            <Check checked={selected} onChange={onSelect} label={`Select ${bp.name}`} />
          </div>
          <SourceBadge src={bp.source} />
        </div>
        <div style={{ position: 'absolute', bottom: 9, left: 9 }}><StatusPill status={bp.status} small /></div>
        {bp.modded && <div style={{ position: 'absolute', bottom: 9, right: 9 }}><ModdedBadge /></div>}
      </div>
      {/* body */}
      <div style={{ padding: '12px 13px 13px' }}>
        <h3 style={{ margin: 0, fontSize: 14.5, fontWeight: 600, letterSpacing: '-.01em', lineHeight: 1.25,
          textWrap: 'pretty' }}>{bp.name}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, color: 'var(--text-mute)', minWidth: 0 }}>
          {bp.author
            ? <><IcUser size={12} /><span className="mono" style={{ fontSize: 11 }}>{bp.author}</span></>
            : bp.session && <><IcFolder size={12} style={{ flexShrink: 0 }} /><span className="mono" style={{ fontSize: 11,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bp.session}</span></>}
          {bp.gameVersion && <><span style={{ opacity: .4 }}>·</span>
            <span className="mono" style={{ fontSize: 11 }}>v{bp.gameVersion}</span></>}
          {bp.onDisk && <><span style={{ opacity: .4 }}>·</span><span className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{bp.added}</span></>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 11 }}>
          {bp.tags.slice(0, 3).map(t => <MiniTag key={t}>{t}</MiniTag>)}
          {bp.tags.length > 3 && <span className="mono" style={{ fontSize: 10, padding: '2px 6px',
            color: 'var(--text-mute)' }}>+{bp.tags.length - 3}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12,
          paddingTop: 11, borderTop: '1px solid var(--border-soft)' }}>
          <FilePair files={bp.files} compact />
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, color: 'var(--text-mute)' }}>
            {bp.machines != null && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Machines">
              <IcMachine size={13} /><span className="mono" style={{ fontSize: 11 }}>{bp.machines}</span></span>}
            {bp.power && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={bp.power.gen ? 'Power generated (MW)' : 'Power draw (MW)'}>
              <IcPower size={13} style={{ color: bp.power.gen ? 'var(--ok)' : 'var(--accent)' }} />
              <span className="mono" style={{ fontSize: 11 }}>{bp.power.gen || bp.power.use}</span></span>}
            {bp.onDisk && <span className="mono" style={{ fontSize: 11 }} title=".sbp size">{bp.sizeKB} KB</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ LIST ROW ============ */
export const LIST_COLS = '2.4fr 1fr 110px 150px 130px 44px';

export function BlueprintRow({ bp, selected, onSelect, onOpen }: ItemProps) {
  const [hover, setHover] = useState(false);
  return (
    <div onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      role="link" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}
      style={{ display: 'grid', gridTemplateColumns: LIST_COLS, alignItems: 'center', gap: 14, height: 62,
      padding: '0 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-soft)', outline: 'none',
      background: selected ? 'var(--accent-ghost)' : hover ? 'var(--panel)' : 'transparent', transition: 'background .12s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{ opacity: hover || selected ? 1 : .25, transition: 'opacity .15s' }}>
          <Check checked={selected} onChange={onSelect} label={`Select ${bp.name}`} /></div>
        <div style={{ width: 64, height: 42, borderRadius: 6, overflow: 'hidden', flexShrink: 0,
          border: '1px solid var(--border)' }}><BlueprintImage bp={bp} /></div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis' }}>{bp.name}</div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)', marginTop: 2 }}>
            {(bp.onDisk ? [bp.session, `${bp.sizeKB} KB`, bp.added] : [bp.author, bp.gameVersion && `v${bp.gameVersion}`, dimsLabel(bp)])
              .filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', overflow: 'hidden', maxHeight: 24 }}>
        {bp.tags.slice(0, 2).map(t => <MiniTag key={t}>{t}</MiniTag>)}
      </div>
      <div><SourceBadge src={bp.source} /></div>
      <div><FilePair files={bp.files} compact /></div>
      <div><StatusPill status={bp.status} small /></div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', color: 'var(--text-mute)' }}>
        <IconBtn icon={IcChevron} size={15} title="Open" />
      </div>
    </div>
  );
}

/* ============ LIBRARY BODY ============ */
export function LibraryBody({ title, groups, view, sel, toggleSel, openDetail, total }: {
  title: string; groups: BlueprintGroup[]; view: ViewMode; sel: Set<string>;
  toggleSel: (id: string) => void; openDetail: (b: Blueprint) => void; total: number;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const flip = (k: string) => setClosed(c => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const body = (bps: Blueprint[]) => view === 'grid'
    ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(258px,1fr))', gap: 15 }}>
        {bps.map(b => <BlueprintCard key={b.id} bp={b} selected={sel.has(b.id)}
          onSelect={() => toggleSel(b.id)} onOpen={() => openDetail(b)} />)}
      </div>
    : <div>{bps.map(b => <BlueprintRow key={b.id} bp={b} selected={sel.has(b.id)}
        onSelect={() => toggleSel(b.id)} onOpen={() => openDetail(b)} />)}</div>;
  return (
    <div style={{ padding: view === 'grid' ? '18px 20px 90px' : '0 0 90px' }}>
      {view === 'grid' && <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16, padding: '0 2px' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-.01em' }}>{title}</h2>
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>{shown} of {total} blueprints</span>
      </div>}
      {view === 'list' && <div style={{ display: 'grid', gridTemplateColumns: LIST_COLS, gap: 14, padding: '13px 14px',
        borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 2 }}>
        {['Blueprint', 'Tags', 'Source', 'Files', 'Status', ''].map((h, i) =>
          <span key={i} className="tlabel" style={{ fontSize: 9 }}>{h}</span>)}
      </div>}
      {groups.map((g, i) => {
        if (g.label === null) return <div key={g.key}>{body(g.items)}</div>;
        const open = !closed.has(g.key);
        return (
          <section key={g.key} style={{ marginBottom: open && view === 'grid' ? 18 : 6 }}>
            {/* numbered, collapsible section bar, like the game's build menu */}
            <button onClick={() => flip(g.key)} aria-expanded={open} style={{ display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', height: 30, padding: '0 12px', marginBottom: open && view === 'grid' ? 12 : 0,
              background: 'var(--panel)', border: 'none', borderRadius: view === 'grid' ? 'var(--r-sm)' : 0,
              color: 'var(--text-dim)', fontSize: 13, fontWeight: 500, textAlign: 'left',
              fontStyle: g.key ? undefined : 'italic' }}>
              <IcChevron size={12} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .14s', opacity: .7 }} />
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>{i + 1}.</span>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.label}</span>
              <span className="mono" style={{ fontSize: 10.5, opacity: .6 }}>{g.items.length}</span>
            </button>
            {open && body(g.items)}
          </section>
        );
      })}
    </div>
  );
}
