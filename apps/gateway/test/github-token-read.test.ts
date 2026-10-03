import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { githubMcpTokenCommand, githubMcpTokenRead } from '../src/github-token-read.js';

test('fixed gateway reader returns only the configured GitHub-bot MCP token', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'github-token-reader-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const directory = join(base, 'services/github/data');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const registry = join(directory, 'registry.json');
  const token = 'github_pat_' + 'a'.repeat(50);
  writeFileSync(registry, JSON.stringify({ plugins: { 'vectra-github': { config: { 'github-token': token } }, other: { config: { 'github-token': 'do-not-show' } } } }), { mode: 0o600 });
  const script = githubMcpTokenRead.replace("base = pathlib.Path('/var/lib/superagent/plugin-control')", `base = pathlib.Path(${JSON.stringify(base)})`)
    .replace("if os.geteuid() != 0: raise SystemExit('Privileged credential access required')", '')
    .replaceAll('info.st_uid != 0', 'info.st_uid != os.geteuid()');
  const run = () => spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { token });
  assert.equal(result.stderr.includes(token), false);
  assert.doesNotMatch(githubMcpTokenCommand(), /workspace|home\/user/);
  chmodSync(registry, 0o644);
  assert.notEqual(run().status, 0);
  rmSync(registry);
  const decoy = join(base, 'decoy.json');
  writeFileSync(decoy, JSON.stringify({ plugins: { 'vectra-github': { config: { 'github-token': token } } } }));
  symlinkSync(decoy, registry);
  assert.notEqual(run().status, 0);
});
