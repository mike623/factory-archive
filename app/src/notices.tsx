// notices.tsx — short-lived toasts for file operations
import { useCallback, useState } from 'react';
import { IcCheck, IcClose, IcWarn } from './icons';
import type { Outcome } from './platform';

export interface Notice { id: number; tone: 'ok' | 'warn'; title: string; detail?: string }

export function useNotices() {
  const [list, setList] = useState<Notice[]>([]);
  const dismiss = useCallback((id: number) => setList(l => l.filter(n => n.id !== id)), []);
  const push = useCallback((n: Omit<Notice, 'id'>) => {
    const id = Date.now() + Math.random();
    setList(l => [{ ...n, id }, ...l].slice(0, 4));
    setTimeout(() => dismiss(id), n.tone === 'ok' ? 6000 : 12000);
  }, [dismiss]);

  /** Summarise per-file results, e.g. "Added 2 blueprints to Steel Town" + what failed. */
  const report = useCallback((verb: string, where: string, out: Outcome[]) => {
    const ok = out.filter(o => o.ok), bad = out.filter(o => !o.ok);
    if (!out.length) { push({ tone: 'warn', title: 'No blueprint files found', detail: 'Pick .sbp files (and their .sbpcfg, if you have them).' }); return; }
    if (ok.length) push({ tone: 'ok', title: `${verb} ${ok.length} blueprint${ok.length === 1 ? '' : 's'} to ${where}`,
      detail: ok.length <= 3 ? ok.map(o => o.name).join(', ') : undefined });
    if (bad.length) push({ tone: 'warn', title: `${bad.length} couldn't be ${verb.toLowerCase()}`,
      detail: bad.slice(0, 3).map(o => `${o.name}: ${o.error}`).join('\n') });
  }, [push]);

  return { list, push, dismiss, report };
}

export function Notices({ list, dismiss }: { list: Notice[]; dismiss: (id: number) => void }) {
  if (!list.length) return null;
  return (
    <div aria-live="polite" style={{ position: 'fixed', left: 222, bottom: 18, zIndex: 60, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {list.map(n => (
        <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: 340, padding: '11px 12px', borderRadius: 10,
          background: 'var(--floatbar)', backdropFilter: 'blur(10px)', border: '1px solid var(--border-strong)',
          boxShadow: 'var(--shadow-lg)', animation: 'fadein .2s' }}>
          {n.tone === 'ok'
            ? <IcCheck size={16} style={{ color: 'var(--ok)', flexShrink: 0, marginTop: 1 }} />
            : <IcWarn size={16} style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 1 }} />}
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.45 }}>
            <div style={{ fontWeight: 600 }}>{n.title}</div>
            {n.detail && <div style={{ color: 'var(--text-mute)', fontSize: 11.5, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{n.detail}</div>}
          </div>
          <button onClick={() => dismiss(n.id)} aria-label="Dismiss"
            style={{ background: 'none', border: 'none', color: 'var(--text-mute)', display: 'flex', padding: 2 }}><IcClose size={14} /></button>
        </div>
      ))}
    </div>
  );
}
