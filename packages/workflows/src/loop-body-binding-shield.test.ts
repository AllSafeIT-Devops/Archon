// Repro: the #2964 include-macro shield (a command node's own `with:` names are left
// as `$INPUTS.<name>` for the executor) is computed for the TOP-LEVEL node only. A
// command node inside an included block's loop_group body loses the shield, so the
// block's declared default ("") is spliced into its prompt at LOAD time.
import { describe, test, expect } from 'bun:test';
import { expandWorkflowIncludes } from './include-expander';
import { dagNodeSchema } from './schemas';
import { readComposedBindings } from './compiled-command';
import { applyLoopPrevToBodyNode } from './dag-executor';

const wf = (name: string, nodes: unknown[], inputs?: Record<string, unknown>) => ({
  name,
  description: name,
  nodes: nodes.map(n => dagNodeSchema.parse(n)),
  ...(inputs ? { inputs } : {}),
});
const prompt = (n: any) => (n?.source?.kind === 'inline' ? n.source.prompt : undefined);
const CMD = new Map([['ci', 'source=[$INPUTS.source]']]);

// Same shape as archon-deliver-block: `forge` top-level, `ci` reads it via with:,
// `source` declared with default "" (the workaround the YAML comment describes).
const ciNode = { id: 'ci', command: 'ci', with: { source: '$forge.output.source' } };
const forge = { id: 'forge', bash: 'echo {"source":"gh"}' };
const inputs = { source: { default: '' } };

describe('include-macro shield vs loop_group body', () => {
  test('control: top-level command node keeps $INPUTS.source for the executor', () => {
    const block = wf('blk', [forge, { ...ciNode, depends_on: ['forge'] }], inputs);
    const parent = wf('parent', [{ id: 'deliver', include: 'blk' }]);
    const { workflows, errors } = expandWorkflowIncludes(
      new Map([
        [block.name, block],
        [parent.name, parent],
      ]),
      CMD
    );
    expect(errors).toHaveLength(0);
    const ci = workflows.get('parent').nodes.find((n: any) => n.id === 'deliver__ci');
    console.log('top-level ci prompt :', JSON.stringify(prompt(ci)), readComposedBindings(ci));
    expect(prompt(ci)).toBe('source=[$INPUTS.source]');
  });

  test('bug: same node inside a loop_group body gets the block default spliced in', () => {
    const block = wf(
      'blk',
      [
        forge,
        {
          id: 'rounds',
          depends_on: ['forge'],
          loop_group: { max_iterations: 3, until_bash: 'true', nodes: [ciNode] },
        },
      ],
      inputs
    );
    const parent = wf('parent', [{ id: 'deliver', include: 'blk' }]);
    const { workflows, errors } = expandWorkflowIncludes(
      new Map([
        [block.name, block],
        [parent.name, parent],
      ]),
      CMD
    );
    expect(errors).toHaveLength(0);
    const rounds = workflows.get('parent').nodes.find((n: any) => n.id === 'deliver__rounds');
    const ci = rounds.loop_group.nodes.find((n: any) => n.id === 'ci');
    console.log('loop-body ci prompt :', JSON.stringify(prompt(ci)), readComposedBindings(ci));
    // Per-iteration prep never touches it: identical on iteration 1 and 2.
    const it1 = applyLoopPrevToBodyNode(ci, undefined, '');
    const it2 = applyLoopPrevToBodyNode(
      ci,
      new Map([['ci', { state: 'completed', output: 'x' }]]),
      ''
    );
    console.log('iteration 1 prompt  :', JSON.stringify(prompt(it1)));
    console.log('iteration 2 prompt  :', JSON.stringify(prompt(it2)));
    // Expected (what the top-level node gets). Before the fix the prompt was 'source=[]'.
    expect(prompt(ci)).toBe('source=[$INPUTS.source]');
  });
});
