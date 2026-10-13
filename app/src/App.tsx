// App.tsx — root: layout, routing, library state
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { powerTotal, SAMPLE_LIBRARY, type Blueprint, type NavId, type SourceId } from './data';
import { Btn } from './components';
import { IcCopy, IcExport } from './icons';
import { EMPTY_FILTERS, FilterRail, Sidebar, type Filters } from './library';
import { LibraryBody, TopBar, type SortKey, type ViewMode } from './cards';
import { BlueprintDetail } from './detail';
import { ExportDrawer, ImportModal, type LinkImport } from './modals';
import { EmptyState, NoResults } from './empty';
import { useTheme } from './theme';
import { useGameFolder } from './gameFolder';
import { toBlueprint, useDiskLibrary } from './diskLibrary';
import { CopyDrawer } from './copyDrawer';
import { Notices, useNotices } from './notices';
import { usePersistent } from './persist';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  copyBlueprints, importDropped, importFiles, isBlueprintFile, openFolder, pickBlueprintFiles, type Outcome,
} from './platform';
import { useShare } from './share';
import { ImportToasts } from './shareCard';
import { UpdateBanner } from './UpdateBanner';
import { useUpdater } from './updater';

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
].map(([session, name, size, cfg], i) => toBlueprint(session as string, {
  name: name as string, hasSbp: true, hasCfg: cfg as boolean, size: size as number, modified: 1791000000 - i * 86400,
  // the first one previews an import from a web page: details + picture
  meta: i === 0 ? { source: 'scim', sourceUrl: 'https://satisfactory-calculator.com/en/blueprints/index/details/id/10327/name/SFS+Foundry+x3',
    title: 'SFS Foundry x3 — compact steel', description: 'Three foundries fed by a single manifold. Preview data for the browser.',
    author: 'Preview Pioneer', category: 'Production', tags: ['Steel', 'Foundry', 'Compact'] } : null,
})).map((b, i) => i === 0 ? { ...b, imageUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#2b4a6b"/><stop offset="1" stop-color="#c97417"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><text x="24" y="336" font-family="monospace" font-size="18" fill="#fff" opacity=".8">PREVIEW PICTURE</text></svg>') } : b);

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
  // remembered on this machine between launches
  const [imported, setImported] = usePersistent<string[]>('fa-imported', () => []);
  const [favList, setFavList] = usePersistent<string[]>('fa-favorites',
    () => isTauri() ? [] : SAMPLE_LIBRARY.filter(b => b.status === 'installed').map(b => b.id));
  const favs = useMemo(() => new Set(favList), [favList]);
  const notices = useNotices();
  const updater = useUpdater();
  const [dropping, setDropping] = useState(false);
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
  // for files on disk, category / tags / sources come from imported pages' details
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const categoryOptions = useMemo(() => metadata ? undefined : uniq(items.map(b => b.category)), [items, metadata]);
  const tagChoices = useMemo(() => metadata ? undefined : uniq(items.flatMap(b => b.tags)).slice(0, 40), [items, metadata]);
  const showSources = metadata || items.some(b => b.source !== 'local');

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
  const rememberImported = (ids: string[]) => setImported(list => [...ids, ...list.filter(x => !ids.includes(x))].slice(0, 100));

  // where "add files" goes: the world shown in the filter, else the current save
  const importTarget = sessionFilter ?? currentSession;
  const addFiles = async (add: (root: string, session: string) => Promise<Outcome[]>) => {
    const root = gameFolder.current?.path;
    if (!root) { notices.push({ tone: 'warn', title: 'Satisfactory folder not found', detail: 'Choose it with the folder card in the sidebar.' }); return; }
    if (!importTarget) { notices.push({ tone: 'warn', title: 'Pick a world session first', detail: 'Choose one under World session in the filters.' }); return; }
    try {
      const out = await add(root, importTarget);
      notices.report('Added', importTarget, out);
      rememberImported(out.filter(o => o.ok).map(o => `disk:${importTarget}/${o.name}`));
      disk.reload();
    } catch (e) { notices.push({ tone: 'warn', title: "Couldn't add the files", detail: String(e) }); }
  };
  const importLink = async (url: string): Promise<LinkImport> => {
    const root = gameFolder.current?.path;
    if (!root) throw new Error('Satisfactory folder not found. Choose it with the folder card in the sidebar.');
    if (!importTarget) throw new Error('Pick a world session in the filters first.');
    const r = await invoke<LinkImport>('import_link', { root, session: importTarget, url });
    rememberImported([`disk:${r.session}/${r.name}`]);
    disk.reload();
    return r;
  };
  const browseFiles = async () => {
    const paths = await pickBlueprintFiles();
    if (paths.length) addFiles((root, session) => importFiles(root, session, paths));
  };
  const copyToWorld = async (target: string) => {
    const root = gameFolder.current?.path;
    if (!root) throw new Error('Satisfactory folder not found');
    const todo = selItems.filter(b => b.session && b.session !== target);
    const out = await copyBlueprints(root, todo.map(b => [b.session!, b.name]), target);
    rememberImported(out.filter(o => o.ok).map(o => `disk:${target}/${o.name}`));
    disk.reload();
    return out;
  };

  // friends' imports through the share page land in Import Queue too
  const lastShared = share.imports[0];
  useEffect(() => { if (lastShared) rememberImported([`disk:${lastShared.session}/${lastShared.name}`]); }, [lastShared]); // eslint-disable-line react-hooks/exhaustive-deps

  // drop .sbp / .sbpcfg files anywhere on the window to add them to the current world
  useEffect(() => {
    if (!isTauri()) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const over = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setDropping(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDropping(false); };
    const drop = (e: DragEvent) => {
      setDropping(false);
      const files = [...(e.dataTransfer?.files ?? [])].filter(f => isBlueprintFile(f.name));
      if (!files.length) return; // images etc. are handled by the gallery
      e.preventDefault();
      addFiles((root, session) => importDropped(root, session, files));
    };
    addEventListener('dragover', over); addEventListener('dragleave', leave); addEventListener('drop', drop);
    return () => { removeEventListener('dragover', over); removeEventListener('dragleave', leave); removeEventListener('drop', drop); };
  });

  const addBlueprint = (b: Blueprint) => {
    setLibrary(l => [b, ...l]);
    setImported(ids => [b.id, ...ids]);
  };
  const markInstalled = (ids: string[]) => {
    setLibrary(l => l.map(b => ids.includes(b.id) ? { ...b, status: 'installed' } : b));
    setSel(new Set());
  };
  const toggleFav = (id: string) => setFavList(f => f.includes(id) ? f.filter(x => x !== id) : [id, ...f]);

  const showEmpty = items.length === 0;
  const counts = {
    library: items.length,
    import: items.filter(b => imported.includes(b.id)).length,
    favorites: items.filter(b => favs.has(b.id)).length,
  };
  const copyMode = selItems.length > 0 && selItems.every(b => b.onDisk);

  return (
    <div style={{ height: '100vh', display: 'flex', background: 'var(--bg)', position: 'relative' }}>
      <Sidebar route={nav} onNav={id => { setNav(id); setDetailId(null); }} counts={counts}
        sourceFilter={sourceFilter} onSourceFilter={setSourceFilter}
        theme={theme} onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} gameFolder={gameFolder} share={share} showSources={showSources} updater={updater} />

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
                categories={categoryOptions} tagOptions={tagChoices}
                session={{ options: sessionOptions, current: currentSession, value: sessionFilter, onChange: setSessionChoice }} />}
              <div className="grid-bg" style={{ flex: 1, overflowY: 'auto', minWidth: 0, backgroundColor: 'var(--bg)' }}>
                {showEmpty
                  ? <EmptyState onImport={() => setImportOpen(true)} onBrowse={isTauri() ? browseFiles : undefined} />
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
        <Btn variant="primary" icon={copyMode ? IcCopy : IcExport} onClick={() => setExportOpen(true)}>
          {copyMode ? `Copy ${sel.size} to another world` : `Export ${sel.size} to game folder`}</Btn>
      </div>}

      <UpdateBanner u={updater} />
      <ImportToasts share={share} />
      <Notices list={notices.list} dismiss={notices.dismiss} />
      {dropping && <div style={{ position: 'fixed', inset: 0, zIndex: 80, pointerEvents: 'none', display: 'flex',
        alignItems: 'center', justifyContent: 'center', background: 'rgba(5,6,8,.55)', border: '3px dashed var(--accent)' }}>
        <div style={{ padding: '16px 22px', borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--accent-line)',
          fontSize: 15, fontWeight: 600 }}>
          {importTarget ? <>Drop .sbp files to add them to <span style={{ color: 'var(--accent)' }}>{importTarget}</span></> : 'Pick a world session first'}
        </div></div>}
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onAdd={addBlueprint}
        onBrowse={isTauri() ? () => { setImportOpen(false); browseFiles(); } : undefined} target={importTarget}
        importLink={isTauri() ? importLink : undefined} />
      {copyMode
        ? <CopyDrawer open={exportOpen} items={selItems} sessions={sessionOptions.map(o => o.name)} defaultTarget={currentSession}
            onClose={() => { setExportOpen(false); }} onRemove={toggleSel} onCopy={copyToWorld}
            onOpenTarget={t => gameFolder.current && openFolder(gameFolder.current.path, t).catch(console.error)} />
        : <ExportDrawer open={exportOpen} items={selItems} gameFolder={gameFolder} onClose={() => setExportOpen(false)}
            onRemove={toggleSel} onExported={markInstalled} />}
    </div>
  );
}
