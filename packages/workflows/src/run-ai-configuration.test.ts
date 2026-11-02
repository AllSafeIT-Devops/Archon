import { beforeAll, expect, test } from 'bun:test';
import { getRegisteredProviders, providerRegistry } from '@archon/providers';
import { registerBuiltinProviders, registerCommunityProviders } from '@archon/providers/in-process';
import { buildAiProfile } from './model-validation';
import {
  createRunAiConfigurationSnapshot,
  readRunAiConfigurationSnapshot,
  restoreRunAiConfigurationDefaults,
} from './run-ai-configuration';
import type { WorkflowConfig } from './deps';

beforeAll(() => {
  registerBuiltinProviders();
  registerCommunityProviders();
});

function config(): WorkflowConfig {
  return {
    assistant: 'claude',
    commands: {},
    assistants: {
      claude: { model: 'sonnet', settingSources: ['user'] },
      codex: {},
      pi: {
        model: 'openai/gpt',
        env: { API_KEY: 'secret' },
        maxConcurrent: 3,
        enableExtensions: false,
      },
    },
    envVars: { API_KEY: 'secret' },
    protectedCredentialValues: ['secret'],
  };
}

test('snapshot is an owned credential-free JSON record accepted by every provider run parser', () => {
  const current = config();
  const profile = buildAiProfile('claude', {
    repoAliases: { '@custom': { provider: 'claude', model: 'opus' } },
  });
  const snapshot = createRunAiConfigurationSnapshot(providerRegistry, current, profile, {});
  const restored = readRunAiConfigurationSnapshot(
    providerRegistry,
    JSON.parse(JSON.stringify({ ai_configuration: snapshot }))
  );
  expect(restored).toEqual(snapshot);
  expect(JSON.stringify(snapshot)).not.toContain('secret');
  expect(snapshot.assistants.pi).toEqual({ model: 'openai/gpt', enableExtensions: false });
  expect(snapshot.assistants.codex).toEqual({});
  for (const provider of getRegisteredProviders()) {
    expect(provider.parseConfig(snapshot.assistants[provider.id]!, 'run')).toEqual(
      snapshot.assistants[provider.id]
    );
  }
  current.assistants.claude.model = 'changed';
  profile.aliases['@custom']!.model = 'changed';
  expect(snapshot.assistants.claude).toEqual({ model: 'sonnet' });
  expect(snapshot.baseAiProfile.aliases['@custom']?.model).toBe('opus');
});

test('absence is legacy; malformed and unsupported snapshots fail without disclosing payloads', () => {
  expect(readRunAiConfigurationSnapshot(providerRegistry, {})).toBeUndefined();
  for (const value of [undefined, null, { version: 2, credential: 'secret' }]) {
    expect(() =>
      readRunAiConfigurationSnapshot(providerRegistry, { ai_configuration: value })
    ).toThrow('Invalid recorded run AI configuration.');
  }
  const snapshot = createRunAiConfigurationSnapshot(
    providerRegistry,
    config(),
    buildAiProfile('claude'),
    {}
  );
  for (const defaults of [
    { env: { API_KEY: 'secret' } },
    { maxConcurrent: 3 },
    { apiKey: 'secret' },
  ]) {
    expect(() =>
      readRunAiConfigurationSnapshot(providerRegistry, {
        ai_configuration: { ...snapshot, assistants: { ...snapshot.assistants, pi: defaults } },
      })
    ).toThrow('invalid provider defaults');
  }
});

test('saved AI omissions remain omissions while native and process settings refresh', () => {
  const snapshot = createRunAiConfigurationSnapshot(
    providerRegistry,
    { ...config(), assistants: { claude: {}, codex: {}, pi: {} } },
    buildAiProfile('claude'),
    {}
  );
  const current = config();
  restoreRunAiConfigurationDefaults(providerRegistry, current, snapshot);
  expect(current.assistants.claude).toEqual({ settingSources: ['user'] });
  expect(current.assistants.pi).toEqual({ env: { API_KEY: 'secret' }, maxConcurrent: 3 });
});

test('a recorded rebind selects its new generation without rewriting the original snapshot', () => {
  const original = createRunAiConfigurationSnapshot(
    providerRegistry,
    config(),
    buildAiProfile('claude'),
    {
      tiers: { large: { provider: 'claude', model: 'opus' } },
    }
  );
  const next = structuredClone(original);
  next.modelOverrides = { tiers: { large: { provider: 'codex', model: 'grok-4.7' } } };
  const metadata = {
    ai_configuration: original,
    ai_configuration_generations: [
      {
        at: '2026-11-02T11:00:00Z',
        reason: 'Owner selected Grok',
        completedNodes: ['triage'],
        configuration: next,
      },
    ],
  };
  expect(readRunAiConfigurationSnapshot(providerRegistry, metadata)).toEqual(next);
  expect(metadata.ai_configuration.modelOverrides.tiers?.large?.provider).toBe('claude');
  expect(metadata.ai_configuration_generations[0]!.completedNodes).toEqual(['triage']);
});

test('malformed rebind history fails closed rather than silently returning the original models', () => {
  const original = createRunAiConfigurationSnapshot(
    providerRegistry,
    config(),
    buildAiProfile('claude'),
    {}
  );
  for (const generations of [null, [], [{ reason: '' }]]) {
    expect(() =>
      readRunAiConfigurationSnapshot(providerRegistry, {
        ai_configuration: original,
        ai_configuration_generations: generations,
      })
    ).toThrow('Invalid recorded model rebind history');
  }
});
