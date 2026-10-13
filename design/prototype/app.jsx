// app.jsx — root: window chrome, scaling, routing, state
const { useState:uS, useEffect:uE, useMemo:uM, useCallback:uC } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark"
}/*EDITMODE-END*/;

const WIN_W = 1360, WIN_H = 884;

function TitleBar({ firstRun, setFirstRun, selCount, onExport }){
  return (
    <div style={{height:38,flexShrink:0,display:'flex',alignItems:'center',gap:14,padding:'0 14px',
      background:'var(--chrome)',borderBottom:'1px solid var(--border)',
      position:'relative'}}>
      <div style={{display:'flex',gap:8}}>
        {['#ff5f57','#febc2e','#28c840'].map(c=>(
          <span key={c} style={{width:12,height:12,borderRadius:'50%',background:c,
            boxShadow:`0 0 0 1px rgba(0,0,0,.2) inset`}}/>
        ))}
      </div>
      <div style={{position:'absolute',left:'50%',transform:'translateX(-50%)',display:'flex',
        alignItems:'center',gap:8,color:'var(--text-mute)'}}>
        <IcCube size={13} style={{color:'var(--accent)'}}/>
        <span className="mono" style={{fontSize:11,letterSpacing:'.02em'}}>Factory Archive — Blueprint Manager</span>
      </div>
      <div style={{flex:1}}/>
      {/* demo: toggle first-run empty state */}
      <div style={{display:'flex',gap:3,padding:3,borderRadius:7,background:'var(--well)',border:'1px solid var(--border)'}}>
        {[['Library',false],['First-run',true]].map(([l,v])=>(
          <button key={l} onClick={()=>setFirstRun(v)} style={{height:22,padding:'0 9px',borderRadius:5,
            border:'none',fontFamily:'var(--font-mono)',fontSize:9.5,letterSpacing:'.04em',
            background: firstRun===v?'var(--raise)':'transparent',
            color: firstRun===v?'var(--accent)':'var(--text-mute)'}}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function App(){
  const [t,setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [scale,setScale] = uS(1);
  const [firstRun,setFirstRun] = uS(false);
  const [route,setRoute] = uS('library');       // library | detail
  const [nav,setNav] = uS('library');
  const [detailBp,setDetailBp] = uS(null);
  const [query,setQuery] = uS('');
  const [view,setView] = uS('grid');
  const [sortKey,setSortKey] = uS('recent');
  const [filterOpen,setFilterOpen] = uS(true);
  const [sourceFilter,setSourceFilter] = uS(null);
  const [filters,setFilters] = uS({tags:[],category:null,modded:false,paired:false,installed:false,version:null});
  const [sel,setSel] = uS(()=>new Set());
  const [importOpen,setImportOpen] = uS(false);
  const [exportOpen,setExportOpen] = uS(false);
  const [extra,setExtra] = uS([]); // imported blueprints

  uE(()=>{ document.documentElement.setAttribute('data-theme', t.theme); }, [t.theme]);

  uE(()=>{
    const fit=()=>{ const m=24; setScale(Math.min((innerWidth-m)/WIN_W,(innerHeight-m)/WIN_H,1)); };
    fit(); addEventListener('resize',fit); return ()=>removeEventListener('resize',fit);
  },[]);
  uE(()=>{ const k=e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();
    document.querySelector('input')?.focus();} if(e.key==='Escape'){setImportOpen(false);setExportOpen(false);} };
    addEventListener('keydown',k); return ()=>removeEventListener('keydown',k); },[]);

  const ALL = uM(()=>[...extra,...BP],[extra]);
  const filtered = uM(()=>{
    let r = ALL.filter(b=>{
      if(query){ const q=query.toLowerCase();
        if(!(b.name.toLowerCase().includes(q)||b.author.toLowerCase().includes(q)||
             b.tags.some(t=>t.toLowerCase().includes(q)))) return false; }
      if(sourceFilter && b.source!==sourceFilter) return false;
      if(filters.category && b.category!==filters.category) return false;
      if(filters.tags.length && !filters.tags.every(t=>b.tags.includes(t))) return false;
      if(filters.modded && !b.modded) return false;
      if(filters.paired && !b.files.sbpcfg) return false;
      if(filters.installed && b.status!=='installed') return false;
      if(filters.version && filters.version!=='Any' && b.gameVersion!==filters.version) return false;
      return true;
    });
    const sorters={ recent:(a,b)=>b.added.localeCompare(a.added), name:(a,b)=>a.name.localeCompare(b.name),
      downloads:(a,b)=>b.downloads-a.downloads, power:(a,b)=>(b.power.use+b.power.gen)-(a.power.use+a.power.gen) };
    return [...r].sort(sorters[sortKey]);
  },[ALL,query,sourceFilter,filters,sortKey]);

  const toggleSel=uC((id)=>setSel(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; }),[]);
  const clearSel=()=>setSel(new Set());
  const selItems = uM(()=>ALL.filter(b=>sel.has(b.id)),[ALL,sel]);
  const openDetail=(b)=>{ setDetailBp(b); setRoute('detail'); };
  const resetFilters=()=>{ setFilters({tags:[],category:null,modded:false,paired:false,installed:false,version:null});
    setQuery(''); setSourceFilter(null); };

  const LIST_COLS = '2.4fr 1fr 110px 150px 130px 44px';
  const showEmpty = firstRun && extra.length===0;

  return (
    <div style={{height:'100vh',width:'100vw',display:'flex',alignItems:'center',justifyContent:'center',
      background:'var(--stage)'}}>
      <div style={{width:WIN_W,height:WIN_H,transform:`scale(${scale})`,transformOrigin:'center center',
        borderRadius:13,overflow:'hidden',background:'var(--bg)',border:'1px solid var(--win-border)',
        boxShadow:'var(--win-shadow)',
        display:'flex',flexDirection:'column',position:'relative'}}>
        <TitleBar firstRun={firstRun} setFirstRun={setFirstRun}/>
        <div style={{flex:1,display:'flex',minHeight:0}}>
          <Sidebar route={nav} onNav={(id)=>{setNav(id);setRoute('library');setFirstRun(false);}}
            sourceFilter={sourceFilter} onSourceFilter={setSourceFilter}/>

          {route==='detail' && detailBp
            ? <div style={{flex:1,minWidth:0,background:'var(--bg)'}}>
                <BlueprintDetail bp={detailBp} onBack={()=>setRoute('library')}
                  onExport={(b)=>{ setSel(new Set([b.id])); setExportOpen(true); }}/>
              </div>
            : <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column'}}>
                {!showEmpty && <TopBar query={query} setQuery={setQuery} view={view} setView={setView}
                  filterOpen={filterOpen} setFilterOpen={setFilterOpen} onImport={()=>setImportOpen(true)}
                  sortKey={sortKey} setSortKey={setSortKey}/>}
                <div style={{flex:1,display:'flex',minHeight:0}}>
                  {!showEmpty && <FilterRail open={filterOpen} filters={filters} setFilters={setFilters}
                    counts={{shown:filtered.length,total:ALL.length}}/>}
                  <div className="grid-bg" style={{flex:1,overflowY:'auto',minWidth:0,
                    backgroundColor:'var(--bg)'}}>
                    {showEmpty
                      ? <EmptyState onImport={()=>setImportOpen(true)}/>
                      : filtered.length===0
                        ? <NoResults onReset={resetFilters}/>
                        : <LibraryBody bps={filtered} view={view} sel={sel} toggleSel={toggleSel}
                            openDetail={openDetail} cols={LIST_COLS} total={ALL.length}/>}
                  </div>
                </div>
              </div>}
        </div>

        {/* selection bar */}
        {sel.size>0 && route!=='detail' && <div style={{position:'absolute',bottom:18,left:'50%',
          transform:'translateX(-50%)',zIndex:30,display:'flex',alignItems:'center',gap:14,
          padding:'9px 9px 9px 16px',borderRadius:12,background:'var(--floatbar)',backdropFilter:'blur(10px)',
          border:'1px solid var(--border-strong)',boxShadow:'var(--shadow-lg)',animation:'fadein .2s'}}>
          <span style={{display:'flex',alignItems:'center',gap:9,fontSize:13,fontWeight:600}}>
            <span className="mono" style={{width:24,height:24,borderRadius:6,background:'var(--accent)',
              color:'#1a1206',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12}}>{sel.size}</span>
            selected</span>
          <span style={{width:1,height:22,background:'var(--border)'}}/>
          <button onClick={clearSel} style={{background:'none',border:'none',color:'var(--text-mute)',
            fontSize:12.5,fontFamily:'var(--font-display)'}}>Clear</button>
          <Btn variant="primary" icon={IcExport} onClick={()=>setExportOpen(true)}>Export {sel.size} to game folder</Btn>
        </div>}

        <ImportModal open={importOpen} onClose={()=>setImportOpen(false)}
          onAdd={(b)=>{ setExtra(x=>[{...b,id:'bp-new-'+Date.now(),category:'Manufacturing',gameVersion:b.version,
            status:'none',sizeKB:180,downloads:0,added:'2026-06-09',materials:['—'],
            notes:'Imported via deep link.',url:''},...x]); setFirstRun(false); }}/>
        <ExportDrawer open={exportOpen} items={selItems} onClose={()=>{setExportOpen(false);}}
          onRemove={(id)=>toggleSel(id)}/>

        <TweaksPanel>
          <TweakSection label="Appearance"/>
          <TweakRadio label="Theme" value={t.theme} options={['dark','light']}
            onChange={(v)=>setTweak('theme', v)}/>
        </TweaksPanel>
      </div>
    </div>
  );
}

function LibraryBody({ bps, view, sel, toggleSel, openDetail, cols, total }){
  return (
    <div style={{padding: view==='grid'?'18px 20px 90px':'0 0 90px'}}>
      {/* result header */}
      {view==='grid' && <div style={{display:'flex',alignItems:'baseline',gap:10,marginBottom:16,padding:'0 2px'}}>
        <h2 style={{margin:0,fontSize:18,fontWeight:700,letterSpacing:'-.01em'}}>Library</h2>
        <span className="mono" style={{fontSize:11.5,color:'var(--text-mute)'}}>{bps.length} of {total} blueprints</span>
      </div>}
      {view==='grid'
        ? <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(258px,1fr))',gap:15}}>
            {bps.map(b=><BlueprintCard key={b.id} bp={b} selected={sel.has(b.id)}
              onSelect={()=>toggleSel(b.id)} onOpen={()=>openDetail(b)}/>)}
          </div>
        : <div>
            <div style={{display:'grid',gridTemplateColumns:cols,gap:14,padding:'13px 14px',
              borderBottom:'1px solid var(--border)',position:'sticky',top:0,background:'var(--bg)',zIndex:2}}>
              {['Blueprint','Tags','Source','Files','Status',''].map((h,i)=>
                <span key={i} className="tlabel" style={{fontSize:9}}>{h}</span>)}
            </div>
            {bps.map(b=><BlueprintRow key={b.id} bp={b} selected={sel.has(b.id)}
              onSelect={()=>toggleSel(b.id)} onOpen={()=>openDetail(b)} cols={cols}/>)}
          </div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
