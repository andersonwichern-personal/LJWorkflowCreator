import {
  BrainContextSnapshot,
  ContextEntity,
  ContextProfileId,
  ContextRequest,
  ContextSearchRequest,
  ContextSearchResult,
  EntityResolutionRequest,
  EntityResolutionResult,
} from '../../../brain/context';
import { ContextCompilerInput, compileContext } from '../../../brain/contextCompiler';
import { WorkflowBrainContextProvider } from '../../../brain/ports';
import { staticVocabularySnapshot } from '../../../core/parserGrounding';
import { fuzzyMatches } from '../../../core/fuzzy';

/**
 * Standalone-demo context provider for the Workflow Brain.
 *
 * A PLAIN class on purpose — zero Angular imports — so the shared provider
 * contract suite (core-tests/assert-brain-context-contract.ts →
 * runContextProviderContract) can instantiate it directly under tsx. Angular
 * resolves it through the WORKFLOW_BRAIN_CONTEXT injection token
 * (workflow-brain-context.token.ts), whose factory calls
 * {@link provideStandaloneBrainContext}.
 *
 * Everything is derived from the SAME source the composer's deterministic
 * parser already runs on with no live credentials: the static vocabulary
 * (staticVocabularySnapshot — ASSIGNEES, option-bearing field options, action
 * paramOptions). The composer's parseOpts() passes no assignees/
 * instanceOptions/instanceRegistry, so parseInstruction falls back to exactly
 * this static vocabulary; the snapshot this provider compiles projects back to
 * the identical parser inputs via snapshotToParseOptions. Deterministic by
 * construction (fetchedAt pinned to 0, compileContext is pure), zero
 * credentials, zero network.
 */

const STANDALONE_TENANT_KEY = 'standalone-demo';

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Static-vocabulary projection into ranked/searchable entities. */
function buildEntities(vocab: ReturnType<typeof staticVocabularySnapshot>): ContextEntity[] {
  const entities: ContextEntity[] = [];
  // Demo people and teams (the parser's assignee fallback list).
  for (const assignee of vocab.assignees) {
    entities.push({
      registry: assignee.includes('Team') ? 'teams' : 'users',
      id: null,
      label: assignee,
      confidence: 'verified',
      privacy: 'tenant-internal',
    });
  }
  // Option labels per field/action key — the same lists the parser grounds on.
  for (const key of Object.keys(vocab.instanceOptions).sort()) {
    for (const option of vocab.instanceOptions[key]) {
      entities.push({
        registry: key,
        id: null,
        label: option,
        confidence: 'verified',
        privacy: 'public-vocabulary',
      });
    }
  }
  return entities;
}

/** The raw compiler input, built once from static data — no clock, no I/O. */
function buildStandaloneInput(): ContextCompilerInput {
  const vocab = staticVocabularySnapshot();
  const instanceOptions: Record<string, string[]> = {};
  for (const key of Object.keys(vocab.instanceOptions)) {
    instanceOptions[key] = [...vocab.instanceOptions[key]];
  }
  return {
    identity: {
      tenantKey: STANDALONE_TENANT_KEY,
      organizationLabel: 'SweetTech Standalone Demo',
    },
    profile: 'standalone-demo',
    entities: buildEntities(vocab),
    // The standalone workspace has no live workflow registry to compare
    // against; an empty list is the honest answer, never a fabricated one.
    relatedWorkflows: [],
    instanceOptions,
    // The static vocabulary carries no platform ids, so nothing can pretend to.
    instanceRegistry: {},
    assignees: [...vocab.assignees],
    allowedActionKeys: [...vocab.actions],
    sources: [{ source: 'static-vocabulary', fetchedAt: 0, version: vocab.version }],
  };
}

export class StandaloneBrainContextProvider implements WorkflowBrainContextProvider {
  readonly profile: ContextProfileId = 'standalone-demo';

  private readonly input: ContextCompilerInput = buildStandaloneInput();

  async getSnapshot(request: ContextRequest): Promise<BrainContextSnapshot> {
    return compileContext(this.input, request);
  }

  async search(request: ContextSearchRequest): Promise<ContextSearchResult> {
    const limit = Math.max(0, request.limit ?? 20);
    const query = norm(request.query);
    const matches = this.input.entities.filter(
      (entity) =>
        entity.registry === request.registry &&
        (query === '' ||
          norm(entity.label).includes(query) ||
          (entity.aliases ?? []).some((alias) => norm(alias).includes(query)))
    );
    return { entities: matches.slice(0, limit), truncated: matches.length > limit };
  }

  async resolveEntity(request: EntityResolutionRequest): Promise<EntityResolutionResult> {
    const inRegistry = this.input.entities.filter(
      (entity) => entity.registry === request.registry
    );
    const text = norm(request.text);
    const exact = inRegistry.filter((entity) => norm(entity.label) === text);
    if (exact.length > 1) return { kind: 'duplicate', candidates: exact };
    if (exact.length === 1) return { kind: 'exact', entity: exact[0] };
    for (const entity of inRegistry) {
      const alias = (entity.aliases ?? []).find((candidate) => norm(candidate) === text);
      if (alias !== undefined) return { kind: 'alias', entity, alias };
    }
    // Fuzzy candidates are SUGGESTIONS, never automatic substitutions.
    const labels = fuzzyMatches(
      request.text,
      inRegistry.map((entity) => entity.label)
    );
    if (labels.length > 0) {
      const candidates = labels
        .map((label) => inRegistry.find((entity) => entity.label === label))
        .filter((entity): entity is ContextEntity => !!entity);
      return { kind: 'suggestions', candidates };
    }
    return { kind: 'unknown' };
  }
}

/** Thin factory the Angular injection token calls — the only composition seam. */
export function provideStandaloneBrainContext(): WorkflowBrainContextProvider {
  return new StandaloneBrainContextProvider();
}
