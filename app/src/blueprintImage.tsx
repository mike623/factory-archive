// blueprintImage.tsx — a blueprint's saved web-page picture, or the generated placeholder art
import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Blueprint } from './data';
import { Thumb } from './components';

const cache = new Map<string, Promise<string | null>>();

function load(key: string) {
  let p = cache.get(key);
  if (!p) {
    p = isTauri() ? invoke<string | null>('blueprint_image', { key }).catch(() => null) : Promise.resolve(null);
    cache.set(key, p);
  }
  return p;
}

export function useBlueprintImage(bp: Blueprint) {
  const [src, setSrc] = useState<string | null>(bp.imageUrl ?? null);
  useEffect(() => {
    if (bp.imageUrl) { setSrc(bp.imageUrl); return; }
    if (!bp.imageKey) { setSrc(null); return; }
    let live = true;
    load(bp.imageKey).then(s => { if (live) setSrc(s); });
    return () => { live = false; };
  }, [bp.imageKey, bp.imageUrl]);
  return src;
}

/** Fills its box: the real picture when there is one, otherwise the seeded placeholder. */
export function BlueprintImage({ bp, label = '' }: { bp: Blueprint; label?: string }) {
  const src = useBlueprintImage(bp);
  return src
    ? <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    : <Thumb hue={bp.hue} seed={bp.seed} label={label} />;
}
