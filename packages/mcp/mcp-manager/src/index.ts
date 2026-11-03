/** Global MCP configuration and connection management for authenticated Clients. @module */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { isJsExpr, type Entry, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { composeEntries, readProfilePatches, reconcileProfilePatches } from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { Config as McpConfigSchema, type Config as McpConfig } from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-mcp-resources'
import type {} from '@deepseek-ai/dsh-hmr'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { declaration, editableRow, parsePatch, readPatch, removeDeclaration, revision } from './document.ts'
import type { McpManagerSnapshot, McpServerDraft, McpServerId } from './types.ts'

export type * from './types.ts'

const MCP = '@deepseek-ai/dsh-mcp-client'

/** Interval between connection snapshots while the management page is open. */
export interface Config {
  /** Interval between connection snapshots while the management page is open. */
  readonly refreshIntervalMs: number
}

function hasExpression(value: unknown): boolean {
  if (isJsExpr(value)) return true
  return value !== null && typeof value === 'object' && Object.values(value).some(hasExpression)
}

function flatten(rows: EntryOptions[]): EntryOptions[] {
  return rows.flatMap(row => [row, ...row.group && Array.isArray(row.config) ? flatten(row.config as EntryOptions[]) : []])
}

/** Credential-free editing fields for a literal MCP declaration. */
function draftOf(entry: Entry): McpServerDraft {
  const config = (entry.options.config ?? {}) as Partial<McpConfig>
  return {
    serverName: config.serverName ?? entry.options.id,
    transport: config.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    command: 'command' in config ? config.command ?? '' : '',
    args: 'args' in config ? config.args ?? [] : [],
    cwd: 'cwd' in config ? config.cwd ?? '' : '',
    url: 'url' in config ? config.url ?? '' : '',
  }
}

/** Owns machine-wide MCP edits; failed reloads restore the prior file and composition. */
export default class McpManager extends TypertRemoteService {
  static inject = ['loader', 'mcpResources']
  static Config: Schema<Partial<Config>, Config> = Schema.object({
    refreshIntervalMs: Schema.natural().min(100).max(2 ** 31 - 1).default(1000),
  })
  private tail: Promise<void> = Promise.resolve()
  private stopped = false
  private recoveryRequired = false
  private readonly lifetime = new AbortController()

  constructor(private readonly owner: Context, private readonly config: Config) {
    super(owner, 'mcpManager')
    owner.effect(() => async () => { this.stopped = true; this.lifetime.abort(); await this.tail }, 'mcp-manager: pending edits')
  }

  private entries(): Entry[] {
    return [...this.owner.loader.entries()].filter(entry => entry.options.name === MCP
      && entry.parent.tree.ctx.fiber.entry?.id === 'include')
  }

  private get path(): string | undefined {
    const profile = this.owner.get('profileContext')
    return profile === undefined ? undefined : join(profile.home, 'cordis.patch.yml')
  }

  private currentRevision(text: string): string {
    const profile = this.owner.get('profileContext')
    const declarations = profile === undefined ? []
      : flatten(composeEntries([readProfilePatches('dsh', profile)])).filter(row => row.name === MCP)
    return revision(text, declarations)
  }

  /** Read global MCP connections and credential-free editing fields.
   * @returns effective connections and an optimistic configuration revision.
   */
  @Remote
  async list(): Promise<McpManagerSnapshot> {
    const snapshot = this.tail.then(() => this.snapshot())
    this.tail = snapshot.then(() => undefined, () => undefined)
    return await snapshot
  }

  private async snapshot(): Promise<McpManagerSnapshot> {
    const text = this.path === undefined ? '[]\n' : await readPatch(this.path)
    const document = parsePatch(text)
    return {
      revision: this.currentRevision(text), writable: this.path !== undefined && !this.recoveryRequired,
      recoveryRequired: this.recoveryRequired,
      servers: this.entries().map((entry) => {
        const draft = draftOf(entry)
        const editable = !hasExpression(entry.options.config)
        return {
          id: entry.id as McpServerId, serverName: editable ? draft.serverName : entry.options.id,
          enabled: !entry.disabled, editable,
          removable: declaration(document, entry.options.id) !== undefined,
          connection: editable ? this.owner.mcpResources.inspect(draft.serverName) : null,
          draft: editable ? draft : { serverName: entry.options.id, transport: 'stdio', command: '', args: [], cwd: '', url: '' },
        }
      }),
    }
  }

  /** Follow connection and configuration changes while the page is open.
   * @param signal - cancellation owned by the Client resource subscription.
   * @returns distinct connection snapshots until cancellation or service disposal.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<McpManagerSnapshot> {
    const lifetime = AbortSignal.any([signal, this.lifetime.signal])
    let previous = ''
    while (!lifetime.aborted) {
      const snapshot = await this.list()
      const current = JSON.stringify(snapshot)
      if (current !== previous) { previous = current; yield snapshot }
      try { await delay(this.config.refreshIntervalMs, undefined, { signal: lifetime }) }
      catch (error) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- the signal can abort while the delay is awaited.
        if (!lifetime.aborted) throw error
      }
    }
  }

  /** Add or replace a literal MCP configuration, retaining omitted credentials and advanced options.
   * @param id - existing server identity, or null to add a machine-wide server.
   * @param draft - validated connection fields; credentials are never returned.
   * @param expectedRevision - revision from the list that opened the form.
   * @returns fulfillment after persistence and Loader reconciliation.
   */
  @Remote
  async save(id: McpServerId | null, draft: McpServerDraft, expectedRevision: string): Promise<void> {
    await this.change(expectedRevision, (document) => {
      const entry = id === null ? undefined : this.requireEntry(id)
      if (entry !== undefined && hasExpression(entry.options.config)) throw new RemoteError('mcp/expression', 'Edit expression-backed connections in the configuration file', {})
      const current = (entry?.options.config ?? {}) as Record<string, unknown>
      const next = draft.transport === 'stdio'
        ? { ...current, serverName: draft.serverName, transport: draft.transport, command: draft.command, args: draft.args, cwd: draft.cwd }
        : { ...current, serverName: draft.serverName, transport: draft.transport, url: draft.url }
      const fields: Record<string, unknown> = next
      if (draft.transport === 'stdio') {
        delete fields.url; delete fields.headers
        if (draft.credentials !== undefined) fields.env = draft.credentials
      } else {
        delete fields.command; delete fields.args; delete fields.cwd; delete fields.env
        if (draft.credentials !== undefined) fields.headers = draft.credentials
      }
      // Config normalization mutates collections; Remote inputs contain frozen readonly fields.
      try { McpConfigSchema(structuredClone(next)) }
      catch (_invalidConfig) { throw new RemoteError('mcp/invalid-config', 'Check the server name and transport settings', {}) }
      if (draft.transport === 'stdio' && !draft.command.trim()) throw new RemoteError('mcp/invalid-config', 'Enter a server command', {})
      if (draft.transport === 'streamable-http') {
        let url: URL
        try { url = new URL(draft.url) }
        catch (_invalidUrl) { throw new RemoteError('mcp/invalid-config', 'Enter an HTTP or HTTPS MCP endpoint', {}) }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new RemoteError('mcp/invalid-config', 'Enter an HTTP or HTTPS endpoint without embedded credentials', {})
      }
      if (this.entries().some(row => row !== entry && draftOf(row).serverName === draft.serverName)) throw new RemoteError('mcp/duplicate', 'Choose a unique server name', {})
      const patchId = entry?.options.id ?? `mcp-${randomUUID()}`
      const owned = editableRow(document, patchId)
      if (owned !== undefined) owned.set('config', document.createNode(next))
      else if (entry === undefined) document.add({ insert: [{ id: patchId, name: MCP, config: next }] })
      else document.add({ id: patchId, name: MCP, config: next })
      return { id: patchId, config: next }
    })
  }

  /** Persist enablement without changing the connection's other configuration.
   * @param id - existing global server.
   * @param enabled - requested enablement.
   * @param expectedRevision - current configuration revision.
   * @returns fulfillment after the Loader applies the change.
   */
  @Remote
  async setEnabled(id: McpServerId, enabled: boolean, expectedRevision: string): Promise<void> {
    await this.change(expectedRevision, (document) => {
      const entry = this.requireEntry(id)
      const owned = editableRow(document, entry.options.id)
      if (owned === undefined) document.add({ id: entry.options.id, name: MCP, disabled: !enabled })
      else owned.set('disabled', !enabled)
      return { id: entry.options.id, enabled }
    })
  }

  /** Remove a server declared in the global user patch; inherited servers can only be disabled.
   * @param id - existing global server.
   * @param expectedRevision - current configuration revision.
   * @returns fulfillment after its connection has been released.
   */
  @Remote
  async removeServer(id: McpServerId, expectedRevision: string): Promise<void> {
    await this.change(expectedRevision, (document) => {
      const entry = this.requireEntry(id)
      if (declaration(document, entry.options.id) === undefined) throw new RemoteError('mcp/inherited', 'Disable servers supplied by deployment configuration', {})
      removeDeclaration(document, entry.options.id)
      return { id: entry.options.id, removed: true }
    })
  }

  /** Close an enabled server before starting its replacement connection.
   * @param id - server to reconnect.
   * @returns fulfillment after the replacement plugin's initial connection attempt settles.
   */
  @Remote
  async reconnect(id: McpServerId): Promise<void> {
    await this.exclusive(async () => {
      const entry = this.requireEntry(id)
      if (entry.disabled) throw new RemoteError('mcp/disabled', 'Enable the server before reconnecting', {})
      await entry.fiber?.dispose()
      await entry.refresh()
    })
  }

  private requireEntry(id: McpServerId): Entry {
    const entry = this.entries().find(entry => entry.id === id)
    if (entry === undefined) throw new RemoteError('mcp/not-found', 'Refresh the server list', {})
    return entry
  }

  private async exclusive(operation: () => Promise<void>): Promise<void> {
    const run = this.tail.then(async () => {
      if (this.stopped || this.recoveryRequired) throw new RemoteError('mcp/unavailable', 'Check the configuration and restart the application', {})
      const hmr = this.owner.get('hmr')
      await (hmr === undefined ? operation() : hmr.runExclusive(operation))
    })
    this.tail = run.catch(() => { /* The requesting Remote call reports the failure. */ })
    await run
  }

  private async change(expectedRevision: string, edit: (document: ReturnType<typeof parsePatch>) => {
    id: string
    config?: Record<string, unknown>
    enabled?: boolean
    removed?: boolean
  }): Promise<void> {
    await this.exclusive(async () => {
      const profile = this.owner.get('profileContext')
      const path = this.path
      if (profile === undefined || path === undefined) throw new RemoteError('mcp/read-only', 'This deployment has no editable profile', {})
      await withFileLock(path, async () => {
        const before = await readPatch(path)
        if (this.currentRevision(before) !== expectedRevision) throw new RemoteError('mcp/conflict', 'Refresh the list before saving these changes', {})
        const previousPatches = readProfilePatches('dsh', profile)
        const document = parsePatch(before)
        const expected = edit(document)
        await writeFileAtomic(path, String(document), { mode: 0o600 })
        try {
          const patches = readProfilePatches('dsh', profile)
          const effective = flatten(composeEntries([patches])).find(row => row.id === expected.id)
          if ((expected.removed && effective !== undefined)
            || (expected.config !== undefined && !isDeepStrictEqual(effective?.config, expected.config))
            || (expected.enabled !== undefined && Boolean(effective?.disabled) === expected.enabled)) {
            throw new RemoteError('mcp/overridden', 'A later deployment overlay overrides this server', {})
          }
          await reconcileProfilePatches(this.owner.root, patches, 'dsh', expected.removed ? [] : [expected.id])
        } catch (error) {
          try {
            await writeFileAtomic(path, before, { mode: 0o600 })
            await reconcileProfilePatches(this.owner.root, previousPatches, 'dsh')
          } catch (rollbackError) {
            this.recoveryRequired = true
            this.owner.logger.error('MCP configuration recovery failed; check the global patch and restart', rollbackError)
            throw new RemoteError('mcp/recovery-required', 'Check the global configuration and restart the application', {}, { cause: rollbackError })
          }
          if (error instanceof RemoteError) throw error
          this.owner.logger.warn('MCP configuration was restored after a reload failure', error)
          throw new RemoteError('mcp/reload-failed', 'The previous configuration was restored; check the server settings and retry', {}, { cause: error })
        }
      })
    })
  }
}
