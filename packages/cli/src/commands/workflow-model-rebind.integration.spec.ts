import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { removeTempTree } from '@archon/paths/test-utils';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await removeTempTree(root);
});

for (const detached of [false, true]) {
  test(`real CLI rebind preserves the run, completed nodes and subsequent models (detached=${String(detached)})`, () => {
    const root = mkdtempSync(join(tmpdir(), 'archon-model-rebind-'));
    roots.push(root);
    const repo = join(root, 'repo'),
      home = join(root, 'home');
    mkdirSync(join(repo, '.archon', 'workflows'), { recursive: true });
    mkdirSync(home);
    expect(spawnSync('git', ['init', '-q', '.'], { cwd: repo }).status).toBe(0);
    writeFileSync(
      join(repo, '.archon', 'workflows', 'rebind-test.yaml'),
      `name: rebind-test
description: Same run model-generation proof using deterministic nodes only
nodes:
  - id: prepared
    bash: echo prepared >> prepared.txt
  - id: repair
    depends_on: [prepared]
    bash: test -f ready
  - id: finish
    depends_on: [repair]
    bash: test -f finish
`
    );
    const cli = (args: string[]): SpawnSyncReturns<string> =>
      spawnSync(
        process.execPath,
        [join(import.meta.dir, '..', 'cli.ts'), 'workflow', ...args, '--cwd', repo],
        {
          encoding: 'utf8',
          env: { ...process.env, ARCHON_HOME: home, ARCHON_TELEMETRY_DISABLED: '1' },
          timeout: 30_000,
        }
      );
    const read = (): { id: string; status: string; metadata: Record<string, unknown> } => {
      const db = new Database(join(home, 'archon.db'), { readonly: true });
      db.exec('PRAGMA busy_timeout = 15000');
      try {
        const runs = db
          .query<
            { id: string; status: string; metadata: string },
            []
          >('SELECT id, status, metadata FROM remote_agent_workflow_runs')
          .all();
        expect(runs).toHaveLength(1);
        const run = runs[0];
        return { ...run, metadata: JSON.parse(run.metadata) as Record<string, unknown> };
      } finally {
        db.close();
      }
    };
    const initial = cli(['run', 'rebind-test', '--no-worktree']);
    expect(initial.status, initial.stderr).toBe(1);
    const before = read();
    expect(before.status).toBe('failed');
    writeFileSync(join(repo, 'ready'), 'yes');
    const rebound = cli([
      'resume',
      before.id,
      '--rebind-model',
      'large=codex/grok-4.7',
      '--rebind-model',
      'medium=codex/grok-4.7',
      '--rebind-model',
      'small=codex/grok-4.7',
      '--rebind-reason',
      'Owner selected Grok',
      ...(detached ? ['--detach', '--json'] : []),
    ]);
    expect(rebound.status, rebound.stderr).toBe(detached ? 0 : 1);
    if (detached) {
      expect(JSON.parse(rebound.stdout)).toMatchObject({
        ok: true,
        action: 'resume',
        runId: before.id,
        continues: true,
      });
      cli(['wait', before.id, '--timeout', '10', '--json']);
    }
    const after = read();
    expect(after.id).toBe(before.id);
    expect(after.metadata.ai_configuration).toEqual(before.metadata.ai_configuration);
    const generations = after.metadata.ai_configuration_generations as {
      completedNodes: string[];
      configuration: { modelOverrides: { tiers: Record<string, unknown> } };
    }[];
    expect(generations).toHaveLength(1);
    expect(generations[0].completedNodes).toContain('prepared');
    for (const tier of ['large', 'medium', 'small'])
      expect(generations[0].configuration.modelOverrides.tiers[tier]).toEqual({
        provider: 'codex',
        model: 'grok-4.7',
      });
    writeFileSync(join(repo, 'finish'), 'yes');
    const resumed = cli(['resume', before.id]);
    expect(resumed.status, resumed.stderr).toBe(0);
    const final = read();
    expect(final.id).toBe(before.id);
    expect(final.status).toBe('completed');
    expect(final.metadata.ai_configuration_generations).toEqual(generations);
    expect(readFileSync(join(repo, 'prepared.txt'), 'utf8')).toBe('prepared\n');
  }, 90_000);
}
