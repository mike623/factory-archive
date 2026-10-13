// App.tsx — root: layout, routing, library state
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SAMPLE_LIBRARY, type Blueprint, type NavId, type SourceId } from './data';
import { Btn } from './components';
import { IcExport } from './icons';
import { EMPTY_FILTERS, FilterRail, Sidebar, type Filters } from './library';
import { LibraryBody, TopBar, type SortKey, type ViewMode } from './cards';
import { BlueprintDetail } from './detail';
import { ExportDrawer, ImportModal } from './modals';
import { EmptyState, NoResults } from './empty';
import { useTheme } from './theme';
import { blueprintDir, DEFAULT_BLUEPRINT_DIR } from './platform';

// `?empty` starts with an empty library so the first-run screen can be previewed
const START_EMPTY = new URLSearchParams(location.search).has('empty');
const RECENT_LIMIT = 6;

const NAV_TITLES: Record<NavId, string> = {
  library: 'Library', import: 'Import Queue', recent: 'Recent', favorites: 'Favorites',
};

const SORTERS: Record<SortKey, (a: Blueprint, b: Blueprint) => number> = {
  recent: (a, b) => b.added.localeCompare(a.added),
  name: (a, b) => a.name.localeCompare(b.name),
  downloads: (a, b) => b.downloads - a.downloads,
  power: (a, b) => (b.power.use + b.power.gen) - (a.power.use + a.power.gen),
};

function matches(b: Blueprint, query: string, source: SourceId | null, f: Filters) {
  if (query) {
    const q = query.toLowerCase();
    if (!(b.name.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) ||
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
  const [library, setLibrary] = useState<Blueprint[]>(() => START_EMPTY ? [] : SAMPLE_LIBRARY);
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
  const [folder, setFolder] = useState(DEFAULT_BLUEPRINT_DIR);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { blueprintDir().then(setFolder); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape') { setImportOpen(false); setExportOpen(false); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // the nav picks the base set; search, source and filters narrow it
  const scoped = useMemo(() => {
    switch (nav) {
      case 'import': return library.filter(b => imported.includes(b.id));
      case 'recent': return [...library].sort(SORTERS.recent).slice(0, RECENT_LIMIT);
      case 'favorites': return library.filter(b => favs.has(b.id));
      default: return library;
    }
  }, [nav, library, imported, favs]);

  const filtered = useMemo(
    () => scoped.filter(b => matches(b, query, sourceFilter, filters)).sort(SORTERS[sortKey]),
    [scoped, query, sourceFilter, filters, sortKey]);

  const toggleSel = useCallback((id: string) => setSel(s => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  }), []);
  const selItems = useMemo(() => library.filter(b => sel.has(b.id)), [library, sel]);
  const detailBp = detailId ? library.find(b => b.id === detailId) ?? null : null;

  const resetFilters = () => { setFilters(EMPTY_FILTERS); setQuery(''); setSourceFilter(null); };
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

  const showEmpty = library.length === 0;
  const counts = { library: library.length, import: imported.length, favorites: favs.size };

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--bg)', position: 'relative' }}>
      <Sidebar route={nav} onNav={id => { setNav(id); setDetailId(null); }} counts={counts}
        sourceFilter={sourceFilter} onSourceFilter={setSourceFilter}
        theme={theme} onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} folder={folder} />

      {detailBp
        ? <main style={{ flex: 1, minWidth: 0, background: 'var(--bg)' }}>
            <BlueprintDetail bp={detailBp} onBack={() => setDetailId(null)}
              fav={favs.has(detailBp.id)} onToggleFav={() => toggleFav(detailBp.id)}
              onExport={b => { setSel(new Set([b.id])); setExportOpen(true); }} />
          </main>
        : <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {!showEmpty && <TopBar query={query} setQuery={setQuery} searchRef={searchRef} view={view} setView={setView}
              filterOpen={filterOpen} setFilterOpen={setFilterOpen} onImport={() => setImportOpen(true)}
              sortKey={sortKey} setSortKey={setSortKey} />}
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {!showEmpty && filterOpen && <FilterRail filters={filters} setFilters={setFilters}
                counts={{ shown: filtered.length, total: scoped.length }} />}
              <div className="grid-bg" style={{ flex: 1, overflowY: 'auto', minWidth: 0, backgroundColor: 'var(--bg)' }}>
                {showEmpty
                  ? <EmptyState onImport={() => setImportOpen(true)} />
                  : scoped.length === 0
                    ? <NoResults title={`Nothing in ${NAV_TITLES[nav]} yet`}
                        hint={nav === 'import' ? 'Blueprints you import show up here.' : 'Star a blueprint from its detail page.'} />
                    : filtered.length === 0
                      ? <NoResults onReset={resetFilters} />
                      : <LibraryBody title={NAV_TITLES[nav]} bps={filtered} view={view} sel={sel} toggleSel={toggleSel}
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

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onAdd={addBlueprint} />
      <ExportDrawer open={exportOpen} items={selItems} folder={folder} onClose={() => setExportOpen(false)}
        onRemove={toggleSel} onExported={markInstalled} />
    </div>
  );
}
