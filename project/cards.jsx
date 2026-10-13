// cards.jsx — top bar, blueprint card/row, library view body
const { useState: useStateC } = React;

/* ============ TOP BAR ============ */
function TopBar({ query, setQuery, view, setView, filterOpen, setFilterOpen, onImport, sortKey, setSortKey }){
  return (
    <div style={{height:60,flexShrink:0,display:'flex',alignItems:'center',gap:12,
      padding:'0 18px',borderBottom:'1px solid var(--border)',background:'var(--bg)'}}>
      <IconBtn icon={IcFilter} active={filterOpen} title="Toggle filters" onClick={()=>setFilterOpen(o=>!o)}/>
      {/* search */}
      <div style={{flex:1,maxWidth:560,position:'relative',display:'flex',alignItems:'center'}}>
        <IcSearch size={16} style={{position:'absolute',left:13,color:'var(--text-mute)'}}/>
        <input value={query} onChange={e=>setQuery(e.target.value)}
          placeholder="Search blueprints, authors, tags…"
          style={{width:'100%',height:38,paddingLeft:38,paddingRight:query?34:80,borderRadius:'var(--r)',
          background:'var(--panel)',border:'1px solid var(--border)',color:'var(--text)',
          fontSize:13,outline:'none',fontFamily:'var(--font-display)'}}
          onFocus={e=>e.target.style.borderColor='var(--accent-line)'}
          onBlur={e=>e.target.style.borderColor='var(--border)'}/>
        {query
          ? <button onClick={()=>setQuery('')} style={{position:'absolute',right:10,color:'var(--text-mute)',
              background:'none',border:'none',display:'flex'}}><IcClose size={15}/></button>
          : <kbd className="mono" style={{position:'absolute',right:10,fontSize:10,color:'var(--text-faint)',
              padding:'2px 6px',border:'1px solid var(--border)',borderRadius:4}}>⌘K</kbd>}
      </div>

      <div style={{flex:1}}/>

      {/* sort */}
      <div style={{display:'flex',alignItems:'center',gap:7,color:'var(--text-mute)'}}>
        <span className="tlabel" style={{fontSize:9}}>Sort</span>
        <select value={sortKey} onChange={e=>setSortKey(e.target.value)}
          style={{height:34,padding:'0 8px',borderRadius:'var(--r)',background:'var(--panel)',
          border:'1px solid var(--border)',color:'var(--text-dim)',fontFamily:'var(--font-mono)',
          fontSize:11,outline:'none'}}>
          <option value="recent">Recently added</option>
          <option value="name">Name A–Z</option>
          <option value="downloads">Most downloaded</option>
          <option value="power">Power draw</option>
        </select>
      </div>

      {/* view toggle */}
      <div style={{display:'flex',gap:3,padding:3,borderRadius:'var(--r)',background:'var(--panel)',
        border:'1px solid var(--border)'}}>
        {[['grid',IcGrid],['list',IcList]].map(([v,Ic])=>(
          <button key={v} onClick={()=>setView(v)} style={{width:30,height:28,borderRadius:5,
            display:'flex',alignItems:'center',justifyContent:'center',border:'none',
            background: view===v?'var(--raise)':'transparent',
            color: view===v?'var(--accent)':'var(--text-mute)',transition:'all .14s'}}>
            <Ic size={16}/></button>
        ))}
      </div>

      <Btn variant="primary" icon={IcPlus} onClick={onImport}>Import</Btn>
    </div>
  );
}

/* ============ GRID CARD ============ */
function BlueprintCard({ bp, selected, onSelect, onOpen }){
  const [hover,setHover] = useStateC(false);
  return (
    <div onClick={onOpen} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{borderRadius:'var(--r-md)',overflow:'hidden',cursor:'pointer',position:'relative',
      background:'var(--panel)', border:`1px solid ${selected?'var(--accent-line)':hover?'var(--border-strong)':'var(--border)'}`,
      boxShadow: hover?'0 14px 30px -14px rgba(0,0,0,.7)':'none',
      transform: hover?'translateY(-2px)':'none', transition:'all .18s var(--ease)'}}>
      {/* thumb */}
      <div style={{position:'relative',height:158,borderBottom:'1px solid var(--border-soft)'}}>
        <Thumb hue={bp.hue} seed={bp.seed} label={`${bp.dims.x}×${bp.dims.y}×${bp.dims.z} · ${bp.shots} SHOTS`}/>
        {/* top overlay */}
        <div style={{position:'absolute',top:9,left:9,right:9,display:'flex',justifyContent:'space-between',
          alignItems:'flex-start',pointerEvents:'none'}}>
          <div style={{pointerEvents:'auto',opacity: hover||selected?1:0,transition:'opacity .15s'}}>
            <Check checked={selected} onChange={onSelect}/>
          </div>
          <SourceBadge src={bp.source}/>
        </div>
        <div style={{position:'absolute',bottom:9,left:9}}><StatusPill status={bp.status} small/></div>
        {bp.modded && <div style={{position:'absolute',bottom:9,right:9}}>
          <span className="mono" style={{fontSize:9,fontWeight:600,padding:'2px 6px',borderRadius:4,
            background:'rgba(176,124,240,.16)',border:'1px solid rgba(176,124,240,.35)',color:'#c79cf5'}}>MODDED</span></div>}
      </div>
      {/* body */}
      <div style={{padding:'12px 13px 13px'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'flex-start'}}>
          <h3 style={{margin:0,fontSize:14.5,fontWeight:600,letterSpacing:'-.01em',lineHeight:1.25,
            textWrap:'pretty'}}>{bp.name}</h3>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,marginTop:6,color:'var(--text-mute)'}}>
          <IcUser size={12}/><span className="mono" style={{fontSize:11}}>{bp.author}</span>
          <span style={{opacity:.4}}>·</span>
          <span className="mono" style={{fontSize:11}}>v{bp.gameVersion}</span>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',gap:5,marginTop:11}}>
          {bp.tags.slice(0,3).map(t=>(
            <span key={t} className="mono" style={{fontSize:10,padding:'2px 7px',borderRadius:4,
              background:'var(--well)',border:'1px solid var(--border)',color:'var(--text-dim)'}}>{t}</span>
          ))}
          {bp.tags.length>3 && <span className="mono" style={{fontSize:10,padding:'2px 6px',
            color:'var(--text-mute)'}}>+{bp.tags.length-3}</span>}
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:12,
          paddingTop:11,borderTop:'1px solid var(--border-soft)'}}>
          <FilePair files={bp.files} compact/>
          <div style={{display:'flex',alignItems:'center',gap:11,color:'var(--text-mute)'}}>
            <span style={{display:'flex',alignItems:'center',gap:4}} title="Machines">
              <IcMachine size={13}/><span className="mono" style={{fontSize:11}}>{bp.machines}</span></span>
            <span style={{display:'flex',alignItems:'center',gap:4}} title={bp.power.gen?'Power generated':'Power draw'}>
              <IcPower size={13} style={{color: bp.power.gen?'var(--ok)':'var(--accent)'}}/>
              <span className="mono" style={{fontSize:11}}>{bp.power.gen||bp.power.use}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ LIST ROW ============ */
function BlueprintRow({ bp, selected, onSelect, onOpen, cols }){
  const [hover,setHover] = useStateC(false);
  return (
    <div onClick={onOpen} onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{display:'grid',gridTemplateColumns:cols,alignItems:'center',gap:14,height:62,
      padding:'0 14px',cursor:'pointer',borderBottom:'1px solid var(--border-soft)',
      background: selected?'var(--accent-ghost)':hover?'var(--panel)':'transparent',transition:'background .12s'}}>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <div style={{opacity: hover||selected?1:.25,transition:'opacity .15s'}}>
          <Check checked={selected} onChange={onSelect}/></div>
        <div style={{width:64,height:42,borderRadius:6,overflow:'hidden',flexShrink:0,
          border:'1px solid var(--border)'}}><Thumb hue={bp.hue} seed={bp.seed} label=""/></div>
        <div style={{minWidth:0}}>
          <div style={{fontWeight:600,fontSize:13.5,whiteSpace:'nowrap',overflow:'hidden',
            textOverflow:'ellipsis'}}>{bp.name}</div>
          <div className="mono" style={{fontSize:10.5,color:'var(--text-mute)',marginTop:2}}>
            {bp.author} · v{bp.gameVersion} · {bp.dims.x}×{bp.dims.y}×{bp.dims.z}</div>
        </div>
      </div>
      <div style={{display:'flex',gap:5,flexWrap:'wrap',overflow:'hidden',maxHeight:24}}>
        {bp.tags.slice(0,2).map(t=> <span key={t} className="mono" style={{fontSize:10,padding:'2px 6px',
          borderRadius:4,background:'var(--well)',border:'1px solid var(--border)',color:'var(--text-dim)',
          whiteSpace:'nowrap'}}>{t}</span>)}
      </div>
      <SourceBadge src={bp.source}/>
      <FilePair files={bp.files} compact/>
      <StatusPill status={bp.status} small/>
      <div style={{display:'flex',justifyContent:'flex-end',color:'var(--text-mute)'}}>
        <IconBtn icon={IcChevron} size={15}/>
      </div>
    </div>
  );
}

Object.assign(window, { TopBar, BlueprintCard, BlueprintRow });
