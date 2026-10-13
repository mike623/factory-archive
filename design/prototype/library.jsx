// library.jsx — sidebar, top bar, filter rail, blueprint grid/list
const { useMemo: useMemoL } = React;

/* ============ SIDEBAR ============ */
function Sidebar({ route, onNav, sourceFilter, onSourceFilter }){
  const ICONS = { IcLibrary, IcInbox, IcClock, IcStar };
  return (
    <aside style={{width:210,flexShrink:0,background:'var(--bg-deep)',
      borderRight:'1px solid var(--border)', display:'flex', flexDirection:'column'}}>
      {/* brand */}
      <div style={{padding:'16px 16px 14px', borderBottom:'1px solid var(--border-soft)'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:30,height:30,borderRadius:7,position:'relative',flexShrink:0,
            background:'linear-gradient(150deg,var(--accent-bright),var(--accent-deep))',
            display:'flex',alignItems:'center',justifyContent:'center',
            boxShadow:'0 4px 14px -4px var(--accent-glow)'}}>
            <IcCube size={17} sw={1.8} style={{color:'#1a1206'}}/>
          </div>
          <div style={{lineHeight:1.15}}>
            <div style={{fontWeight:700,fontSize:13.5,letterSpacing:'-.01em'}}>Factory Archive</div>
            <div className="tlabel" style={{fontSize:8.5,marginTop:2}}>Blueprint Manager</div>
          </div>
        </div>
      </div>

      <div style={{flex:1,overflowY:'auto',padding:'12px 10px'}}>
        <div className="tlabel" style={{padding:'4px 8px 8px'}}>Workspace</div>
        <nav style={{display:'flex',flexDirection:'column',gap:2}}>
          {NAV.map(n=>{
            const Icon = ICONS[n.icon]; const on = route===n.id;
            return (
              <button key={n.id} onClick={()=>onNav(n.id)} style={{display:'flex',alignItems:'center',
                gap:10,height:34,padding:'0 9px',borderRadius:'var(--r)',width:'100%',textAlign:'left',
                background: on?'var(--accent-ghost)':'transparent',
                border:`1px solid ${on?'var(--accent-line)':'transparent'}`,
                color: on?'var(--accent-bright)':'var(--text-dim)', position:'relative',
                fontFamily:'var(--font-display)', fontSize:13, fontWeight: on?600:500,
                transition:'all .14s var(--ease)'}}>
                {on && <span style={{position:'absolute',left:-10,top:7,bottom:7,width:3,borderRadius:3,
                  background:'var(--accent)',boxShadow:'0 0 8px var(--accent-glow)'}}/>}
                <Icon size={16}/><span style={{flex:1}}>{n.label}</span>
                {n.count!=null && <span className="mono" style={{fontSize:10.5,opacity:.7,
                  padding:'1px 6px',borderRadius:99,background:'var(--well)',border:'1px solid var(--border)'}}>{n.count}</span>}
              </button>
            );
          })}
        </nav>

        <div className="tlabel" style={{padding:'18px 8px 8px'}}>Sources</div>
        <div style={{display:'flex',flexDirection:'column',gap:2}}>
          {Object.values(SOURCES).map(s=>{
            const on = sourceFilter===s.id;
            return (
              <button key={s.id} onClick={()=>onSourceFilter(on?null:s.id)}
                style={{display:'flex',alignItems:'center',gap:10,height:32,padding:'0 9px',
                borderRadius:'var(--r)',width:'100%',textAlign:'left',
                background: on?'var(--well)':'transparent', border:`1px solid ${on?'var(--border)':'transparent'}`,
                color: on?'var(--text)':'var(--text-dim)', fontSize:12.5, fontWeight:500,
                transition:'all .14s var(--ease)'}}>
                <SourceMark src={s.id} size={15}/>
                <span style={{flex:1}}>{s.label}</span>
                {on && <IcCheck size={13} style={{color:s.color}}/>}
              </button>
            );
          })}
        </div>
      </div>

      {/* sync footer */}
      <div style={{padding:'12px',borderTop:'1px solid var(--border-soft)'}}>
        <div style={{padding:'10px 11px',borderRadius:'var(--r)',background:'var(--panel)',
          border:'1px solid var(--border)'}}>
          <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:7}}>
            <span style={{width:7,height:7,borderRadius:'50%',background:'var(--ok)',boxShadow:'0 0 7px var(--ok)'}}/>
            <span className="tlabel" style={{fontSize:9,color:'var(--text-dim)'}}>Game folder linked</span>
          </div>
          <div className="mono" style={{fontSize:9.5,color:'var(--text-mute)',whiteSpace:'nowrap',
            overflow:'hidden',textOverflow:'ellipsis'}}>…/FactoryGame/Blueprints</div>
        </div>
      </div>
    </aside>
  );
}

/* ============ FILTER RAIL ============ */
function FilterRail({ open, filters, setFilters, counts }){
  if(!open) return null;
  const toggleTag = (t)=> setFilters(f=>({...f, tags: f.tags.includes(t)? f.tags.filter(x=>x!==t): [...f.tags,t]}));
  const setCat = (c)=> setFilters(f=>({...f, category: f.category===c?null:c}));
  const Section = ({label, children, action}) => (
    <div style={{padding:'14px 14px',borderBottom:'1px solid var(--border-soft)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:11}}>
        <span className="tlabel">{label}</span>{action}
      </div>
      {children}
    </div>
  );
  return (
    <aside style={{width:236,flexShrink:0,background:'var(--bg)',borderRight:'1px solid var(--border)',
      display:'flex',flexDirection:'column',overflowY:'auto'}}>
      <div style={{padding:'14px 14px 12px',display:'flex',alignItems:'center',gap:8,
        borderBottom:'1px solid var(--border-soft)'}}>
        <IcFilter size={15} style={{color:'var(--accent)'}}/>
        <span style={{fontWeight:600,fontSize:13}}>Filters</span>
        <span className="mono" style={{marginLeft:'auto',fontSize:10,color:'var(--text-mute)'}}>
          {counts.shown}/{counts.total}</span>
      </div>

      <Section label="Category">
        <div style={{display:'flex',flexDirection:'column',gap:3}}>
          {CATEGORIES.map(c=>{
            const on = filters.category===c;
            return (
              <button key={c} onClick={()=>setCat(c)} style={{display:'flex',alignItems:'center',
                justifyContent:'space-between',height:30,padding:'0 10px',borderRadius:'var(--r-sm)',
                background: on?'var(--accent-ghost)':'transparent',
                border:`1px solid ${on?'var(--accent-line)':'transparent'}`,
                color: on?'var(--accent-bright)':'var(--text-dim)',fontSize:12.5,fontWeight:500,
                transition:'all .14s'}}>
                <span>{c}</span>{on&&<IcCheck size={13}/>}
              </button>
            );
          })}
        </div>
      </Section>

      <Section label="Tags">
        <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
          {ALL_TAGS.map(t=> <Tag key={t} active={filters.tags.includes(t)} onClick={()=>toggleTag(t)}>{t}</Tag>)}
        </div>
      </Section>

      <Section label="Compatibility">
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          <ToggleRow label="Modded only" icon={IcWrench} on={filters.modded}
            onClick={()=>setFilters(f=>({...f,modded:!f.modded}))}/>
          <ToggleRow label="Has .sbpcfg pair" icon={IcFile} on={filters.paired}
            onClick={()=>setFilters(f=>({...f,paired:!f.paired}))}/>
          <ToggleRow label="Installed in game" icon={IcCheck} on={filters.installed}
            onClick={()=>setFilters(f=>({...f,installed:!f.installed}))}/>
        </div>
      </Section>

      <Section label="Game version">
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {['1.0','0.8','Any'].map(v=>(
            <button key={v} onClick={()=>setFilters(f=>({...f,version: f.version===v?null:v}))}
              style={{height:30,padding:'0 12px',borderRadius:'var(--r-sm)',fontFamily:'var(--font-mono)',
              fontSize:11.5,fontWeight:600,
              background: filters.version===v?'var(--accent-ghost)':'var(--well)',
              border:`1px solid ${filters.version===v?'var(--accent-line)':'var(--border)'}`,
              color: filters.version===v?'var(--accent-bright)':'var(--text-dim)'}}>{v}</button>
          ))}
        </div>
      </Section>

      <div style={{padding:'14px',marginTop:'auto'}}>
        <Btn variant="ghost" size="sm" full icon={IcRefresh}
          onClick={()=>setFilters({tags:[],category:null,modded:false,paired:false,installed:false,version:null})}>
          Reset filters
        </Btn>
      </div>
    </aside>
  );
}

function ToggleRow({ label, icon:Icon, on, onClick }){
  return (
    <button onClick={onClick} style={{display:'flex',alignItems:'center',gap:9,width:'100%',
      height:30,padding:'0 4px',background:'transparent',border:'none',
      color: on?'var(--text)':'var(--text-dim)',fontSize:12.5,fontWeight:500}}>
      <span style={{width:32,height:18,borderRadius:99,flexShrink:0,position:'relative',
        background: on?'var(--accent)':'var(--track-off)',transition:'background .15s'}}>
        <span style={{position:'absolute',top:2,left: on?16:2,width:14,height:14,borderRadius:'50%',
          background:'var(--knob)',boxShadow:'0 1px 2px rgba(0,0,0,.25)',transition:'left .15s var(--ease)'}}/>
      </span>
      <Icon size={14} style={{color: on?'var(--accent)':'var(--text-mute)'}}/>
      <span>{label}</span>
    </button>
  );
}

Object.assign(window, { Sidebar, FilterRail, ToggleRow });
