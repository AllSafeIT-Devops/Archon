import { type ProviderRegistry, requireProvider } from '@archon/provider-contract';
import type { WorkflowConfig } from './deps';
import { z } from '@hono/zod-openapi';
import type { RunModelOverrides, RunModelBindingsMetadata } from './model-validation';
import {
  readRunModelBindingsMetadata,
  type ResolvedAiProfile,
  type ResolvedRunModelOverrides,
} from './model-validation';
import {
  runAiConfigurationSnapshotSchema,
  RUN_AI_CONFIGURATION_METADATA_KEY,
  type RunAiConfigurationSnapshot,
} from './schemas/run-ai-configuration';

export { RUN_AI_CONFIGURATION_METADATA_KEY } from './schemas/run-ai-configuration';

export interface ResumeModelRebind {
  overrides: RunModelOverrides;
  reason: string;
}

export const RUN_AI_GENERATIONS_METADATA_KEY = 'ai_configuration_generations';
const generationSchema = z
  .object({
    at: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(1),
    completedNodes: z.array(z.string().min(1)),
    configuration: runAiConfigurationSnapshotSchema,
  })
  .strict();

export function readRunAiGenerations(
  metadata: Record<string, unknown> | undefined
): z.infer<typeof generationSchema>[] {
  if (!metadata || !Object.hasOwn(metadata, RUN_AI_GENERATIONS_METADATA_KEY)) return [];
  const parsed = z
    .array(generationSchema)
    .min(1)
    .safeParse(metadata[RUN_AI_GENERATIONS_METADATA_KEY]);
  if (!parsed.success) throw new Error('Invalid recorded model rebind history.');
  return parsed.data;
}

export function modelRebindMetadata(
  metadata: Record<string, unknown>,
  configuration: RunAiConfigurationSnapshot,
  bindings: RunModelBindingsMetadata,
  completedNodes: readonly string[],
  reason: string,
  at = new Date().toISOString()
): Record<string, unknown> {
  const entry = generationSchema.parse({
    at,
    reason,
    completedNodes: [...completedNodes],
    configuration,
  });
  return {
    [RUN_AI_GENERATIONS_METADATA_KEY]: [...readRunAiGenerations(metadata), entry],
    initial_model_bindings: metadata.initial_model_bindings ?? metadata.model_bindings,
    model_bindings: bindings,
  };
}

export function createRunAiConfigurationSnapshot(
  providers: ProviderRegistry,
  config: WorkflowConfig,
  baseAiProfile: ResolvedAiProfile,
  modelOverrides: ResolvedRunModelOverrides
): RunAiConfigurationSnapshot {
  return structuredClone(
    runAiConfigurationSnapshotSchema.parse({
      version: 1,
      assistant: config.assistant,
      assistants: Object.fromEntries(
        providers
          .list()
          .map(provider => [
            provider.id,
            provider.parseConfig(config.assistants[provider.id] ?? {}, 'snapshot'),
          ])
      ),
      baseAiProfile,
      modelOverrides,
    })
  );
}

export function readRunAiConfigurationSnapshot(
  providers: ProviderRegistry,
  metadata: Record<string, unknown> | undefined
): RunAiConfigurationSnapshot | undefined {
  if (!metadata || !Object.hasOwn(metadata, RUN_AI_CONFIGURATION_METADATA_KEY)) return undefined;
  const original = runAiConfigurationSnapshotSchema.safeParse(
    metadata[RUN_AI_CONFIGURATION_METADATA_KEY]
  );
  if (!original.success) throw new Error('Invalid recorded run AI configuration.');
  const generation = readRunAiGenerations(metadata).at(-1);
  const parsed = runAiConfigurationSnapshotSchema.safeParse(
    generation?.configuration ?? original.data
  );
  if (!parsed.success) throw new Error('Invalid recorded run AI configuration.');
  try {
    readRunModelBindingsMetadata(providers, {
      model_bindings: {
        overrides: parsed.data.modelOverrides,
        effective: { defaultProvider: parsed.data.baseAiProfile.defaultProvider, aliases: {} },
      },
    });
    for (const [provider, defaults] of Object.entries(parsed.data.assistants)) {
      requireProvider(providers, provider).parseConfig(defaults, 'run');
    }
  } catch {
    throw new Error('Recorded run AI configuration has unavailable or invalid provider defaults.');
  }
  return parsed.data;
}

export function restoreRunAiConfigurationDefaults(
  providers: ProviderRegistry,
  config: WorkflowConfig,
  snapshot: RunAiConfigurationSnapshot
): void {
  const assistants: WorkflowConfig['assistants'] = { claude: {}, codex: {} };
  for (const [provider, saved] of Object.entries(snapshot.assistants)) {
    const registration = requireProvider(providers, provider);
    const current = registration.parseConfig(config.assistants[provider] ?? {}, 'install');
    const projected = registration.parseConfig(current, 'snapshot');
    const live = Object.fromEntries(
      Object.entries(current).filter(([key]) => !Object.hasOwn(projected, key))
    );
    assistants[provider] = { ...live, ...registration.parseConfig(saved, 'run') };
  }
  config.assistant = snapshot.assistant;
  config.assistants = assistants;
}
