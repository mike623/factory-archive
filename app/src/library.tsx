// library.tsx — sidebar + filter rail
import { useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { CATEGORIES, ALL_TAGS, GAME_VERSIONS, SOURCES, type NavId, type SourceId } from './data';
import { Btn, Dot, SourceMark, Tag } from './components';
import {
  IcCheck, IcClock, IcCube, IcFile, IcFolder, IcFilter, IcInbox, IcLibrary, IcMoon, IcRefresh, IcStar, IcSun,
  IcWrench, type Icon,
} from './icons';
import type { Theme } from './theme';
import { openFolder, tailPath } from './platform';
import type { GameFolderState } from './gameFolder';
import type { ShareStateUI } from './share';
import { ShareCard } from './shareCard';

export interface Filters {
  tags: string[];
  category: string | null;
  modded: boolean;
  paired: boolean;
  installed: boolean;
  version: string | null;
}
export const EMPTY_FILTERS: Filters = { tags: [], category: null, modded: false, paired: false, installed: false, version: null };

const NAV: { id: NavId; label: string; icon: Icon }[] = [
  { id: 'library',   label: 'Library',      icon: IcLibrary },
  { id: 'import',    label: 'Import Queue', icon: IcInbox },
  { id: 'recent',    label: 'Recent',       icon: IcClock },
  { id: 'favorites', label: 'Favorites',    icon: IcStar },
];

const footerBtn: CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  borderRadius: 'var(--r-sm)', background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text-dim)',
};

/* ============ SIDEBAR ============ */
export function Sidebar({ route, onNav, counts, sourceFilter, onSourceFilter, theme, onToggleTheme, gameFolder, share, showSources }: {
  route: NavId; onNav: (id: NavId) => void; counts: Partial<Record<NavId, number>>;
  sourceFilter: SourceId | null; onSourceFilter: (s: SourceId | null) => void;
  theme: Theme; onToggleTheme: () => void; gameFolder: GameFolderState; share: ShareStateUI;
  /** blueprint-site sources only mean something for site metadata */
  showSources: boolean;
}) {
  const { current, loading, pickCustom: onPickFolder } = gameFolder;
  const linked = !!current?.found;
  const targetSession = share.sessions?.pinned ?? share.sessions?.detected?.name ?? null;
  const [folderError, setFolderError] = useState<string | null>(null);
  const openCurrent = async () => {
    if (!current) return;
    setFolderError(null);
    try { await openFolder(current.path, targetSession); }
    catch (e) { setFolderError(String(e).replace(/^Error: /, '')); setTimeout(() => setFolderError(null), 6000); }
  };
  return (
    <aside style={{ width: 210, flexShrink: 0, background: 'var(--bg-deep)',
      borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
      {/* brand */}
      <div style={{ padding: '16px 16px 14px', borderBottom: '1px solid var(--border-soft)',
        display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 7, flexShrink: 0,
          background: 'linear-gradient(150deg,var(--accent-bright),var(--accent-deep))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 14px -4px var(--accent-glow)' }}>
          <IcCube size={17} sw={1.8} style={{ color: '#1a1206' }} />
        </div>
        <div style={{ lineHeight: 1.15, flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: '-.01em' }}>Factory Archive</div>
          <div className="tlabel" style={{ fontSize: 8.5, marginTop: 2 }}>Blueprint Manager</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px' }}>
        <div className="tlabel" style={{ padding: '4px 8px 8px' }}>Workspace</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(({ id, label, icon: Ic }) => {
            const on = route === id;
            const count = counts[id];
            return (
              <button key={id} onClick={() => onNav(id)} aria-current={on ? 'page' : undefined}
                style={{ display: 'flex', alignItems: 'center',
                gap: 10, height: 34, padding: '0 9px', borderRadius: 'var(--r)', width: '100%', textAlign: 'left',
                background: on ? 'var(--accent-ghost)' : 'transparent',
                border: `1px solid ${on ? 'var(--accent-line)' : 'transparent'}`,
                color: on ? 'var(--accent-bright)' : 'var(--text-dim)', position: 'relative',
                fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: on ? 600 : 500,
                transition: 'all .14s var(--ease)' }}>
                {on && <span style={{ position: 'absolute', left: -10, top: 7, bottom: 7, width: 3, borderRadius: 3,
                  background: 'var(--accent)', boxShadow: '0 0 8px var(--accent-glow)' }} />}
                <Ic size={16} /><span style={{ flex: 1 }}>{label}</span>
                {count != null && <span className="mono" style={{ fontSize: 10.5, opacity: .7,
                  padding: '1px 6px', borderRadius: 99, background: 'var(--well)', border: '1px solid var(--border)' }}>{count}</span>}
              </button>
            );
          })}
        </nav>

        {showSources && <>
        <div className="tlabel" style={{ padding: '18px 8px 8px' }}>Sources</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {Object.values(SOURCES).map(s => {
            const on = sourceFilter === s.id;
            return (
              <button key={s.id} onClick={() => onSourceFilter(on ? null : s.id)} aria-pressed={on}
                style={{ display: 'flex', alignItems: 'center', gap: 10, height: 32, padding: '0 9px',
                borderRadius: 'var(--r)', width: '100%', textAlign: 'left',
                background: on ? 'var(--well)' : 'transparent', border: `1px solid ${on ? 'var(--border)' : 'transparent'}`,
                color: on ? 'var(--text)' : 'var(--text-dim)', fontSize: 12.5, fontWeight: 500,
                transition: 'all .14s var(--ease)' }}>
                <SourceMark src={s.id} size={15} />
                <span style={{ flex: 1 }}>{s.label}</span>
                {on && <IcCheck size={13} style={{ color: s.color }} />}
              </button>
            );
          })}
        </div>
        </>}
      </div>

      <div style={{ padding: '0 12px 10px' }}>
        <div className="tlabel" style={{ padding: '0 0 8px 6px' }}>Multiplayer</div>
        <ShareCard share={share} />
      </div>

      {/* sync footer */}
      <div style={{ padding: 12, borderTop: '1px solid var(--border-soft)', display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <button onClick={onPickFolder} title={current ? `${current.path}\nClick to choose another folder` : 'Choose the blueprints folder'}
          style={{ flex: 1, minWidth: 0, padding: '10px 11px', borderRadius: 'var(--r)', background: 'var(--panel)',
          border: '1px solid var(--border)', textAlign: 'left', color: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
            <Dot color={linked ? 'var(--ok)' : 'var(--warn)'} />
            <span className="tlabel" style={{ fontSize: 9, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
              {loading ? 'Scanning…' : linked ? 'Folder linked' : 'Game not found'}</span>
          </div>
          <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-mute)', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {!current ? 'Choose folder…' : current.kind === 'crossover' ? current.label : tailPath(current.path, 2)}</div>
        </button>
        <div style={{ width: 30, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={openCurrent} disabled={!current}
            title={targetSession ? `Open the "${targetSession}" blueprint folder` : 'Open the blueprint folder'}
            aria-label="Open blueprint folder" style={footerBtn}>
            <IcFolder size={14} />
          </button>
          <button onClick={onToggleTheme} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} style={footerBtn}>
            {theme === 'dark' ? <IcSun size={14} /> : <IcMoon size={14} />}
          </button>
        </div>
      </div>
      {folderError && <div role="alert" style={{ padding: '0 12px 10px', marginTop: -4, fontSize: 10.5, lineHeight: 1.4,
        color: 'var(--warn)' }}>{folderError}</div>}
    </aside>
  );
}

/* ============ FILTER RAIL ============ */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ padding: 14, borderBottom: '1px solid var(--border-soft)' }}>
      <div style={{ marginBottom: 11 }}><span className="tlabel">{label}</span></div>
      {children}
    </div>
  );
}

export interface SessionFilter {
  /** world sessions to choose from, with how many blueprints each holds */
  options: { name: string; count: number }[];
  /** the host's current world (latest autosave, or the one picked for imports) */
  current: string | null;
  /** selected session; null = all sessions */
  value: string | null;
  onChange: (v: string | null) => void;
}

export function FilterRail({ filters, setFilters, counts, session, onReset, metadata }: {
  filters: Filters; setFilters: Dispatch<SetStateAction<Filters>>; counts: { shown: number; total: number };
  session: SessionFilter; onReset: () => void;
  /** false when every blueprint comes from disk: hide filters for site-only metadata */
  metadata: boolean;
}) {
  const toggleTag = (t: string) => setFilters(f => ({ ...f, tags: f.tags.includes(t) ? f.tags.filter(x => x !== t) : [...f.tags, t] }));
  const setCat = (c: string) => setFilters(f => ({ ...f, category: f.category === c ? null : c }));
  const flip = (k: 'modded' | 'paired' | 'installed') => setFilters(f => ({ ...f, [k]: !f[k] }));
  return (
    <aside style={{ width: 236, flexShrink: 0, background: 'var(--bg)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
      <div style={{ padding: '14px 14px 12px', display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid var(--border-soft)' }}>
        <IcFilter size={15} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>Filters</span>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-mute)' }}>
          {counts.shown}/{counts.total}</span>
      </div>

      {session.options.length > 0 && <Section label="World session">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {[{ name: null as string | null, count: session.options.reduce((n, o) => n + o.count, 0) }, ...session.options].map(o => {
            const on = session.value === o.name;
            return (
              <button key={o.name ?? '__all__'} onClick={() => session.onChange(o.name)} aria-pressed={on}
                style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, padding: '0 10px', borderRadius: 'var(--r-sm)',
                background: on ? 'var(--accent-ghost)' : 'transparent',
                border: `1px solid ${on ? 'var(--accent-line)' : 'transparent'}`,
                color: on ? 'var(--accent-bright)' : 'var(--text-dim)', fontSize: 12.5, fontWeight: 500, transition: 'all .14s' }}>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {o.name ?? 'All sessions'}</span>
                {o.name && o.name === session.current && <span className="mono" style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: '.06em',
                  padding: '1px 5px', borderRadius: 4, color: 'var(--accent)', border: '1px solid var(--accent-line)' }}>CURRENT</span>}
                <span className="mono" style={{ fontSize: 10, opacity: .6 }}>{o.count}</span>
              </button>
            );
          })}
        </div>
      </Section>}

      {metadata && <Section label="Category">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {CATEGORIES.map(c => {
            const on = filters.category === c;
            return (
              <button key={c} onClick={() => setCat(c)} aria-pressed={on} style={{ display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', height: 30, padding: '0 10px', borderRadius: 'var(--r-sm)',
                background: on ? 'var(--accent-ghost)' : 'transparent',
                border: `1px solid ${on ? 'var(--accent-line)' : 'transparent'}`,
                color: on ? 'var(--accent-bright)' : 'var(--text-dim)', fontSize: 12.5, fontWeight: 500,
                transition: 'all .14s' }}>
                <span>{c}</span>{on && <IcCheck size={13} />}
              </button>
            );
          })}
        </div>
      </Section>}

      {metadata && <Section label="Tags">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ALL_TAGS.map(t => <Tag key={t} active={filters.tags.includes(t)} onClick={() => toggleTag(t)}>{t}</Tag>)}
        </div>
      </Section>}

      <Section label={metadata ? 'Compatibility' : 'Files'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {metadata && <ToggleRow label="Modded only" icon={IcWrench} on={filters.modded} onClick={() => flip('modded')} />}
          <ToggleRow label="Has .sbpcfg pair" icon={IcFile} on={filters.paired} onClick={() => flip('paired')} />
          {metadata && <ToggleRow label="Installed in game" icon={IcCheck} on={filters.installed} onClick={() => flip('installed')} />}
        </div>
      </Section>

      {metadata && <Section label="Game version">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {GAME_VERSIONS.map(v => {
            const on = filters.version === v;
            return (
              <button key={v} onClick={() => setFilters(f => ({ ...f, version: f.version === v ? null : v }))} aria-pressed={on}
                style={{ height: 30, padding: '0 12px', borderRadius: 'var(--r-sm)', fontFamily: 'var(--font-mono)',
                fontSize: 11.5, fontWeight: 600,
                background: on ? 'var(--accent-ghost)' : 'var(--well)',
                border: `1px solid ${on ? 'var(--accent-line)' : 'var(--border)'}`,
                color: on ? 'var(--accent-bright)' : 'var(--text-dim)' }}>{v}</button>
            );
          })}
        </div>
      </Section>}

      <div style={{ padding: 14, marginTop: 'auto' }}>
        <Btn variant="ghost" size="sm" full icon={IcRefresh} onClick={onReset}>
          Reset filters
        </Btn>
      </div>
    </aside>
  );
}

export function ToggleRow({ label, icon: Ic, on, onClick }: { label: string; icon: Icon; on: boolean; onClick: () => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%',
      height: 30, padding: '0 4px', background: 'transparent', border: 'none',
      color: on ? 'var(--text)' : 'var(--text-dim)', fontSize: 12.5, fontWeight: 500 }}>
      <span style={{ width: 32, height: 18, borderRadius: 99, flexShrink: 0, position: 'relative',
        background: on ? 'var(--accent)' : 'var(--track-off)', transition: 'background .15s' }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 14, height: 14, borderRadius: '50%',
          background: 'var(--knob)', boxShadow: '0 1px 2px rgba(0,0,0,.25)', transition: 'left .15s var(--ease)' }} />
      </span>
      <Ic size={14} style={{ color: on ? 'var(--accent)' : 'var(--text-mute)' }} />
      <span>{label}</span>
    </button>
  );
}
