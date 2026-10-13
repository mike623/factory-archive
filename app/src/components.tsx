// components.tsx — shared UI primitives for Factory Archive
import type { CSSProperties, ReactNode } from 'react';
import { SOURCES, STATUS, type SourceId, type StatusId } from './data';
import { IcCheck, IcClose, type Icon } from './icons';

/* ---------- seeded isometric massing placeholder ---------- */
function mulberry(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoBuilding(seed: number) {
  const rnd = mulberry(seed * 9973 + 13);
  const blocks: { gx: number; gy: number; h: number }[] = [];
  const n = 4 + Math.floor(rnd() * 4);
  const used = new Set<string>();
  for (let i = 0; i < n; i++) {
    const gx = Math.floor(rnd() * 4), gy = Math.floor(rnd() * 4);
    const key = gx + ',' + gy;
    if (used.has(key)) { i--; continue; }
    used.add(key);
    blocks.push({ gx, gy, h: 0.7 + rnd() * 2.4 });
  }
  blocks.sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));
  return blocks;
}

// SVG string builder — shared by <Thumb> and data-URI consumers
export function isoSVG(hue = 38, seed = 1, W = 400, H = 240, label = 'ISO · PREVIEW') {
  const cx = W / 2, cy = H * 0.62, tw = 46, th = 26, ch = 20;
  const blocks = isoBuilding(seed);
  const top = `hsl(${hue} 60% 58%)`, left = `hsl(${hue} 45% 30%)`,
        right = `hsl(${hue} 42% 22%)`, edge = `hsl(${hue} 80% 66%)`;
  const P = (gx: number, gy: number, gz: number) =>
    `${(cx + (gx - gy) * tw / 2).toFixed(1)} ${(cy + (gx + gy) * th / 2 - gz * ch).toFixed(1)}`;
  let faces = '';
  for (const b of blocks) {
    faces += `<path d="M${P(b.gx-0.5,b.gy+0.5,0)} L${P(b.gx+0.5,b.gy+0.5,0)} L${P(b.gx+0.5,b.gy+0.5,b.h)} L${P(b.gx-0.5,b.gy+0.5,b.h)} Z" fill="${right}" stroke="${edge}" stroke-width="0.8" stroke-opacity="0.5"/>`;
    faces += `<path d="M${P(b.gx+0.5,b.gy-0.5,0)} L${P(b.gx+0.5,b.gy+0.5,0)} L${P(b.gx+0.5,b.gy+0.5,b.h)} L${P(b.gx+0.5,b.gy-0.5,b.h)} Z" fill="${left}" stroke="${edge}" stroke-width="0.8" stroke-opacity="0.5"/>`;
    faces += `<path d="M${P(b.gx-0.5,b.gy-0.5,b.h)} L${P(b.gx+0.5,b.gy-0.5,b.h)} L${P(b.gx+0.5,b.gy+0.5,b.h)} L${P(b.gx-0.5,b.gy+0.5,b.h)} Z" fill="${top}" stroke="${edge}" stroke-width="1"/>`;
  }
  const lbl = label ? `<text x="11" y="${H-10}" fill="rgba(255,255,255,.45)" font-family="JetBrains Mono, monospace" font-size="9" letter-spacing="1.6">${label}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">`
    + `<defs><pattern id="g${seed}" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#222932" stroke-width="1"/></pattern>`
    + `<radialGradient id="bg${seed}" cx="50%" cy="20%" r="90%"><stop offset="0%" stop-color="#161b22"/><stop offset="75%" stop-color="#0c0f13"/></radialGradient></defs>`
    + `<rect width="${W}" height="${H}" fill="url(#bg${seed})"/><rect width="${W}" height="${H}" fill="url(#g${seed})" opacity="0.55"/>`
    + `<path d="M${P(-0.5,-0.5,0)} L${P(4.5,-0.5,0)} L${P(4.5,4.5,0)} L${P(-0.5,4.5,0)} Z" fill="#10141a" stroke="#2a313b" stroke-width="1" opacity="0.9"/>`
    + faces + `<circle cx="${W-15}" cy="15" r="3" fill="${top}"/>` + lbl + `</svg>`;
}

/** Blueprint preview art. Stays dark in both themes — it reads as imagery. */
export function Thumb({ hue = 38, seed = 1, label = 'ISO · PREVIEW', tall = false, style }:
  { hue?: number; seed?: number; label?: string; tall?: boolean; style?: CSSProperties }) {
  const W = 400, H = tall ? 340 : 240;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
      background: '#0c0f13', ...style }}
      dangerouslySetInnerHTML={{ __html:
        isoSVG(hue, seed, W, H, label).replace('<svg ', '<svg style="width:100%;height:100%;display:block" ')
        + `<div style="position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,transparent 0 3px,rgba(0,0,0,.10) 3px 4px)"></div>` }} />
  );
}

/* ---------- source badge ---------- */
export function SourceMark({ src, size = 14 }: { src: SourceId; size?: number }) {
  const c = SOURCES[src].color;
  const M: Record<SourceId, ReactNode> = {
    scim:  <g><circle cx="12" cy="12" r="8.5" fill="none" stroke={c} strokeWidth="1.6"/><path d="M9 9.5a3 3 0 100 5M15 9.5a3 3 0 110 5" stroke={c} strokeWidth="1.6" fill="none" strokeLinecap="round"/></g>,
    sbp:   <g><rect x="4.5" y="4.5" width="15" height="15" rx="2" fill="none" stroke={c} strokeWidth="1.6"/><path d="M9 8.5h4.5a2 2 0 010 4H9zM9 12.5h5a2 2 0 010 4H9z" fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round"/></g>,
    local: <g><path d="M12 4l7 4v8l-7 4-7-4V8z" fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round"/><path d="M12 12v6M12 12L5 8M12 12l7-4" stroke={c} strokeWidth="1.2"/></g>,
    url:   <g><path d="M10 14a4 4 0 005.7 0l2.3-2.3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0L6 12.3a4 4 0 005.7 5.7l1-1" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round"/></g>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>{M[src]}</svg>;
}

export function SourceBadge({ src, full = false }: { src: SourceId; full?: boolean }) {
  const s = SOURCES[src];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 22, padding: '0 8px 0 6px',
      borderRadius: 'var(--r-sm)', background: 'var(--well)', border: `1px solid ${s.color}33`,
      color: s.color, fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600,
      letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
      <SourceMark src={src} size={13} />{full ? s.label : s.short}
    </span>
  );
}

/* ---------- status pill ---------- */
export function StatusPill({ status, small = false }: { status: StatusId; small?: boolean }) {
  const s = STATUS[status];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: small ? 20 : 24,
      padding: small ? '0 8px' : '0 10px', borderRadius: 99, background: s.ghost,
      border: `1px solid color-mix(in oklab, ${s.color} 35%, transparent)`,
      color: s.color, fontFamily: 'var(--font-mono)', fontSize: small ? 10 : 11, fontWeight: 600,
      letterSpacing: '.02em', whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color,
        boxShadow: `0 0 6px ${s.color}`, animation: status === 'update' ? 'pulse-dot 1.6s infinite' : 'none' }} />
      {s.label}
    </span>
  );
}

/* ---------- tag chip ---------- */
export function Tag({ children, active = false, onClick, count }:
  { children: ReactNode; active?: boolean; onClick?: () => void; count?: number }) {
  return (
    <button onClick={onClick} aria-pressed={onClick ? active : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26,
      padding: '0 10px', borderRadius: 'var(--r-sm)', cursor: onClick ? 'pointer' : 'default',
      background: active ? 'var(--accent-ghost)' : 'var(--well)',
      border: `1px solid ${active ? 'var(--accent-line)' : 'var(--border)'}`,
      color: active ? 'var(--accent-bright)' : 'var(--text-dim)',
      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, letterSpacing: '.02em',
      transition: 'all .15s var(--ease)' }}>
      {children}
      {count != null && <span style={{ opacity: .6, fontSize: 10 }}>{count}</span>}
    </button>
  );
}

/** Small mono chip used for tags inside cards, rows and previews. */
export function MiniTag({ children, size = 10 }: { children: ReactNode; size?: number }) {
  return (
    <span className="mono" style={{ fontSize: size, padding: '2px 7px', borderRadius: 4,
      background: 'var(--well)', border: '1px solid var(--border)', color: 'var(--text-dim)',
      whiteSpace: 'nowrap' }}>{children}</span>
  );
}

export function ModdedBadge({ large = false }: { large?: boolean }) {
  return (
    <span className="mono" style={{ fontSize: large ? 10 : 9, fontWeight: 600,
      padding: large ? '3px 8px' : '2px 6px', borderRadius: large ? 5 : 4,
      background: `rgba(176,124,240,${large ? .14 : .16})`, border: '1px solid rgba(176,124,240,.35)',
      color: '#c79cf5' }}>MODDED</span>
  );
}

/* ---------- buttons ---------- */
type BtnVariant = 'primary' | 'solid' | 'ghost' | 'danger';
const BTN_VARIANTS: Record<BtnVariant, CSSProperties> = {
  primary: { background: 'linear-gradient(180deg,var(--accent-bright),var(--accent))', color: '#1a1206',
    border: '1px solid var(--accent-press)', boxShadow: '0 1px 0 rgba(255,255,255,.25) inset, 0 6px 18px -6px var(--accent-glow)' },
  solid:   { background: 'var(--raise)', color: 'var(--text)', border: '1px solid var(--border-strong)' },
  ghost:   { background: 'var(--well)', color: 'var(--text-dim)', border: '1px solid var(--border)' },
  danger:  { background: 'rgba(224,106,90,.08)', color: 'var(--danger)', border: '1px solid rgba(224,106,90,.3)' },
};

export function Btn({ children, variant = 'ghost', icon: Ic, onClick, full, size = 'md', disabled, title }:
  { children?: ReactNode; variant?: BtnVariant; icon?: Icon; onClick?: () => void; full?: boolean;
    size?: 'sm' | 'md' | 'lg'; disabled?: boolean; title?: string }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        height: size === 'sm' ? 30 : size === 'lg' ? 42 : 36, padding: size === 'sm' ? '0 11px' : '0 15px',
        borderRadius: 'var(--r)', fontFamily: 'var(--font-display)', fontWeight: 600,
        fontSize: size === 'lg' ? 14 : 13, letterSpacing: '.01em', width: full ? '100%' : 'auto',
        transition: 'all .15s var(--ease)', opacity: disabled ? .45 : 1,
        pointerEvents: disabled ? 'none' : 'auto', whiteSpace: 'nowrap', ...BTN_VARIANTS[variant] }}>
      {Ic && <Ic size={size === 'sm' ? 14 : 16} />}{children}
    </button>
  );
}

export function IconBtn({ icon: Ic, onClick, active = false, title, size = 16 }:
  { icon: Icon; onClick?: () => void; active?: boolean; title?: string; size?: number }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      aria-pressed={onClick && active ? true : undefined}
      style={{ display: 'inline-flex', alignItems: 'center',
      justifyContent: 'center', width: 34, height: 34, borderRadius: 'var(--r)', flexShrink: 0,
      background: active ? 'var(--accent-ghost)' : 'transparent',
      border: `1px solid ${active ? 'var(--accent-line)' : 'var(--border)'}`,
      color: active ? 'var(--accent-bright)' : 'var(--text-dim)', transition: 'all .15s var(--ease)' }}>
      <Ic size={size} />
    </button>
  );
}

/* ---------- checkbox ---------- */
export function Check({ checked, onChange, size = 18, label }:
  { checked: boolean; onChange?: (v: boolean) => void; size?: number; label?: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onChange?.(!checked); }}
      style={{ width: size, height: size, borderRadius: 5, flexShrink: 0, display: 'inline-flex',
      alignItems: 'center', justifyContent: 'center', padding: 0,
      background: checked ? 'var(--accent)' : 'var(--well)',
      border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--border-strong)'}`,
      color: '#1a1206', transition: 'all .12s var(--ease)' }}>
      {checked && <IcCheck size={size - 6} sw={2.6} />}
    </button>
  );
}

/* ---------- file pair status ---------- */
function FileItem({ ext, ok, compact }: { ext: string; ok: boolean; compact: boolean }) {
  return (
    <span title={ok ? `.${ext} present` : `.${ext} missing`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: compact ? 20 : 24,
      padding: compact ? '0 6px' : '0 8px', borderRadius: 'var(--r-sm)',
      background: ok ? 'var(--ok-ghost)' : 'var(--off-ghost)',
      border: `1px solid ${ok ? 'color-mix(in oklab,var(--ok) 30%,transparent)' : 'var(--border)'}`,
      color: ok ? 'var(--ok)' : 'var(--text-faint)', fontFamily: 'var(--font-mono)',
      fontSize: compact ? 9.5 : 10.5, fontWeight: 600, letterSpacing: '.02em' }}>
      {ok ? <IcCheck size={compact ? 10 : 11} sw={2.4} /> : <IcClose size={compact ? 10 : 11} sw={2.2} />}
      .{ext}
    </span>
  );
}

export function FilePair({ files, compact = false }: { files: { sbp: boolean; sbpcfg: boolean }; compact?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 5 }}>
      <FileItem ext="sbp" ok={files.sbp} compact={compact} />
      <FileItem ext="sbpcfg" ok={files.sbpcfg} compact={compact} />
    </span>
  );
}

/* ---------- meta stat ---------- */
export function MetaStat({ icon: Ic, label, value, accent = false }:
  { icon: Icon; label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '12px 13px',
      background: 'var(--panel-2)', border: '1px solid var(--border-soft)', borderRadius: 'var(--r)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: accent ? 'var(--accent)' : 'var(--text-mute)' }}>
        <Ic size={14} /><span className="tlabel" style={{ color: 'inherit', fontSize: 9.5 }}>{label}</span>
      </div>
      <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>{value}</div>
    </div>
  );
}

/** Icon tile used in modal/drawer headers. */
export function HeaderGlyph({ icon: Ic }: { icon: Icon }) {
  return (
    <div style={{ width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, background: 'var(--accent-ghost)', border: '1px solid var(--accent-line)', color: 'var(--accent)' }}>
      <Ic size={17} /></div>
  );
}

/** Pulsing-free status dot (sync indicators). */
export function Dot({ color = 'var(--ok)' }: { color?: string }) {
  return <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: color, boxShadow: `0 0 7px ${color}` }} />;
}
