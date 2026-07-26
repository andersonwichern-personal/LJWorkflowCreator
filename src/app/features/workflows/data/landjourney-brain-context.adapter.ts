import {
  BrainContextSnapshot,
  ContextEntity,
  ContextProfileId,
  ContextRequest,
  ContextSearchRequest,
  ContextSearchResult,
  ContextSourceMeta,
  EntityResolutionRequest,
  EntityResolutionResult,
} from '../../../brain/context';
import { ContextCompilerInput, compileContext } from '../../../brain/contextCompiler';
import { HostCapabilityPort, WorkflowBrainContextProvider } from '../../../brain/ports';
import { staticVocabularySnapshot } from '../../../core/parserGrounding';
import { fuzzyMatches } from '../../../core/fuzzy';

/**
 * Landjourney-live context provider for the Workflow Brain.
 *
 * A PLAIN class on purpose — zero Angular imports — mirroring
 * standalone-brain-context.adapter.ts so the shared provider contract suite
 * (core-tests/assert-brain-context-contract.ts → runContextProviderContract)
 * and the transplant parity suite (core-tests/assert-brain-transplant-parity.ts)
 * can instantiate it directly under tsx with a mock transport.
 *
 * The ONLY seam to the host is {@link LiveContextTransport}. In the admin
 * monorepo the host wraps its authenticated ApiService (bearer +
 * x-organization headers, docs/workflow-brain-transplant-manifest.md) into
 * that interface; auth and tenancy live entirely on the host side of the seam.
 *
 * Fail-closed by construction:
 * - missing "live-vocabulary" capability ⇒ NO fetch is attempted; every
 *   registry is EMPTY and its source records version "unavailable";
 * - any single registry fetch failure degrades THAT registry to EMPTY
 *   (recorded as "unavailable") — the snapshot as a whole is never thrown
 *   away, and nothing ever falls back to demo data;
 * - an abort (caller's AbortSignal) is NOT a degradation: it propagates, so a
 *   cancelled caller never receives a hollow snapshot.
 *
 * No caching across tenantKeys by construction: the instance is per-tenant
 * (tenantKey is fixed at construction), so a tenant switch means a NEW
 * provider instance, which means a new snapshotId — cross-tenant reuse of
 * fetched vocabulary is impossible, not merely avoided.
 *
 * Labels fetched from the platform are UNTRUSTED tenant data: they are copied
 * into snapshot fields verbatim (pass-through), never interpolated into
 * paths, prompts, or anything executable.
 */

/**
 * The single host seam. In Angular composition the host wraps
 * `ApiService.get(...)` + `firstValueFrom` into this shape (see
 * {@link provideLandjourneyBrainContext}); tests substitute a deterministic
 * mock. `service` is the domain prefix the admin ApiService already speaks:
 * "workflows" | "documents" | "products" | "iam" | "data".
 */
export interface LiveContextTransport {
  get<T>(service: string, path: string, signal?: AbortSignal): Promise<T>;
}

/** One row of the correctable endpoint table below. */
export interface RegistryEndpoint {
  /** Context registry the rows land in (context.ts registry names). */
  registry: string;
  /** ApiService domain prefix. */
  service: 'workflows' | 'documents' | 'products' | 'iam' | 'data';
  /** Path under the service prefix (always starts with "/"). */
  path: string;
  /**
   * confirmed — the repo carries live evidence for this exact service+path;
   * presumed — the shape follows platform conventions but is unverified.
   * The manifest lists the evidence file for every row.
   */
  status: 'confirmed' | 'presumed';
}

/**
 * Registry → endpoint, in ONE place so the host can correct a presumed path
 * without touching adapter logic (docs/workflow-brain-transplant-manifest.md
 * carries the evidence trail; PRESUMED rows MUST be confirmed against the
 * real backend before live rollout).
 *
 * Notes on the presumed rows:
 * - users/retailers: the CONFIRMED live variants are org-scoped
 *   (`iam /organizations/{orgId}/users?...`, `.../retailers?...`, see
 *   vocabulary-chip.ts) and need an orgId lookup via `iam /users/me` first;
 *   the flat paths here are the presumed unscoped equivalents.
 * - stages: confirmed live derivation flattens `stages` out of
 *   `workflows /templates/{id}` detail responses; a flat listing is presumed.
 */
export const REGISTRY_ENDPOINTS: readonly RegistryEndpoint[] = [
  { registry: 'users', service: 'iam', path: '/users', status: 'presumed' },
  { registry: 'teams', service: 'iam', path: '/teams', status: 'presumed' },
  { registry: 'stages', service: 'workflows', path: '/stages', status: 'presumed' },
  { registry: 'templates', service: 'workflows', path: '/templates', status: 'confirmed' },
  { registry: 'forms', service: 'documents', path: '/templates/forms', status: 'confirmed' },
  { registry: 'fields', service: 'products', path: '/fields', status: 'confirmed' },
  { registry: 'authorities', service: 'iam', path: '/authorities', status: 'presumed' },
  { registry: 'retailers', service: 'iam', path: '/retailers', status: 'presumed' },
  { registry: 'programs', service: 'products', path: '/programs', status: 'presumed' },
];

/**
 * Registry → ParseOptions keys it feeds, derived from the vocabulary's scope
 * allocations (SCOPED_FIELDS/SCOPED_PARAMS instanceSource). Registries not
 * listed (teams, forms, fields, programs-as-entities) surface as entities
 * and/or assignees only. Keys absent from the live overlay deliberately fall
 * back to the static vocabulary inside the parser — per-key, never wholesale.
 */
const REGISTRY_PARSE_KEYS: Record<string, string[]> = {
  users: ['assign_user', 'notify', 'team_member'],
  retailers: ['retailer'],
  stages: ['stage', 'change_stage'],
  templates: ['template'],
  authorities: ['assign_authority'],
  programs: ['program'],
};

/** Registries whose labels are assignable people/teams. */
const ASSIGNEE_REGISTRIES = ['users', 'teams'];

export interface LandjourneyBrainContextDeps {
  transport: LiveContextTransport;
  /**
   * Opaque tenant partition key — the UI-configuration dnsPrefix the host
   * sends as `x-organization`. Fixed for the instance's lifetime.
   */
  tenantKey: string;
  /** Fail-closed gate: absent, or has("live-vocabulary") false ⇒ no fetches. */
  capabilities?: HostCapabilityPort;
}

/* -------------------------------------------------------------------------- */
/* Tolerant response mapping (defensive, deterministic, never inventing ids)  */
/* -------------------------------------------------------------------------- */

interface LiveEntry {
  id: string | null;
  label: string;
}

interface FetchedRegistry {
  endpoint: RegistryEndpoint;
  entries: LiveEntry[];
  /** API-provided version when present, else content-derived; "unavailable" on failure. */
  version: string;
  available: boolean;
}

const ROW_LIST_KEYS = ['items', 'rows', 'data', 'results', 'content'];

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Accept a bare array or a conventionally-wrapped one; anything else = no rows. */
function extractRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body !== null && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ROW_LIST_KEYS) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

/** {id,label} / {id,name} / {uuid,title} accepted; malformed rows are skipped. */
function mapEntry(row: unknown): LiveEntry | null {
  if (row === null || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const label =
    nonEmptyString(record['label']) ?? nonEmptyString(record['name']) ?? nonEmptyString(record['title']);
  if (label === null) return null; // no display label = unusable, never fabricated
  // An id the platform did not issue is a fabricated reference — null, never invented.
  const id = nonEmptyString(record['id']) ?? nonEmptyString(record['uuid']);
  return { id, label };
}

/** FNV-1a 32-bit, local — content-derived registry versions with no dependency. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function contentVersion(entries: LiveEntry[]): string {
  return `c-${fnv1a(JSON.stringify(entries)).toString(16).padStart(8, '0')}`;
}

/** A version the API stamped on the response envelope, when it did. */
function extractVersion(body: unknown): string | null {
  if (body === null || typeof body === 'object' === false || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  return nonEmptyString(record['version']) ?? nonEmptyString(record['etag']);
}

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export class LandjourneyBrainContextProvider implements WorkflowBrainContextProvider {
  readonly profile: ContextProfileId = 'landjourney-live';

  private readonly transport: LiveContextTransport;
  private readonly tenantKey: string;
  private readonly capabilities?: HostCapabilityPort;
  /** Raw input behind the LAST snapshot — search/resolveEntity operate on it. */
  private lastInput: ContextCompilerInput | null = null;

  constructor(deps: LandjourneyBrainContextDeps) {
    this.transport = deps.transport;
    this.tenantKey = deps.tenantKey;
    this.capabilities = deps.capabilities;
  }

  async getSnapshot(request: ContextRequest, signal?: AbortSignal): Promise<BrainContextSnapshot> {
    const input = await this.gatherInput(signal);
    this.lastInput = input;
    return compileContext(input, request);
  }

  async search(request: ContextSearchRequest, signal?: AbortSignal): Promise<ContextSearchResult> {
    const entities = await this.entitiesFor(signal);
    const limit = Math.max(0, request.limit ?? 20);
    const query = norm(request.query);
    const matches = entities.filter(
      (entity) =>
        entity.registry === request.registry &&
        (query === '' ||
          norm(entity.label).includes(query) ||
          (entity.aliases ?? []).some((alias) => norm(alias).includes(query)))
    );
    return { entities: matches.slice(0, limit), truncated: matches.length > limit };
  }

  async resolveEntity(
    request: EntityResolutionRequest,
    signal?: AbortSignal
  ): Promise<EntityResolutionResult> {
    const entities = await this.entitiesFor(signal);
    const inRegistry = entities.filter((entity) => entity.registry === request.registry);
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

  /* ---- gathering --------------------------------------------------------- */

  private async entitiesFor(signal?: AbortSignal): Promise<ContextEntity[]> {
    if (this.lastInput === null) this.lastInput = await this.gatherInput(signal);
    return this.lastInput.entities;
  }

  private async fetchRegistry(
    endpoint: RegistryEndpoint,
    signal?: AbortSignal
  ): Promise<FetchedRegistry> {
    // Capability check is fail-closed: no port, or the capability absent, means
    // the registry stays EMPTY — never a fetch "just to see".
    if (!(this.capabilities?.has('live-vocabulary') ?? false)) {
      return { endpoint, entries: [], version: 'unavailable', available: false };
    }
    try {
      const body = await this.transport.get<unknown>(endpoint.service, endpoint.path, signal);
      const entries = extractRows(body)
        .map(mapEntry)
        .filter((entry): entry is LiveEntry => entry !== null);
      return {
        endpoint,
        entries,
        version: extractVersion(body) ?? contentVersion(entries),
        available: true,
      };
    } catch (error) {
      // A caller's abort is a cancellation, not a degradation — propagate it.
      if (signal?.aborted) throw error;
      return { endpoint, entries: [], version: 'unavailable', available: false };
    }
  }

  private async gatherInput(signal?: AbortSignal): Promise<ContextCompilerInput> {
    const fetched = await Promise.all(
      REGISTRY_ENDPOINTS.map((endpoint) => this.fetchRegistry(endpoint, signal))
    );

    const entities: ContextEntity[] = [];
    const instanceOptions: Record<string, string[]> = {};
    const instanceRegistry: Record<string, { id: string; label: string }[]> = {};
    const assignees: string[] = [];
    const seenAssignees = new Set<string>();
    const sources: ContextSourceMeta[] = [];

    for (const registry of fetched) {
      const name = registry.endpoint.registry;
      sources.push({
        source: `${registry.endpoint.service}${registry.endpoint.path}`,
        // Informational only and pinned for determinism (identity never reads
        // it); hosts wanting real freshness stamps wrap the transport.
        fetchedAt: 0,
        version: registry.version,
      });

      for (const entry of registry.entries) {
        entities.push({
          registry: name,
          id: entry.id,
          label: entry.label, // untrusted tenant data — pass-through only
          confidence: 'verified',
          privacy: 'tenant-internal',
        });
      }

      if (ASSIGNEE_REGISTRIES.includes(name)) {
        for (const entry of registry.entries) {
          const key = norm(entry.label);
          if (seenAssignees.has(key)) continue;
          seenAssignees.add(key);
          assignees.push(entry.label);
        }
      }

      const parseKeys = REGISTRY_PARSE_KEYS[name] ?? [];
      if (registry.entries.length > 0) {
        const labels = [...new Set(registry.entries.map((entry) => entry.label))];
        const withIds = registry.entries
          .filter((entry): entry is LiveEntry & { id: string } => entry.id !== null)
          .map((entry) => ({ id: entry.id, label: entry.label }));
        for (const key of parseKeys) {
          instanceOptions[key] = [...labels];
          if (withIds.length > 0) instanceRegistry[key] = withIds.map((entry) => ({ ...entry }));
        }
      }
    }

    return {
      identity: { tenantKey: this.tenantKey },
      profile: this.profile,
      entities,
      // The live rules resource is PRESUMED and unconfirmed (README "Live
      // mode", workflows.service.ts) — an empty list is the honest answer.
      relatedWorkflows: [],
      instanceOptions,
      instanceRegistry,
      assignees,
      // The rule schema's action keys are platform vocabulary, mirrored from
      // the standalone adapter; host-side narrowing arrives via a future
      // authorization capability (manifest §capabilities), never invented here.
      allowedActionKeys: [...staticVocabularySnapshot().actions],
      sources,
    };
  }
}

/**
 * Thin factory the admin shell's DI override calls — the only composition
 * seam. Angular wiring (OUTSIDE this file, which stays Angular-free):
 *
 * ```ts
 * // admin shell composition root
 * {
 *   provide: WORKFLOW_BRAIN_CONTEXT,
 *   useFactory: () => {
 *     const api = inject(ApiService); // real admin ApiService: bearer + x-organization
 *     const config = inject(APP_CONFIG);
 *     return provideLandjourneyBrainContext({
 *       transport: {
 *         get: <T>(service: string, path: string) => firstValueFrom(api.get<T>(service, path)),
 *       },
 *       tenantKey: config.organization, // UI-configuration dnsPrefix
 *       capabilities: inject(BRAIN_CAPABILITIES),
 *     });
 *   },
 * }
 * ```
 *
 * A tenant switch constructs a NEW provider (new instance ⇒ new snapshotId);
 * the reducer's context-switched handling does the rest.
 */
export function provideLandjourneyBrainContext(
  deps: LandjourneyBrainContextDeps
): WorkflowBrainContextProvider {
  return new LandjourneyBrainContextProvider(deps);
}
