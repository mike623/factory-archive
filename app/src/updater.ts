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

  const checkNow = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const u = await check();
      if (u) { setUpdate(u); setPhase(p => (p === 'idle' ? 'available' : p)); }
    } catch (e) {
      // no release published yet, or offline — try again later, quietly
      console.warn('update check failed', e);
    }
  }, []);

  useEffect(() => {
    checkNow();
    const t = setInterval(checkNow, RECHECK_MS);
    return () => clearInterval(t);
  }, [checkNow]);

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
    version: update?.version ?? null,
    notes: update?.body ?? null,
    phase, progress, error,
    visible: !!update && !dismissed,
    install, dismiss: () => setDismissed(true),
  };
}
