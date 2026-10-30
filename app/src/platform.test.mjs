import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(readFileSync(new URL('./platform.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

for (const { name, desktop = true, web = false, windows = false, found = false, preferred = null, fail = false, host, client } of [
  { name: 'Mac with CrossOver hosts', found: true, host: true, client: false },
  { name: 'Mac without game data joins a host', host: false, client: true },
  { name: 'CrossOver respects client preference', found: true, preferred: 'client', host: true, client: true },
  { name: 'Windows hosts before first game launch', windows: true, host: true, client: false },
  { name: 'Windows respects client preference', windows: true, preferred: 'client', host: true, client: true },
  { name: 'failed Mac probe falls back to client', fail: true, host: false, client: true },
  { name: 'failed Windows probe keeps host available', windows: true, fail: true, host: true, client: false },
  { name: 'browser preview stays local', desktop: false, host: false, client: false },
  { name: 'share page stays remote', desktop: false, web: true, host: false, client: false },
]) {
  test(name, async () => {
    const exports = {};
    const calls = [];
    runInNewContext(source, {
      exports,
      require: id => id === '@tauri-apps/api/core'
        ? { isTauri: () => desktop, invoke: async cmd => {
            calls.push(cmd);
            if (fail) throw new Error('Probe failed');
            return [{ found }];
          } }
        : {},
      document: { querySelector: () => web },
      navigator: { userAgent: windows ? 'Windows' : 'Macintosh' },
      localStorage: { getItem: () => preferred },
      console: { error: () => {} },
    });
    await exports.initializePlatform();
    assert.equal(exports.canHost, host);
    assert.equal(exports.isClient, client);
    assert.equal(exports.remote, client || web);
    assert.equal(exports.appMode, client ? 'client' : 'host');
    assert.deepEqual(calls, desktop ? ['game_folders'] : []);
  });
}
