import { expect, test } from 'bun:test';
import { parseArgs } from 'node:util';
import { cliArgOptions } from './args';
import { rejectInvalidModelRebind, rejectModelOnContinue } from './dispatch-guards';

test('explicit rebind flags parse repeated tiers and require exact-ID resume with a reason', () => {
  const { values } = parseArgs({
    args: [
      '--rebind-model',
      'large=codex/grok-4.7',
      '--rebind-model',
      'medium=codex/grok-4.7',
      '--rebind-reason',
      'Owner selected Grok',
    ],
    options: cliArgOptions,
  });
  expect(values['rebind-model']).toEqual(['large=codex/grok-4.7', 'medium=codex/grok-4.7']);
  expect(
    rejectInvalidModelRebind('workflow', 'resume', values['rebind-model'], values['rebind-reason'])
  ).toBeUndefined();
  for (const subcommand of ['run', 'approve', 'reject', 'respond']) {
    expect(
      rejectInvalidModelRebind(
        'workflow',
        subcommand,
        values['rebind-model'],
        values['rebind-reason']
      )
    ).toContain('require workflow resume');
  }
  expect(rejectInvalidModelRebind('workflow', 'resume', undefined, 'reason')).toContain('nonempty');
  expect(rejectInvalidModelRebind('workflow', 'resume', values['rebind-model'], '')).toContain(
    'nonempty'
  );
  expect(rejectModelOnContinue('resume', ['large=codex/grok-4.7'])).toContain('cannot be used');
});
