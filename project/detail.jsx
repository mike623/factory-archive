// detail.jsx — blueprint detail screen
const { useState: useStateD } = React;

function Slot({ id, hue, seed, label, placeholder, style }){
  // image-slot with an iso-art SVG fallback so empty state shows placeholder art on dark
  return React.createElement('image-slot', {
    id, src: thumbURI(hue, seed, label, 800, 500),
    placeholder: placeholder || 'Drop screenshot',
    shape: 'rounded', radius: '8', fit: 'cover',
    style: { ...style, ['--x']:0 },
  });
}

function DetailHeader({ bp, onBack, fav, setFav, onExport }){
  return (
    <div style={{display:'flex',alignItems:'center',gap:14,height:60,flexShrink:0,padding:'0 18px',
      borderBottom:'1px solid var(--border)',background:'var(--bg)'}}>
      <button onClick={onBack} style={{display:'flex',alignItems:'center',gap:8,height:34,padding:'0 12px 0 9px',
        borderRadius:'var(--r)',background:'var(--well)',border:'1px solid var(--border)',color:'var(--text-dim)',
        fontSize:12.5,fontWeight:500,fontFamily:'var(--font-display)'}}>
        <IcArrowLeft size={16}/>Library</button>
      <div className="mono" style={{fontSize:11,color:'var(--text-mute)',display:'flex',alignItems:'center',gap:8,whiteSpace:'nowrap'}}>
        <span>{bp.category}</span><IcChevron size={12}/><span style={{color:'var(--text-dim)'}}>{bp.id.toUpperCase()}</span>
      </div>
      <div style={{flex:1}}/>
      <IconBtn icon={IcStar} active={fav} title="Favorite" onClick={()=>setFav(f=>!f)}/>
      <Btn variant="ghost" icon={IcCopy}>Copy link</Btn>
      <Btn variant="primary" icon={IcDownload} onClick={onExport}>Export to game folder</Btn>
    </div>
  );
}

function BlueprintDetail({ bp, onBack, onExport }){
  const [active,setActive] = useStateD(0);
  const [fav,setFav] = useStateD(bp.status==='installed');
  const s = STATUS[bp.status];
  const src = SOURCES[bp.source];
  const shots = Math.min(bp.shots, 6);

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0}}>
      <DetailHeader bp={bp} onBack={onBack} fav={fav} setFav={setFav} onExport={()=>onExport(bp)}/>
      <div style={{flex:1,overflowY:'auto',minHeight:0}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 350px',gap:0,alignItems:'start'}}>
          {/* ---- MAIN ---- */}
          <div style={{padding:'22px 24px',minWidth:0}}>
            {/* title block */}
            <div style={{display:'flex',alignItems:'flex-start',gap:14,marginBottom:18}}>
              <div style={{minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                  <SourceBadge src={bp.source} full/>
                  {bp.modded && <span className="mono" style={{fontSize:10,fontWeight:600,padding:'3px 8px',
                    borderRadius:5,background:'rgba(176,124,240,.14)',border:'1px solid rgba(176,124,240,.35)',
                    color:'#c79cf5'}}>MODDED</span>}
                  <span className="mono" style={{fontSize:10.5,color:'var(--text-mute)'}}>v{bp.gameVersion}</span>
                </div>
                <h1 style={{margin:0,fontSize:27,fontWeight:700,letterSpacing:'-.02em',lineHeight:1.1,
                  textWrap:'balance'}}>{bp.name}</h1>
                <div style={{display:'flex',alignItems:'center',gap:14,marginTop:10,color:'var(--text-dim)',flexWrap:'wrap'}}>
                  <span style={{display:'flex',alignItems:'center',gap:6,whiteSpace:'nowrap'}}><IcUser size={14}/>
                    <span className="mono" style={{fontSize:12}}>{bp.author}</span></span>
                  <span style={{display:'flex',alignItems:'center',gap:6,whiteSpace:'nowrap'}}><IcCalendar size={14}/>
                    <span className="mono" style={{fontSize:12}}>{bp.added}</span></span>
                  <span style={{display:'flex',alignItems:'center',gap:6,whiteSpace:'nowrap'}}><IcDownload size={14}/>
                    <span className="mono" style={{fontSize:12}}>{bp.downloads.toLocaleString()}</span></span>
                </div>
              </div>
            </div>

            {/* gallery */}
            <div style={{borderRadius:'var(--r-md)',overflow:'hidden',border:'1px solid var(--border)',
              background:'var(--panel)',position:'relative'}}>
              <div style={{position:'relative',width:'100%',height:380}}>
                <div style={{position:'absolute',inset:0}}>
                  <Thumb hue={bp.hue} seed={bp.seed+active} label={`CAMERA ${String(active+1).padStart(2,'0')}`}/>
                </div>
                <Slot key={`${bp.id}-${active}`} id={`${bp.id}-s${active}`} hue={bp.hue} seed={bp.seed+active}
                  label={`CAMERA ${String(active+1).padStart(2,'0')}`}
                  placeholder={`Drop screenshot ${active+1} — .png / .jpg`}
                  style={{position:'absolute',inset:0,width:'100%',height:'100%',display:'block'}}/>
              </div>
              <div style={{position:'absolute',top:11,left:11,display:'flex',gap:7,pointerEvents:'none',zIndex:2}}>
                <span className="mono" style={{fontSize:10,padding:'4px 9px',borderRadius:5,
                  background:'rgba(8,9,11,.7)',backdropFilter:'blur(6px)',border:'1px solid var(--border)',
                  color:'var(--text-dim)'}}>{active+1} / {shots}</span>
              </div>
              <div style={{position:'absolute',top:11,right:11,display:'flex',gap:6,pointerEvents:'none',zIndex:2}}>
                <span className="mono" style={{fontSize:9,padding:'4px 8px',borderRadius:5,
                  background:'rgba(8,9,11,.7)',backdropFilter:'blur(6px)',border:'1px solid var(--accent-line)',
                  color:'var(--accent)',display:'flex',alignItems:'center',gap:5}}>
                  <IcUpload size={11}/>DROP TO REPLACE</span>
              </div>
            </div>
            {/* strip */}
            <div style={{display:'flex',gap:9,marginTop:11}}>
              {Array.from({length:shots}).map((_,i)=>(
                <button key={i} onClick={()=>setActive(i)} style={{width:92,height:60,borderRadius:7,
                  overflow:'hidden',flexShrink:0,padding:0,cursor:'pointer',position:'relative',
                  border:`${i===active?2:1}px solid ${i===active?'var(--accent)':'var(--border)'}`,
                  boxShadow: i===active?'0 0 0 1px var(--accent-line),0 6px 16px -8px var(--accent-glow)':'none',
                  transition:'all .14s'}}>
                  <Thumb hue={bp.hue} seed={bp.seed+i} label=""/>
                  <span className="mono" style={{position:'absolute',bottom:3,left:5,fontSize:8,
                    color:'rgba(255,255,255,.5)'}}>{String(i+1).padStart(2,'0')}</span>
                </button>
              ))}
            </div>

            {/* notes */}
            <Block title="Notes" icon={IcInfo}>
              <p style={{margin:0,fontSize:14,lineHeight:1.65,color:'var(--text-dim)',textWrap:'pretty',maxWidth:640}}>
                {bp.notes}</p>
            </Block>

            {/* materials */}
            <Block title="Primary outputs & materials" icon={IcMaterial}>
              <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                {bp.materials.map(m=>(
                  <span key={m} style={{display:'inline-flex',alignItems:'center',gap:8,height:34,padding:'0 13px 0 10px',
                    borderRadius:'var(--r)',background:'var(--panel-2)',border:'1px solid var(--border)'}}>
                    <span style={{width:9,height:9,borderRadius:2,background:`hsl(${bp.hue} 60% 55%)`,
                      boxShadow:`0 0 6px hsl(${bp.hue} 60% 55% / .6)`}}/>
                    <span style={{fontSize:13,fontWeight:500}}>{m}</span></span>
                ))}
              </div>
            </Block>

            {/* tags */}
            <Block title="Tags" icon={IcTag}>
              <div style={{display:'flex',flexWrap:'wrap',gap:7}}>
                {bp.tags.map(t=> <Tag key={t}>{t}</Tag>)}
              </div>
            </Block>
          </div>

          {/* ---- RIGHT RAIL ---- */}
          <div style={{borderLeft:'1px solid var(--border)',padding:'22px 20px',
            display:'flex',flexDirection:'column',gap:18,position:'sticky',top:0}}>
            {/* sync status card */}
            <div style={{borderRadius:'var(--r-md)',border:`1px solid color-mix(in oklab,${s.color} 30%,var(--border))`,
              background:s.ghost,padding:'15px 15px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                <span className="tlabel" style={{color:'var(--text-dim)'}}>Game folder status</span>
                <StatusPill status={bp.status} small/>
              </div>
              {bp.status==='config' && <div style={{display:'flex',gap:8,marginBottom:12,fontSize:12,
                color:'var(--warn)',lineHeight:1.5}}><IcWarn size={15} style={{flexShrink:0,marginTop:1}}/>
                <span>Missing <span className="mono">.sbpcfg</span> — blueprint will import without its config pairing.</span></div>}
              {bp.status==='update' && <div style={{display:'flex',gap:8,marginBottom:12,fontSize:12,
                color:'var(--info)',lineHeight:1.5}}><IcRefresh size={15} style={{flexShrink:0,marginTop:1}}/>
                <span>A newer revision is available from {src.label}.</span></div>}
              <Btn variant="primary" full icon={IcDownload} onClick={()=>onExport(bp)}>
                {bp.status==='installed'?'Re-export to folder':bp.status==='update'?'Update in folder':'Export to game folder'}</Btn>
            </div>

            {/* metadata grid */}
            <div>
              <div className="tlabel" style={{marginBottom:11}}>Specifications</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9}}>
                <MetaStat icon={IcDimensions} label="Footprint" value={`${bp.dims.x}×${bp.dims.y}`}/>
                <MetaStat icon={IcLayers} label="Height" value={`${bp.dims.z}m`}/>
                <MetaStat icon={IcMachine} label="Machines" value={bp.machines}/>
                <MetaStat icon={IcPower} label={bp.power.gen?'Output':'Draw'}
                  value={`${(bp.power.gen||bp.power.use)} MW`} accent={!bp.power.gen}/>
              </div>
            </div>

            {/* files */}
            <div>
              <div className="tlabel" style={{marginBottom:11}}>Files</div>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                <FileRow ext="sbp" ok={bp.files.sbp} size={bp.sizeKB} desc="Blueprint geometry"/>
                <FileRow ext="sbpcfg" ok={bp.files.sbpcfg} size={Math.round(bp.sizeKB*0.06)} desc="Config & metadata"/>
              </div>
            </div>

            {/* source */}
            <div>
              <div className="tlabel" style={{marginBottom:11}}>Source</div>
              <div style={{borderRadius:'var(--r)',border:'1px solid var(--border)',background:'var(--panel-2)',
                padding:'12px 13px'}}>
                <div style={{display:'flex',alignItems:'center',gap:9,marginBottom: bp.url?10:0}}>
                  <SourceMark src={bp.source} size={18}/>
                  <div><div style={{fontSize:13,fontWeight:600}}>{src.label}</div>
                    <div className="mono" style={{fontSize:10,color:'var(--text-mute)'}}>{src.host}</div></div>
                </div>
                {bp.url && <a href="#" onClick={e=>e.preventDefault()} style={{display:'flex',alignItems:'center',gap:7,
                  fontSize:11,color:'var(--steel)',textDecoration:'none',padding:'8px 10px',borderRadius:6,
                  background:'var(--well)',border:'1px solid var(--border)'}}>
                  <IcLink size={13}/><span className="mono" style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',
                    whiteSpace:'nowrap'}}>{bp.url.replace(/^https?:\/\//,'')}</span><IcExternal size={13}/></a>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Block({ title, icon:Icon, children }){
  return (
    <div style={{marginTop:24}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:13}}>
        <Icon size={15} style={{color:'var(--accent)'}}/>
        <span style={{fontSize:13.5,fontWeight:600}}>{title}</span>
        <div style={{flex:1,height:1,background:'var(--border-soft)'}}/>
      </div>
      {children}
    </div>
  );
}

function FileRow({ ext, ok, size, desc }){
  return (
    <div style={{display:'flex',alignItems:'center',gap:11,padding:'11px 12px',borderRadius:'var(--r)',
      background:'var(--panel-2)',border:`1px solid ${ok?'var(--border)':'var(--border-soft)'}`,opacity: ok?1:.6}}>
      <div style={{width:34,height:34,borderRadius:7,flexShrink:0,display:'flex',alignItems:'center',
        justifyContent:'center',background: ok?'var(--accent-ghost)':'var(--well)',
        border:`1px solid ${ok?'var(--accent-line)':'var(--border)'}`,color: ok?'var(--accent)':'var(--text-faint)'}}>
        <IcFile size={16}/></div>
      <div style={{flex:1,minWidth:0}}>
        <div className="mono" style={{fontSize:12.5,fontWeight:600,color: ok?'var(--text)':'var(--text-mute)'}}>
          blueprint.{ext}</div>
        <div style={{fontSize:11,color:'var(--text-mute)'}}>{desc}</div>
      </div>
      {ok
        ? <span className="mono" style={{fontSize:10.5,color:'var(--text-dim)'}}>{size} KB</span>
        : <span className="mono" style={{fontSize:10,color:'var(--warn)'}}>MISSING</span>}
    </div>
  );
}

Object.assign(window, { BlueprintDetail });
