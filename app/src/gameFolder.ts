// gameFolder.ts — which blueprints folder exports go to (remembered per machine)
import { useCallback, useEffect, useState } from 'react';
import { findGameFolders, pickGameFolder, type GameFolder } from './platform';

const KEY = 'fa-game-folder';

function loadCustom(): GameFolder | null {
  try {
    const raw = localStorage.getItem(KEY);
    const f = raw ? JSON.parse(raw) as GameFolder : null;
    return f && typeof f.path === 'string' ? f : null;
  } catch { return null; }
}

export function useGameFolder() {
  const [folders, setFolders] = useState<GameFolder[]>([]);
  const [current, setCurrent] = useState<GameFolder | null>(loadCustom);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    findGameFolders().then(found => {
      const saved = loadCustom();
      const list = saved && !found.some(f => f.path === saved.path) ? [...found, saved] : found;
      setFolders(list);
      // keep the remembered choice if it still exists in the list, otherwise take the best detected match
      setCurrent(cur => list.find(f => f.path === cur?.path) ?? list.find(f => f.found) ?? list[0] ?? null);
      setLoading(false);
    });
  }, []);

  const select = useCallback((f: GameFolder) => {
    setCurrent(f);
    try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* ignore */ }
  }, []);

  const pickCustom = useCallback(async () => {
    const f = await pickGameFolder();
    if (!f) return;
    setFolders(list => list.some(x => x.path === f.path) ? list : [...list, f]);
    select(f);
  }, [select]);

  return { folders, current, loading, select, pickCustom };
}

export type GameFolderState = ReturnType<typeof useGameFolder>;
