// share.ts — host side of "Share with players"
import { useCallback, useEffect, useState } from 'react';
import {
  canShare, listSessions, onSharedImport, shareSetSession, shareStart, shareStatus, shareStop,
  type SessionsInfo, type ShareInfo, type SharedImport,
} from './platform';

export function useShare(root: string | null) {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imports, setImports] = useState<(SharedImport & { at: number })[]>([]);
  const [sessions, setSessions] = useState<SessionsInfo | null>(null);

  const refreshSessions = useCallback(() => {
    if (root) listSessions(root).then(setSessions).catch(e => setError(String(e)));
  }, [root]);
  useEffect(refreshSessions, [refreshSessions]);

  /** null = follow the detected current world */
  const pinSession = useCallback(async (name: string | null) => {
    try { await shareSetSession(name); refreshSessions(); } catch (e) { setError(String(e)); }
  }, [refreshSessions]);

  useEffect(() => { shareStatus().then(setInfo).catch(() => {}); }, []);

  useEffect(() => {
    let off: (() => void) | undefined, dead = false;
    onSharedImport(e => { setImports(list => [{ ...e, at: Date.now() }, ...list].slice(0, 5)); refreshSessions(); })
      .then(u => { if (dead) u(); else off = u; });
    return () => { dead = true; off?.(); };
  }, [refreshSessions]);

  // follow the host's folder choice while sharing
  useEffect(() => {
    if (info && root && info.root !== root) shareStart(root).then(setInfo).catch(e => setError(String(e)));
  }, [root, info]);

  const toggle = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      if (info) { await shareStop(); setInfo(null); }
      else if (root) { setInfo(await shareStart(root)); refreshSessions(); }
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }, [info, root]);

  const dismiss = useCallback((at: number) => setImports(list => list.filter(i => i.at !== at)), []);

  return { info, busy, error, available: canShare() && !!root, toggle, imports, dismiss, sessions, pinSession, refreshSessions };
}

export type ShareStateUI = ReturnType<typeof useShare>;
