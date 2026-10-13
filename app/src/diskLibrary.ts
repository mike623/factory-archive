// diskLibrary.ts — the real library: .sbp files in the game's blueprints folder, per world session
import { useCallback, useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Blueprint, SourceId } from './data';

export interface BlueprintMeta {
  source: string; sourceUrl?: string | null; title?: string | null; description?: string | null;
  author?: string | null; category?: string | null; tags?: string[]; siteName?: string | null;
  imageFile?: string | null; importedAt?: number;
}
export interface DiskFile {
  name: string; hasSbp: boolean; hasCfg: boolean; size: number; modified: number;
  key?: string | null; meta?: BlueprintMeta | null;
}
interface DiskSession { name: string; blueprints: DiskFile[] }

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const SOURCE_IDS: SourceId[] = ['scim', 'sbp', 'url', 'local'];

export function toBlueprint(session: string, f: DiskFile): Blueprint {
  const h = hash(session + '/' + f.name);
  const m = f.meta ?? null;
  const source = (m && SOURCE_IDS.includes(m.source as SourceId) ? m.source : 'local') as SourceId;
  const title = m?.title?.trim();
  return {
    id: `disk:${session}/${f.name}`,
    name: f.name,
    source,
    category: m?.category ?? '',
    tags: m?.tags ?? [],
    modded: false,
    materials: [],
    shots: 1,
    files: { sbp: f.hasSbp, sbpcfg: f.hasCfg },
    status: 'installed',
    hue: 26 + (h % 20),
    seed: h % 997,
    sizeKB: f.size ? Math.max(1, Math.round(f.size / 1024)) : 0,
    added: f.modified ? new Date(f.modified * 1000).toISOString().slice(0, 10) : '',
    notes: m?.description || `Saved in the “${session}” world. Satisfactory loads it when that session is loaded.`,
    url: m?.sourceUrl ?? '',
    session,
    onDisk: true,
    imageKey: m?.imageFile && f.key ? f.key : undefined,
    title: title && title.toLowerCase() !== f.name.toLowerCase() ? title : undefined,
    author: m?.author ?? undefined,
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
