// breakdown.tsx — what a blueprint contains (size, material cost, buildings), read from its own files
import { useEffect, useState, type ReactNode } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Blueprint } from './data';
import type { Icon } from './icons';
import { IcCube, IcDimensions, IcMachine, IcMaterial, IcWarn } from './icons';

export interface Line { class: string; name: string; amount: number }
export interface Breakdown {
  saveVersion: number; build: number; size: [number, number, number];
  cost: Line[]; buildings: Line[]; totalBuildings: number; buildingsError: string | null;
}
export interface BlueprintConfig { description: string; iconId: number; color: [number, number, number, number] }
export interface BlueprintInfo { breakdown: Breakdown | null; error: string | null; config: BlueprintConfig | null }

// browser preview only: shows the layout with numbers from a real 1.0 blueprint
const PREVIEW: BlueprintInfo = {
  breakdown: {
    saveVersion: 52, build: 424353, size: [5, 5, 5], buildingsError: null, totalBuildings: 64,
    cost: [['Concrete', 70], ['Encased Industrial Beam', 52], ['Wire', 44], ['Cable', 31], ['Modular Frame', 30], ['Rotor', 30],
      ['Iron Rod', 29], ['Steel Beam', 28], ['Iron Plate', 22]].map(([name, amount]) => ({ class: '', name: name as string, amount: amount as number })),
    buildings: [['Conveyor Belt Mk.4', 16], ['Power Line', 9], ['Conveyor Merger', 8], ['Flat Frame 01', 8], ['Beam Connector Double', 4],
      ['Beam Painted', 4], ['Double Wall Outlet Mk.1', 4], ['Foundry', 3], ['Wall Outlet Mk.1', 3], ['Conveyor Lift Mk.4', 2],
      ['Conveyor Splitter', 2], ['Conveyor Lift Floor Hole', 1]].map(([name, amount]) => ({ class: '', name: name as string, amount: amount as number })),
  },
  error: null,
  config: { description: 'Stackable frame containing foundries.\n- Input is load balanced for the entire frame.', iconId: 78, color: [0.107, 0.434, 0.558, 1] },
};

export function useBlueprintInfo(bp: Blueprint, root: string | null) {
  const [info, setInfo] = useState<BlueprintInfo | null>(null);
  useEffect(() => {
    setInfo(null);
    if (!bp.onDisk || !bp.session) return;
    if (!isTauri()) { setInfo(PREVIEW); return; }
    if (!root) return;
    let live = true;
    invoke<BlueprintInfo>('blueprint_info', { root, session: bp.session, name: bp.name })
      .then(i => { if (live) setInfo(i); })
      .catch(e => { if (live) setInfo({ breakdown: null, error: String(e), config: null }); });
    return () => { live = false; };
  }, [bp.id, bp.session, bp.name, bp.onDisk, root]);
  return info;
}

const rgb = (c: [number, number, number, number]) =>
  `rgb(${c.slice(0, 3).map(v => Math.round(Math.min(1, Math.max(0, v)) ** (1 / 2.2) * 255)).join(' ')})`;

export function BreakdownSection({ info }: { info: BlueprintInfo }) {
  const b = info.breakdown;
  if (!b) return info.error
    ? <Note>Couldn't read this blueprint's contents: {info.error}</Note>
    : null;
  const totalItems = b.cost.reduce((n, l) => n + l.amount, 0);
  const cost = [...b.cost].sort((x, y) => y.amount - x.amount);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 9, marginBottom: 14 }}>
        <Stat icon={IcDimensions} label="Size" value={b.size.join(' × ')} />
        <Stat icon={IcMachine} label="Buildings" value={b.buildingsError ? '—' : String(b.totalBuildings)} />
        <Stat icon={IcMaterial} label="Items to build" value={totalItems.toLocaleString()} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <List title="Materials" icon={IcMaterial} lines={cost} max={cost[0]?.amount ?? 1} accent />
        {b.buildingsError
          ? <Note>Buildings couldn't be read: {b.buildingsError}</Note>
          : <List title="Buildings" icon={IcCube} lines={b.buildings} max={b.buildings[0]?.amount ?? 1} />}
      </div>
    </div>
  );
}

export function ConfigSwatch({ config }: { config: BlueprintConfig }) {
  return <span title={`Blueprint color · icon #${config.iconId}`} style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0,
    background: rgb(config.color), border: '1px solid var(--border-strong)', display: 'inline-block' }} />;
}

function Stat({ icon: Ic, label, value }: { icon: Icon; label: string; value: string }) {
  return (
    <div style={{ padding: '11px 12px', borderRadius: 'var(--r)', background: 'var(--panel-2)', border: '1px solid var(--border-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-mute)' }}>
        <Ic size={13} /><span className="tlabel" style={{ fontSize: 9, color: 'inherit' }}>{label}</span></div>
      <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function List({ title, icon: Ic, lines, max, accent = false }: { title: string; icon: Icon; lines: Line[]; max: number; accent?: boolean }) {
  return (
    <div style={{ borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--panel)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px', borderBottom: '1px solid var(--border-soft)' }}>
        <Ic size={14} style={{ color: accent ? 'var(--accent)' : 'var(--steel)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</span>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-mute)' }}>{lines.length}</span>
      </div>
      <div style={{ padding: '4px 0' }}>
        {lines.map(l => (
          <div key={l.class || l.name} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px' }}>
            <span style={{ position: 'absolute', left: 0, top: 3, bottom: 3, width: `${Math.max(4, (l.amount / max) * 100)}%`,
              background: accent ? 'var(--accent-ghost)' : 'var(--steel-ghost)', borderRadius: '0 4px 4px 0' }} />
            <span style={{ position: 'relative', flex: 1, minWidth: 0, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              title={l.class || undefined}>{l.name}</span>
            <span className="mono" style={{ position: 'relative', fontSize: 12, fontWeight: 600 }}>{l.amount.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 'var(--r)', fontSize: 12.5, lineHeight: 1.5,
      color: 'var(--warn)', background: 'var(--warn-ghost)', border: '1px solid color-mix(in oklab,var(--warn) 30%,transparent)' }}>
      <IcWarn size={14} style={{ flexShrink: 0, marginTop: 2 }} /><span>{children}</span>
    </div>
  );
}
