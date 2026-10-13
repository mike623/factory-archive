// persist.ts — small per-machine lists (favorites, import history) kept in localStorage
import { useEffect, useState } from 'react';

function read<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

export function usePersistent<T>(key: string, fallback: () => T) {
  const [value, setValue] = useState<T>(() => read(key, fallback()));
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } }, [key, value]);
  return [value, setValue] as const;
}
