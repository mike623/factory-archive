// diskLibrary.ts — the real library: .sbp files in the game's blueprints folder, per world session
import { useCallback, useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Blueprint } from './data';

export interface DiskFile { name: string; hasSbp: boolean; hasCfg: boolean; size: number; modified: number }
interface DiskSession { name: string; blueprints: DiskFile[] }

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function toBlueprint(session: string, f: DiskFile): Blueprint {
  const h = hash(session + '/' + f.name);
  return {
    id: `disk:${session}/${f.name}`,
    name: f.name,
    source: 'local',
    category: session,
    tags: [],
    modded: false,
    materials: [],
    shots: 1,
    files: { sbp: f.hasSbp, sbpcfg: f.hasCfg },
    status: 'installed',
    hue: 26 + (h % 20),
    seed: h % 997,
    sizeKB: f.size ? Math.max(1, Math.round(f.size / 1024)) : 0,
    added: f.modified ? new Date(f.modified * 1000).toISOString().slice(0, 10) : '',
    notes: `Saved in the “${session}” world. Satisfactory loads it when that session is loaded.`,
    url: '',
    session,
    onDisk: true,
  };
}

/** Reads the blueprints folder in the desktop app; returns null in the browser preview. */
export function useDiskLibrary(root: string | null, refreshKey: unknown) {
  const [items, setItems] = useState<Blueprint[] | null>(null);
  const [sessions, setSessions] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!isTauri() || !root) return;
    try {
      const list = await invoke<DiskSession[]>('library', { root });
      setSessions(list.map(s => s.name));
      setItems(list.flatMap(s => s.blueprints.filter(f => f.hasSbp).map(f => toBlueprint(s.name, f))));
    } catch (e) { console.error(e); setItems([]); }
  }, [root]);

  useEffect(() => { load(); }, [load, refreshKey]);
  // pick up blueprints saved in-game while the app was in the background
  useEffect(() => {
    if (!isTauri()) return;
    addEventListener('focus', load);
    return () => removeEventListener('focus', load);
  }, [load]);

  return { items, sessions, reload: load };
}
