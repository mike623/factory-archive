// App.tsx — root: layout, routing, library state
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { powerTotal, SAMPLE_LIBRARY, type Blueprint, type NavId, type SourceId } from './data';
import { Btn } from './components';
import { IcExport } from './icons';
import { EMPTY_FILTERS, FilterRail, Sidebar, type Filters } from './library';
import { LibraryBody, TopBar, type SortKey, type ViewMode } from './cards';
import { BlueprintDetail } from './detail';
import { ExportDrawer, ImportModal } from './modals';
import { EmptyState, NoResults } from './empty';
import { useTheme } from './theme';
import { useGameFolder } from './gameFolder';
import { toBlueprint, useDiskLibrary } from './diskLibrary';
import { openFolder } from './platform';
import { useShare } from './share';
import { ImportToasts } from './shareCard';
import { UpdateBanner } from './UpdateBanner';

// `?empty` starts with an empty library so the first-run screen can be previewed
const START_EMPTY = new URLSearchParams(location.search).has('empty');
const RECENT_LIMIT = 6;
// `?disk` previews how real files from the game folder look (the desktop app reads them for real)
const PREVIEW_DISK = new URLSearchParams(location.search).has('disk');
const DISK_DEMO: Blueprint[] = [
  ['Preview World', '4x4 Steel Ingots 360', 48211, true],
  ['Preview World', 'Coal Gen Block', 9120, false],
  ['Preview World', 'Main Bus Splitter', 15400, true],
  ['Old World', 'Starter Smelters', 6100, true],
].map(([session, name, size, cfg], i) => toBlueprint(session as string,
  { name: name as string, hasSbp: true, hasCfg: cfg as boolean, size: size as number, modified: 1791000000 - i * 86400 }));

const NAV_TITLES: Record<NavId, string> = {
  library: 'Library', import: 'Import Queue', recent: 'Recent', favorites: 'Favorites',
};

const SORTERS: Record<SortKey, (a: Blueprint, b: Blueprint) => number> = {
  recent: (a, b) => b.added.localeCompare(a.added),
  name: (a, b) => a.name.localeCompare(b.name),
  downloads: (a, b) => (b.downloads ?? 0) - (a.downloads ?? 0),
  power: (a, b) => powerTotal(b) - powerTotal(a),
};

function matches(b: Blueprint, query: string, source: SourceId | null, f: Filters, session: string | null) {
  if (session && b.session !== session) return false;
  if (query) {
    const q = query.toLowerCase();
    if (!(b.name.toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q) || (b.session ?? '').toLowerCase().includes(q) ||
          b.tags.some(t => t.toLowerCase().includes(q)))) return false;
  }
  if (source && b.source !== source) return false;
  if (f.category && b.category !== f.category) return false;
  if (f.tags.length && !f.tags.every(t => b.tags.includes(t))) return false;
  if (f.modded && !b.modded) return false;
  if (f.paired && !b.files.sbpcfg) return false;
  if (f.installed && b.status !== 'installed') return false;
  if (f.version && f.version !== 'Any' && b.gameVersion !== f.version) return false;
  return true;
}

export default function App() {
  const [theme, setTheme] = useTheme();
  // browser preview: sample data spread over two pretend worlds; the desktop app reads real files instead
  const [library, setLibrary] = useState<Blueprint[]>(() => START_EMPTY ? [] : PREVIEW_DISK ? DISK_DEMO :
    SAMPLE_LIBRARY.map((b, i) => ({ ...b, session: i < 8 ? 'Preview World' : 'Old World' })));
  const [imported, setImported] = useState<string[]>([]);
  const [favs, setFavs] = useState<Set<string>>(
    () => new Set(SAMPLE_LIBRARY.filter(b => b.status === 'installed').map(b => b.id)));
  const [nav, setNav] = useState<NavId>('library');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>('grid');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [filterOpen, setFilterOpen] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<SourceId | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const gameFolder = useGameFolder();
  const share = useShare(gameFolder.current?.path ?? null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape') { setImportOpen(false); setExportOpen(false); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const disk = useDiskLibrary(gameFolder.current?.path ?? null, share.imports.length);
  const items = disk.items ?? library;
  const metadata = items.some(b => !b.onDisk);

  // World session filter: follows the current save until the user picks something else
  const currentSession = share.sessions?.pinned ?? share.sessions?.detected?.name ?? null;
  const [sessionChoice, setSessionChoice] = useState<string | null | undefined>(undefined);
  const sessionFilter = sessionChoice === undefined ? currentSession : sessionChoice;
  const sessionOptions = useMemo(() => {
    const names = disk.items ? [...disk.sessions] : [...new Set(items.map(b => b.session).filter((s): s is string => !!s))];
    if (currentSession && !names.includes(currentSession)) names.unshift(currentSession);
    return names.map(name => ({ name, count: items.filter(b => b.session === name).length }));
  }, [disk.items, disk.sessions, items, currentSession]);

  // the nav picks the base set; search, session, source and filters narrow it
  const scoped = useMemo(() => {
    switch (nav) {
      case 'import': return items.filter(b => imported.includes(b.id));
      case 'recent': return [...items].sort(SORTERS.recent).slice(0, RECENT_LIMIT);
      case 'favorites': return items.filter(b => favs.has(b.id));
      default: return items;
    }
  }, [nav, items, imported, favs]);

  const filtered = useMemo(
    () => scoped.filter(b => matches(b, query, sourceFilter, filters, sessionFilter)).sort(SORTERS[sortKey]),
    [scoped, query, sourceFilter, filters, sessionFilter, sortKey]);
  const sessionIsEmpty = !!sessionFilter && !scoped.some(b => b.session === sessionFilter);

  const toggleSel = useCallback((id: string) => setSel(s => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  }), []);
  const selItems = useMemo(() => items.filter(b => sel.has(b.id)), [items, sel]);
  const detailBp = detailId ? items.find(b => b.id === detailId) ?? null : null;

  const resetFilters = () => { setFilters(EMPTY_FILTERS); setQuery(''); setSourceFilter(null); setSessionChoice(undefined); };
  const openBlueprintFolder = (b: Blueprint) => {
    if (gameFolder.current) openFolder(gameFolder.current.path, b.session).catch(console.error);
  };
  const addBlueprint = (b: Blueprint) => {
    setLibrary(l => [b, ...l]);
    setImported(ids => [b.id, ...ids]);
  };
  const markInstalled = (ids: string[]) => {
    setLibrary(l => l.map(b => ids.includes(b.id) ? { ...b, status: 'installed' } : b));
    setSel(new Set());
  };
  const toggleFav = (id: string) => setFavs(f => {
    const n = new Set(f); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const showEmpty = items.length === 0;
  const counts = { library: items.length, import: imported.length, favorites: favs.size };

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--bg)', position: 'relative' }}>
      <Sidebar route={nav} onNav={id => { setNav(id); setDetailId(null); }} counts={counts}
        sourceFilter={sourceFilter} onSourceFilter={setSourceFilter}
        theme={theme} onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} gameFolder={gameFolder} share={share} />

      {detailBp
        ? <main style={{ flex: 1, minWidth: 0, background: 'var(--bg)' }}>
            <BlueprintDetail bp={detailBp} onBack={() => setDetailId(null)}
              fav={favs.has(detailBp.id)} onToggleFav={() => toggleFav(detailBp.id)}
              onExport={b => { setSel(new Set([b.id])); setExportOpen(true); }} onOpenFolder={openBlueprintFolder} />
          </main>
        : <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {!showEmpty && <TopBar query={query} setQuery={setQuery} searchRef={searchRef} view={view} setView={setView}
              filterOpen={filterOpen} setFilterOpen={setFilterOpen} onImport={() => setImportOpen(true)}
              sortKey={sortKey} setSortKey={setSortKey} />}
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {!showEmpty && filterOpen && <FilterRail filters={filters} setFilters={setFilters}
                counts={{ shown: filtered.length, total: scoped.length }} onReset={resetFilters} metadata={metadata}
                session={{ options: sessionOptions, current: currentSession, value: sessionFilter, onChange: setSessionChoice }} />}
              <div className="grid-bg" style={{ flex: 1, overflowY: 'auto', minWidth: 0, backgroundColor: 'var(--bg)' }}>
                {showEmpty
                  ? <EmptyState onImport={() => setImportOpen(true)} />
                  : scoped.length === 0
                    ? <NoResults title={`Nothing in ${NAV_TITLES[nav]} yet`}
                        hint={nav === 'import' ? 'Blueprints you import show up here.' : 'Star a blueprint from its detail page.'} />
                    : filtered.length === 0
                      ? sessionIsEmpty
                        ? <NoResults title={`No blueprints in ${sessionFilter} yet`} resetLabel="Show all sessions"
                            hint="Save one with the Blueprint Designer in that world, or look at your other sessions."
                            onReset={() => setSessionChoice(null)} />
                        : <NoResults onReset={resetFilters} />
                      : <LibraryBody title={sessionFilter ? `${NAV_TITLES[nav]} · ${sessionFilter}` : NAV_TITLES[nav]} bps={filtered} view={view} sel={sel} toggleSel={toggleSel}
                          openDetail={b => setDetailId(b.id)} total={scoped.length} />}
              </div>
            </div>
          </main>}

      {/* selection bar */}
      {sel.size > 0 && !detailBp && <div style={{ position: 'absolute', bottom: 18, left: 'calc(50% + 105px)',
        transform: 'translateX(-50%)', zIndex: 30, display: 'flex', alignItems: 'center', gap: 14,
        padding: '9px 9px 9px 16px', borderRadius: 12, background: 'var(--floatbar)', backdropFilter: 'blur(10px)',
        border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow-lg)', animation: 'fadein .2s' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: 600 }}>
          <span className="mono" style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--accent)',
            color: '#1a1206', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>{sel.size}</span>
          selected</span>
        <span style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <button onClick={() => setSel(new Set())} style={{ background: 'none', border: 'none', color: 'var(--text-mute)',
          fontSize: 12.5, fontFamily: 'var(--font-display)' }}>Clear</button>
        <Btn variant="primary" icon={IcExport} onClick={() => setExportOpen(true)}>Export {sel.size} to game folder</Btn>
      </div>}

      <UpdateBanner />
      <ImportToasts share={share} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onAdd={addBlueprint} />
      <ExportDrawer open={exportOpen} items={selItems} gameFolder={gameFolder} onClose={() => setExportOpen(false)}
        onRemove={toggleSel} onExported={markInstalled} />
    </div>
  );
}
