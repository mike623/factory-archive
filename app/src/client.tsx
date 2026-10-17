// client.tsx — client mode: find a host on the network, join it, and show which one is in use
import { createContext, Fragment, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Btn, Dot } from './components';
import { IcCube, IcRefresh, IcShare } from './icons';
import { canHost, discoverHosts, hostHello, setAppMode, setHostUrl, type FoundHost } from './platform';

const HOST_KEY = 'fa-host';
const remembered = () => { try { return localStorage.getItem(HOST_KEY); } catch { return null; } };
const errText = (e: unknown) => String(e).replace(/^Error: /, '');
const addr = (h: FoundHost) => h.url.replace(/^http:\/\//, '');

interface Connection { host: FoundHost; join: (h: FoundHost) => void }
const Ctx = createContext<Connection | null>(null);

/**
 * Shows the library only once a host is joined: the remembered one if it still answers, otherwise the
 * first host found on the network, without asking. Changing hosts remounts the library.
 */
export function ClientGate({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<FoundHost | null>(null);
  const [searching, setSearching] = useState(true);
  /** hosts found that run an older Factory Archive */
  const [outdated, setOutdated] = useState<FoundHost[]>([]);

  const join = useCallback((h: FoundHost) => {
    setHostUrl(h.url);
    try { localStorage.setItem(HOST_KEY, h.url); } catch { /* ignore */ }
    setHost(h);
  }, []);

  const search = useCallback(async () => {
    setSearching(true);
    const last = remembered();
    const again = last ? await hostHello(last).catch(() => null) : null;
    const found = again && !again.outdated ? [again] : await discoverHosts().catch(() => []);
    const first = found.find(h => !h.outdated);
    if (first) join(first);
    setOutdated(found.filter(h => h.outdated));
    setSearching(false);
  }, [join]);
  useEffect(() => { search(); }, [search]);

  if (!host) return <ConnectScreen searching={searching} outdated={outdated} onRetry={search} onJoin={join} />;
  return <Ctx.Provider value={{ host, join }}><Fragment key={host.url}>{children}</Fragment></Ctx.Provider>;
}

function ConnectScreen({ searching, outdated, onRetry, onJoin }: {
  searching: boolean; outdated: FoundHost[]; onRetry: () => void; onJoin: (h: FoundHost) => void;
}) {
  return (
    <div className="grid-bg" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: 400, maxWidth: 'calc(100vw - 32px)', padding: 24, borderRadius: 12, background: 'var(--panel)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(150deg,var(--accent-bright),var(--accent-deep))' }}>
            <IcCube size={17} sw={1.8} style={{ color: '#1a1206' }} /></div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{searching ? 'Looking for a host…' : outdated.length ? 'The host needs an update' : 'No host found'}</div>
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-dim)' }}>
          {searching
            ? 'Searching your network for a PC running Factory Archive with Share on LAN turned on.'
            : outdated.length
            ? `Found Factory Archive sharing at ${outdated.map(addr).join(', ')}, but it's an older version that can't be joined. Update it on that PC (Check for updates in its sidebar), then search again.`
            : 'Nobody on your network is sharing right now. Ask the host to open Factory Archive and turn on Share on LAN, or type their address.'}
        </div>
        {!searching && <>
          <AddressForm onJoin={onJoin} />
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" size="sm" icon={IcRefresh} onClick={onRetry}>Search again</Btn>
            {canHost && <Btn variant="ghost" size="sm" icon={IcShare} onClick={() => setAppMode('host')}>Use this PC as host</Btn>}
          </div>
        </>}
      </div>
    </div>
  );
}

const field = {
  flex: 1, minWidth: 0, height: 30, padding: '0 9px', borderRadius: 'var(--r-sm)', background: 'var(--well)',
  border: '1px solid var(--border)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
} as const;

/** Join a host by its address, e.g. 192.168.1.20:7777 (the link the host's Share on LAN card shows). */
function AddressForm({ onJoin }: { onJoin: (h: FoundHost) => void }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (!value.trim()) return;
    setBusy(true); setErr(null);
    try {
      const h = await hostHello(value.trim());
      if (h.outdated) setErr(`${addr(h)} runs an older Factory Archive. Update it on that PC first.`); else onJoin(h);
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go(); }}
          placeholder="192.168.1.20:7777" aria-label="Host address" style={field} />
        <Btn variant="solid" size="sm" disabled={busy || !value.trim()} onClick={go}>{busy ? 'Joining…' : 'Join'}</Btn>
      </div>
      {err && <div role="alert" style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--warn)' }}>{err}</div>}
    </div>
  );
}

/** Sidebar card in client mode: the host in use, and a way to pick another. */
export function ConnectCard() {
  const conn = useContext(Ctx);
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<FoundHost[] | null>(null);
  const [searching, setSearching] = useState(false);
  if (!conn) return null;
  const { host, join } = conn;
  const search = async () => {
    setSearching(true);
    setFound(await discoverHosts().catch(() => []));
    setSearching(false);
  };
  const link = { padding: 0, background: 'none', border: 'none', color: 'var(--text-mute)', fontSize: 10, textDecoration: 'underline' } as const;
  return (
    <div style={{ padding: '10px 11px', borderRadius: 'var(--r)', background: 'var(--panel)', border: '1px solid var(--accent-line)' }}>
      <div title={`Working on ${host.name || 'the host'}'s blueprints${host.version ? ` (Factory Archive v${host.version})` : ''}`}
        style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600 }}>
        <Dot />
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{host.name || 'Host'}</span>
      </div>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--text-mute)', marginTop: 5 }}>Connected · {addr(host)}</div>
      <div style={{ display: 'flex', gap: 10, marginTop: 7 }}>
        <button onClick={() => { setOpen(o => !o); if (!open) search(); }} aria-expanded={open} style={link}>Change host</button>
        {canHost && <button onClick={() => setAppMode('host')} style={link}>Use this PC as host</button>}
      </div>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 9 }}>
        {searching
          ? <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>Searching the network…</div>
          : found?.some(h => !h.outdated)
            ? found.filter(h => !h.outdated).map(h => <button key={h.url} onClick={() => { if (h.url !== host.url) join(h); setOpen(false); }}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '5px 7px', borderRadius: 5, textAlign: 'left',
                  background: h.url === host.url ? 'var(--accent-ghost)' : 'var(--well)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 11 }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name || 'Host'}</span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-mute)' }}>{addr(h)}</span></button>)
            : <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>No other host found.</div>}
        <AddressForm onJoin={h => { join(h); setOpen(false); }} />
      </div>}
    </div>
  );
}
