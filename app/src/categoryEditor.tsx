// categoryEditor.tsx — change the game's blueprint categories outside the game.
// Changes queue up (previewed by the same code that writes them), then go into a NEW save next to the
// world's newest one. Existing saves are never touched, so they stay as the backup.
import { useCallback, useEffect, useState } from 'react';
import { Btn, IconBtn } from './components';
import { IcCheck, IcClose, IcLayers, IcPencil, IcPlus, IcTrash, IcWarn } from './icons';
import { categoryTree, editCategories, type CategoryEdit, type CategoryView } from './platform';

export function useCategoryEdits(root: string | null, session: string | null) {
  const [edits, setEdits] = useState<CategoryEdit[]>([]);
  const [view, setView] = useState<CategoryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // pending changes belong to one world; switching worlds starts over
  useEffect(() => { setEdits([]); setView(null); setError(null); }, [root, session]);

  const load = useCallback(() => {
    if (!root || !session) return;
    categoryTree(root, session, []).then(v => { setView(v); setError(null); }).catch(e => setError(String(e)));
  }, [root, session]);

  /** Queue a change. Rejects (and queues nothing) if it isn't valid, e.g. a name that's taken. */
  const add = useCallback(async (e: CategoryEdit) => {
    if (!root || !session) throw new Error('Pick a world session first');
    const next = [...edits, e];
    setView(await categoryTree(root, session, next));
    setEdits(next);
  }, [root, session, edits]);

  const discard = useCallback(() => { setEdits([]); load(); }, [load]);

  /** Write the queued changes as a new save; returns its file name. */
  const write = useCallback(async () => {
    if (!root || !session || !edits.length) throw new Error('Nothing to save');
    setBusy(true);
    try {
      const name = await editCategories(root, session, edits);
      setEdits([]);
      setView(await categoryTree(root, session, []));
      return name;
    } finally { setBusy(false); }
  }, [root, session, edits]);

  return { session, view, edits, error, busy, load, add, discard, write };
}
export type CategoryEditsState = ReturnType<typeof useCategoryEdits>;

/** blueprint name → [category, sub] from a category tree */
export function categoryOf(view: CategoryView[]): Map<string, [string, string]> {
  const m = new Map<string, [string, string]>();
  for (const c of view) for (const s of c.subs) for (const b of s.blueprints) if (!m.has(b)) m.set(b, [c.name, s.name]);
  return m;
}

const label = (name: string) => name || 'Undefined';
const field = {
  height: 28, padding: '0 9px', borderRadius: 'var(--r-sm)', background: 'var(--well)', border: '1px solid var(--border)',
  color: 'var(--text)', fontSize: 12.5, fontFamily: 'var(--font-display)', minWidth: 0,
} as const;

/** Text field that commits on Enter / blur and cancels on Escape. */
function NameInput({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  return <input autoFocus value={v} placeholder={placeholder} onChange={e => setV(e.target.value)}
    onKeyDown={e => { if (e.key === 'Enter') onDone(v.trim() || null); if (e.key === 'Escape') onDone(null); }}
    onBlur={() => onDone(v.trim() && v.trim() !== initial ? v.trim() : null)} style={{ ...field, flex: 1 }} />;
}

type Editing = { kind: 'cat' | 'sub' | 'newCat' | 'newSub'; cat: string; sub?: string } | null;

export function CategoryEditor({ open, onClose, cats, onWritten }: {
  open: boolean; onClose: () => void; cats: CategoryEditsState;
  /** after a new save was written: its file name */
  onWritten: (file: string) => void;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const [err, setErr] = useState<string | null>(null);
  const { view, edits, busy, load, add, discard, write } = cats;
  useEffect(() => { if (open && !edits.length) load(); setErr(null); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;

  const run = async (e: CategoryEdit | null) => {
    setEditing(null);
    if (!e) return;
    try { await add(e); setErr(null); } catch (x) { setErr(String(x).replace(/^Error: /, '')); }
  };
  const save = async () => {
    try { onWritten(await write()); setErr(null); } catch (x) { setErr(String(x).replace(/^Error: /, '')); }
  };
  const count = (c: CategoryView) => c.subs.reduce((n, s) => n + s.blueprints.length, 0);
  const rowBtn = { display: 'flex', gap: 2, marginLeft: 'auto', flexShrink: 0 } as const;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 45, background: 'rgba(5,6,8,.6)', display: 'flex', justifyContent: 'flex-end' }}>
      <div role="dialog" aria-modal="true" aria-labelledby="cat-title" onClick={e => e.stopPropagation()}
        style={{ width: 440, maxWidth: '100vw', height: '100%', background: 'var(--panel)', borderLeft: '1px solid var(--border-strong)',
          boxShadow: '-20px 0 60px -20px rgba(0,0,0,.7)', display: 'flex', flexDirection: 'column', animation: 'drawerin .22s var(--ease)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '17px 18px', borderBottom: '1px solid var(--border)' }}>
          <IcLayers size={18} style={{ color: 'var(--accent)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="cat-title" style={{ fontSize: 15.5, fontWeight: 700 }}>Edit categories</div>
            <div className="tlabel" style={{ fontSize: 9, marginTop: 2 }}>{cats.session ?? 'No world selected'}</div>
          </div>
          <IconBtn icon={IcClose} onClick={onClose} title="Close" />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
          {cats.error && <div role="alert" style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 10 }}>{cats.error}</div>}
          {view && view.length === 0 && !cats.error && <div style={{ fontSize: 12.5, color: 'var(--text-mute)', lineHeight: 1.5 }}>
            This world has no categories yet. Create one in the game's Blueprint menu first, then save.</div>}
          {view?.map(c => (
            <div key={c.name || '__undef__'} style={{ marginBottom: 10, borderRadius: 'var(--r)', border: '1px solid var(--border)', background: 'var(--bg-deep)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px 7px 11px', borderBottom: '1px solid var(--border-soft)' }}>
                {editing?.kind === 'cat' && editing.cat === c.name
                  ? <NameInput initial={c.name} placeholder="Category name" onDone={v => run(v ? { op: 'renameCategory', from: c.name, to: v } : null)} />
                  : <>
                      <span style={{ fontSize: 13, fontWeight: 600, fontStyle: c.name ? undefined : 'italic' }}>{label(c.name)}</span>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>{count(c)}</span>
                      {c.name && <span style={rowBtn}>
                        <IconBtn icon={IcPencil} size={13} title="Rename" onClick={() => setEditing({ kind: 'cat', cat: c.name })} />
                        <IconBtn icon={IcTrash} size={13} title="Delete (its blueprints go to Undefined)" onClick={() => run({ op: 'deleteCategory', name: c.name })} />
                      </span>}
                    </>}
              </div>
              <div style={{ padding: '4px 8px 6px 22px' }}>
                {c.subs.map(s => (
                  <div key={s.name || '__undef__'} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28 }}>
                    {editing?.kind === 'sub' && editing.cat === c.name && editing.sub === s.name
                      ? <NameInput initial={s.name} placeholder="Sub-category name" onDone={v => run(v ? { op: 'renameSub', category: c.name, from: s.name, to: v } : null)} />
                      : <>
                          <span style={{ fontSize: 12.5, color: 'var(--text-dim)', fontStyle: s.name ? undefined : 'italic' }}>{label(s.name)}</span>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>{s.blueprints.length}</span>
                          {s.name && <span style={rowBtn}>
                            <IconBtn icon={IcPencil} size={12} title="Rename" onClick={() => setEditing({ kind: 'sub', cat: c.name, sub: s.name })} />
                            <IconBtn icon={IcTrash} size={12} title="Delete (its blueprints go to Undefined)" onClick={() => run({ op: 'deleteSub', category: c.name, name: s.name })} />
                          </span>}
                        </>}
                  </div>
                ))}
                {editing?.kind === 'newSub' && editing.cat === c.name
                  ? <div style={{ display: 'flex', minHeight: 30 }}><NameInput initial="" placeholder="New sub-category" onDone={v => run(v ? { op: 'addSub', category: c.name, name: v } : null)} /></div>
                  : <button onClick={() => setEditing({ kind: 'newSub', cat: c.name })} style={{ display: 'flex', alignItems: 'center', gap: 5,
                      height: 26, padding: 0, background: 'none', border: 'none', color: 'var(--text-mute)', fontSize: 12 }}>
                      <IcPlus size={12} />Sub-category</button>}
              </div>
            </div>
          ))}
          {view && view.length > 0 && (editing?.kind === 'newCat'
            ? <div style={{ display: 'flex' }}><NameInput initial="" placeholder="New category" onDone={v => run(v ? { op: 'addCategory', name: v } : null)} /></div>
            : <Btn variant="ghost" size="sm" icon={IcPlus} onClick={() => setEditing({ kind: 'newCat', cat: '' })}>Category</Btn>)}
          {err && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: 'var(--warn)' }}>{err}</div>}
        </div>

        <div style={{ padding: '13px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-mute)' }}>
            <IcWarn size={14} style={{ flexShrink: 0, marginTop: 1, color: 'var(--warn)' }} />
            <span>Changes go into a <b>new save</b> next to this world's newest one; your existing saves aren't touched.
              Close the world in the game first, then load the new save.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 11, color: edits.length ? 'var(--accent)' : 'var(--text-mute)' }}>
              {edits.length ? `${edits.length} change${edits.length === 1 ? '' : 's'} not saved` : 'No changes'}</span>
            <div style={{ flex: 1 }} />
            <Btn variant="ghost" disabled={!edits.length || busy} onClick={discard}>Discard</Btn>
            <Btn variant="primary" icon={IcCheck} disabled={!edits.length || busy} onClick={save}>{busy ? 'Saving…' : 'Save as new save'}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Category › sub-category pickers for one blueprint; queues a move. */
export function MoveControl({ name, cats }: { name: string; cats: CategoryEditsState }) {
  const [err, setErr] = useState<string | null>(null);
  const { view, load } = cats;
  useEffect(() => { if (!view) load(); }, [view, load]);
  if (!view?.length) return null;
  const at = categoryOf(view).get(name) ?? ['', ''];
  const move = (category: string, sub: string) => cats.add({ op: 'move', blueprint: name, category, sub })
    .then(() => setErr(null), e => setErr(String(e).replace(/^Error: /, '')));
  const cat = view.find(c => c.name === at[0]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <select aria-label="Category" value={at[0]} style={{ ...field, flex: 1 }}
          onChange={e => { const c = view.find(x => x.name === e.target.value); if (c?.subs[0]) move(c.name, c.subs[0].name); }}>
          {view.map(c => <option key={c.name} value={c.name}>{label(c.name)}</option>)}
        </select>
        <select aria-label="Sub-category" value={at[1]} style={{ ...field, flex: 1 }} onChange={e => move(at[0], e.target.value)}>
          {(cat?.subs ?? []).map(s => <option key={s.name} value={s.name}>{label(s.name)}</option>)}
        </select>
      </div>
      {err && <div role="alert" style={{ fontSize: 11.5, color: 'var(--warn)' }}>{err}</div>}
    </div>
  );
}
