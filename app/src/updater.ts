// updater.ts — check GitHub Releases for a newer signed build and install it
import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import type { Update } from '@tauri-apps/plugin-updater';

const RECHECK_MS = 6 * 60 * 60 * 1000;

type Phase = 'idle' | 'available' | 'downloading' | 'ready' | 'error';

export function useUpdater() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0); // 0..1, or -1 when the size is unknown
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  /** result of the last manual check, shown next to the button for a few seconds */
  const [manual, setManual] = useState<'checking' | 'latest' | 'found' | 'failed' | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/api/app').then(m => m.getVersion()).then(setCurrent).catch(() => {});
  }, []);

  const check = useCallback(async (): Promise<'found' | 'latest' | 'failed'> => {
    if (!isTauri()) return 'failed';
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const u = await check();
      if (u) { setUpdate(u); setPhase(p => (p === 'idle' ? 'available' : p)); return 'found'; }
      return 'latest';
    } catch (e) {
      // no release published yet, or offline — automatic checks stay quiet
      console.warn('update check failed', e);
      return 'failed';
    }
  }, []);

  useEffect(() => {
    check();
    const t = setInterval(check, RECHECK_MS);
    return () => clearInterval(t);
  }, [check]);

  /** "Check for updates" button: always shows the banner again if something is found */
  const checkNow = useCallback(async () => {
    setManual('checking');
    const r = await check();
    if (r === 'found') setDismissed(false);
    setManual(r);
    setTimeout(() => setManual(m => (m === r ? null : m)), 5000);
  }, [check]);

  const install = useCallback(async () => {
    if (!update) return;
    setPhase('downloading'); setError(null); setProgress(0);
    try {
      let total = 0, got = 0;
      await update.downloadAndInstall(ev => {
        if (ev.event === 'Started') { total = ev.data.contentLength ?? 0; if (!total) setProgress(-1); }
        else if (ev.event === 'Progress') { got += ev.data.chunkLength; if (total) setProgress(got / total); }
      });
      setPhase('ready');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      setError(String(e)); setPhase('error');
    }
  }, [update]);

  return {
    current, manual, checkNow, available: isTauri(),
    version: update?.version ?? null,
    notes: update?.body ?? null,
    phase, progress, error,
    visible: !!update && !dismissed,
    install, dismiss: () => setDismissed(true),
  };
}

export type UpdaterState = ReturnType<typeof useUpdater>;
