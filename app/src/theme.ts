// theme.ts — light/dark theme, persisted per machine
import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';
const KEY = 'fa-theme';

function readSaved(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch { /* storage unavailable — fall back to default */ }
  return 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readSaved);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);
  return [theme, setTheme] as const;
}
