// modals.jsx — import-from-URL modal + batch export drawer
const { useState: useStateM, useEffect: useEffectM, useRef: useRefM } = React;

function detectSource(url){
  const u = url.toLowerCase();
  if(u.includes('satisfactory-calculator.com')) return 'scim';
  if(u.includes('satisfactoryblueprints.com')) return 'sbp';
  if(u.includes('.sbp')||u.includes('.sbpcfg')||u.startsWith('http')) return 'url';
  return null;
}

const EXAMPLES = [
  { src:'scim', url:'https://satisfactory-calculator.com/en/blueprints/index/details/id/12162/name/Modular+Manufacturer+L' },
  { src:'sbp',  url:'https://satisfactoryblueprints.com/blueprint/c4ae7a98-699a-4aab-af31-61f99cfd71f0' },
];

function ImportModal({ open, onClose, onAdd }){
  const [url,setUrl] = useStateM('');
  const [phase,setPhase] = useStateM('idle'); // idle|resolving|resolved|done
  const [step,setStep] = useStateM(0);
  const inputRef = useRefM(null);

  useEffectM(()=>{ if(open){ setUrl(''); setPhase('idle'); setStep(0);
    setTimeout(()=>inputRef.current&&inputRef.current.focus(),60); } },[open]);

  const src = detectSource(url);
  const resolved = {
    name:'Modular Manufacturer L', author:'KapitanWalnut', source: src||'url',
    dims:{x:32,y:24,z:18}, machines:42, power:480, version:'1.0', modded:false,
    tags:['Production','Modular','World Grid'], files:{sbp:true,sbpcfg: src!=='url'}, hue:38, seed:7, shots:5,
  };

  const STEPS = ['Connecting to source','Reading blueprint metadata','Locating .sbp / .sbpcfg pair','Rendering preview'];
  const resolve = ()=>{
    if(!src) return;
    setPhase('resolving'); setStep(0);
    let i=0; const t=setInterval(()=>{ i++; setStep(i); if(i>=STEPS.length){ clearInterval(t); setPhase('resolved'); } },480);
  };
  const add = ()=>{ setPhase('done'); setTimeout(()=>{ onAdd&&onAdd(resolved); onClose(); },900); };

  if(!open) return null;
  return (
    <div onClick={onClose} style={{position:'absolute',inset:0,zIndex:50,display:'flex',alignItems:'center',
      justifyContent:'center',background:'rgba(5,6,8,.78)'}}>
      <div onClick={e=>e.stopPropagation()} style={{width:560,maxHeight:'88%',overflow:'auto',
        borderRadius:'var(--r-lg)',background:'var(--panel)',border:'1px solid var(--border-strong)',
        boxShadow:'var(--shadow-lg)'}}>
        {/* header */}
        <div style={{display:'flex',alignItems:'center',gap:12,padding:'17px 19px',
          borderBottom:'1px solid var(--border)'}}>
          <div style={{width:34,height:34,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',
            background:'var(--accent-ghost)',border:'1px solid var(--accent-line)',color:'var(--accent)'}}>
            <IcLink size={17}/></div>
          <div style={{flex:1}}>
            <div style={{fontSize:15.5,fontWeight:700,letterSpacing:'-.01em'}}>Import blueprint</div>
            <div className="tlabel" style={{fontSize:9,marginTop:2}}>Paste a deep link or direct file URL</div>
          </div>
          <IconBtn icon={IcClose} onClick={onClose}/>
        </div>

        <div style={{padding:'19px'}}>
          {/* URL input */}
          <div style={{position:'relative',display:'flex',alignItems:'center'}}>
            {src ? <div style={{position:'absolute',left:11}}><SourceMark src={src} size={17}/></div>
                 : <IcLink size={16} style={{position:'absolute',left:12,color:'var(--text-mute)'}}/>}
            <input ref={inputRef} value={url} onChange={e=>{setUrl(e.target.value); setPhase('idle');}}
              onKeyDown={e=>e.key==='Enter'&&resolve()} placeholder="https://satisfactory-calculator.com/…"
              disabled={phase==='resolving'||phase==='done'}
              style={{width:'100%',height:46,paddingLeft:38,paddingRight:14,borderRadius:'var(--r)',
              background:'var(--bg-deep)',border:`1px solid ${src?'var(--accent-line)':'var(--border)'}`,
              color:'var(--text)',fontSize:13,fontFamily:'var(--font-mono)',outline:'none'}}/>
          </div>
          {/* source detected */}
          <div style={{height:22,display:'flex',alignItems:'center',marginTop:8}}>
            {url && (src
              ? <span style={{display:'flex',alignItems:'center',gap:7,fontSize:11.5,color:SOURCES[src].color}}>
                  <IcCheck size={13}/>Detected source: <strong style={{fontWeight:600}}>{SOURCES[src].label}</strong></span>
              : <span style={{fontSize:11.5,color:'var(--text-mute)'}}>Unrecognized URL — paste a SCIM, Satisfactory Blueprints, or direct .sbp link</span>)}
          </div>

          {/* examples */}
          {phase==='idle' && <div style={{marginTop:6}}>
            <div className="tlabel" style={{marginBottom:9}}>Try an example</div>
            <div style={{display:'flex',flexDirection:'column',gap:7}}>
              {EXAMPLES.map((e,i)=>(
                <button key={i} onClick={()=>setUrl(e.url)} style={{display:'flex',alignItems:'center',gap:10,
                  padding:'9px 11px',borderRadius:'var(--r)',background:'var(--panel-2)',border:'1px solid var(--border)',
                  textAlign:'left',cursor:'pointer'}}>
                  <SourceMark src={e.src} size={15}/>
                  <span className="mono" style={{fontSize:10.5,color:'var(--text-dim)',flex:1,overflow:'hidden',
                    textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.url.replace(/^https?:\/\//,'')}</span>
                  <IcPlus size={14} style={{color:'var(--text-mute)'}}/>
                </button>
              ))}
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'11px',borderRadius:'var(--r)',
                border:'1.5px dashed var(--border-strong)',color:'var(--text-mute)',marginTop:2}}>
                <IcUpload size={16}/><span style={{fontSize:12}}>…or drop a local <span className="mono">.sbp</span> / <span className="mono">.sbpcfg</span> file here</span>
              </div>
            </div>
          </div>}

          {/* resolving */}
          {phase==='resolving' && <div style={{marginTop:14,borderRadius:'var(--r)',background:'var(--bg-deep)',
            border:'1px solid var(--border)',padding:'14px 15px'}}>
            {STEPS.map((s,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'5px 0',
                color: i<step?'var(--ok)':i===step?'var(--accent)':'var(--text-faint)',fontSize:12.5}}>
                {i<step ? <IcCheck size={15}/> : i===step
                  ? <span style={{width:14,height:14,border:'2px solid currentColor',borderTopColor:'transparent',
                      borderRadius:'50%',animation:'spin .7s linear infinite'}}/>
                  : <span style={{width:14,height:14,borderRadius:'50%',border:'2px solid currentColor',opacity:.4}}/>}
                <span className="mono" style={{fontSize:11.5}}>{s}</span>
              </div>
            ))}
          </div>}

          {/* resolved preview */}
          {(phase==='resolved'||phase==='done') && <div style={{marginTop:14,borderRadius:'var(--r-md)',
            overflow:'hidden',border:'1px solid var(--border-strong)',background:'var(--panel-2)'}}>
            <div style={{display:'flex',gap:13,padding:13}}>
              <div style={{width:120,height:80,borderRadius:7,overflow:'hidden',flexShrink:0,
                border:'1px solid var(--border)'}}>
                <Thumb hue={resolved.hue} seed={resolved.seed} label=""/></div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:5}}>
                  <SourceBadge src={resolved.source}/><span className="mono" style={{fontSize:10,
                    color:'var(--text-mute)'}}>v{resolved.version}</span></div>
                <div style={{fontSize:15,fontWeight:600,letterSpacing:'-.01em'}}>{resolved.name}</div>
                <div style={{display:'flex',alignItems:'center',gap:6,marginTop:4,color:'var(--text-mute)'}}>
                  <IcUser size={12}/><span className="mono" style={{fontSize:11}}>{resolved.author}</span></div>
                <div style={{display:'flex',alignItems:'center',gap:13,marginTop:9}}>
                  <Meta icon={IcDimensions} v={`${resolved.dims.x}×${resolved.dims.y}×${resolved.dims.z}`}/>
                  <Meta icon={IcMachine} v={resolved.machines}/>
                  <Meta icon={IcPower} v={`${resolved.power}MW`}/>
                </div>
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 13px',
              borderTop:'1px solid var(--border)',background:'var(--bg-deep)'}}>
              <FilePair files={resolved.files}/>
              {!resolved.files.sbpcfg && <span style={{fontSize:11,color:'var(--warn)',display:'flex',
                alignItems:'center',gap:5}}><IcWarn size={13}/>config not bundled</span>}
              <div style={{flex:1}}/>
              <div style={{display:'flex',gap:5}}>{resolved.tags.slice(0,2).map(t=>
                <span key={t} className="mono" style={{fontSize:9.5,padding:'2px 6px',borderRadius:4,
                  background:'var(--well)',border:'1px solid var(--border)',color:'var(--text-dim)'}}>{t}</span>)}</div>
            </div>
          </div>}
        </div>

        {/* footer */}
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'15px 19px',
          borderTop:'1px solid var(--border)'}}>
          <span className="tlabel" style={{fontSize:9,color:'var(--text-faint)'}}>
            {phase==='done'?'✓ Added to library':'Import adds to library — export to game folder separately'}</span>
          <div style={{flex:1}}/>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          {phase==='resolved'||phase==='done'
            ? <Btn variant="primary" icon={phase==='done'?IcCheck:IcPlus} disabled={phase==='done'} onClick={add}>
                {phase==='done'?'Added':'Add to library'}</Btn>
            : <Btn variant="primary" icon={IcSearch} disabled={!src||phase==='resolving'} onClick={resolve}>
                {phase==='resolving'?'Resolving…':'Resolve link'}</Btn>}
        </div>
      </div>
    </div>
  );
}

function Meta({ icon:Icon, v }){
  return <span style={{display:'flex',alignItems:'center',gap:5,color:'var(--text-dim)'}}>
    <Icon size={13} style={{color:'var(--text-mute)'}}/><span className="mono" style={{fontSize:11.5}}>{v}</span></span>;
}

/* ============ EXPORT DRAWER ============ */
function ExportDrawer({ open, items, onClose, onRemove }){
  const [phase,setPhase] = useStateM('idle'); // idle|running|done
  const [prog,setProg] = useStateM(0);
  useEffectM(()=>{ if(open){ setPhase('idle'); setProg(0);} },[open]);
  const run = ()=>{ setPhase('running'); setProg(0);
    let p=0; const t=setInterval(()=>{ p+=Math.random()*18+8; if(p>=100){p=100;clearInterval(t);
      setTimeout(()=>setPhase('done'),300);} setProg(Math.min(p,100)); },220); };
  if(!open) return null;
  return (
    <div onClick={onClose} style={{position:'absolute',inset:0,zIndex:45,background:'rgba(5,6,8,.6)',
      display:'flex',justifyContent:'flex-end'}}>
      <div onClick={e=>e.stopPropagation()} style={{width:420,height:'100%',background:'var(--panel)',
        borderLeft:'1px solid var(--border-strong)',boxShadow:'-20px 0 60px -20px rgba(0,0,0,.7)',
        display:'flex',flexDirection:'column'}}>
        {/* header */}
        <div style={{padding:'17px 18px',borderBottom:'1px solid var(--border)'}}>
          <div style={{display:'flex',alignItems:'center',gap:11}}>
            <div style={{width:34,height:34,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',
              background:'var(--accent-ghost)',border:'1px solid var(--accent-line)',color:'var(--accent)'}}>
              <IcExport size={17}/></div>
            <div style={{flex:1}}>
              <div style={{fontSize:15,fontWeight:700}}>Batch export</div>
              <div className="tlabel" style={{fontSize:9,marginTop:2}}>{items.length} selected · {pairs(items)} file pairs</div>
            </div>
            <IconBtn icon={IcClose} onClick={onClose}/>
          </div>
          {/* target */}
          <div style={{display:'flex',alignItems:'center',gap:9,marginTop:13,padding:'10px 11px',
            borderRadius:'var(--r)',background:'var(--bg-deep)',border:'1px solid var(--border)'}}>
            <IcFolder size={16} style={{color:'var(--steel)'}}/>
            <div style={{flex:1,minWidth:0}}>
              <div className="tlabel" style={{fontSize:8.5}}>Target folder</div>
              <div className="mono" style={{fontSize:10.5,color:'var(--text-dim)',whiteSpace:'nowrap',
                overflow:'hidden',textOverflow:'ellipsis'}}>…/FactoryGame/Saved/Blueprints</div>
            </div>
            <span style={{width:7,height:7,borderRadius:'50%',background:'var(--ok)',boxShadow:'0 0 7px var(--ok)'}}/>
          </div>
        </div>

        {/* list */}
        <div style={{flex:1,overflowY:'auto',padding:'12px'}}>
          {items.length===0 && <div style={{textAlign:'center',color:'var(--text-mute)',padding:'40px 20px',
            fontSize:13}}>No blueprints selected.<br/>Select cards in the library to batch export.</div>}
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {items.map(b=>(
              <div key={b.id} style={{display:'flex',alignItems:'center',gap:11,padding:'9px 10px',
                borderRadius:'var(--r)',background:'var(--panel-2)',border:'1px solid var(--border)'}}>
                <div style={{width:48,height:34,borderRadius:5,overflow:'hidden',flexShrink:0,
                  border:'1px solid var(--border)'}}><Thumb hue={b.hue} seed={b.seed} label=""/></div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12.5,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',
                    textOverflow:'ellipsis'}}>{b.name}</div>
                  <div style={{marginTop:4}}>{phase==='done'
                    ? <span className="mono" style={{fontSize:10,color:'var(--ok)',display:'flex',
                        alignItems:'center',gap:5}}><IcCheck size={12}/>Installed</span>
                    : <FilePair files={b.files} compact/>}</div>
                </div>
                {phase==='idle' && <button onClick={()=>onRemove(b.id)} style={{color:'var(--text-mute)',
                  background:'none',border:'none',display:'flex',padding:4}}><IcClose size={15}/></button>}
              </div>
            ))}
          </div>
        </div>

        {/* footer / progress */}
        <div style={{padding:'15px 18px',borderTop:'1px solid var(--border)'}}>
          {phase==='running' && <div style={{marginBottom:12}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:7}}>
              <span className="tlabel" style={{color:'var(--accent)'}}>Copying files…</span>
              <span className="mono" style={{fontSize:11,color:'var(--text-dim)'}}>{Math.round(prog)}%</span></div>
            <div style={{height:6,borderRadius:99,background:'var(--bg-deep)',overflow:'hidden'}}>
              <div style={{height:'100%',width:`${prog}%`,borderRadius:99,
                background:'linear-gradient(90deg,var(--accent-deep),var(--accent-bright))',
                boxShadow:'0 0 12px var(--accent-glow)',transition:'width .2s'}}/></div>
          </div>}
          {phase==='done'
            ? <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{flex:1,display:'flex',alignItems:'center',gap:8,color:'var(--ok)',fontSize:13,fontWeight:600}}>
                  <IcCheck size={18}/>Exported {items.length} blueprint{items.length>1?'s':''}</div>
                <Btn variant="solid" onClick={onClose}>Done</Btn></div>
            : <Btn variant="primary" full size="lg" icon={IcExport} disabled={!items.length||phase==='running'} onClick={run}>
                {phase==='running'?'Exporting…':`Export ${items.length} to game folder`}</Btn>}
        </div>
      </div>
    </div>
  );
}
function pairs(items){ return items.filter(b=>b.files.sbpcfg).length; }

Object.assign(window, { ImportModal, ExportDrawer });
