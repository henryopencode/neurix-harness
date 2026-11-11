/** Evaluate plugin dsh requirements (`engines.dsh`, else dsh peers) without importing plugin code. */

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

/** Unmet dsh requirements and the exact plugin/runtime exemption decision. */
export interface PluginCompatibility {
  name: string
  version: string
  runtimeVersion: string
  /** Declared official API version when the application's release sequence differs. */
  apiVersion?: string
  /** Only requirements the running dsh version does not satisfy: `engines.dsh`, or dsh peer package names. */
  requirements: Record<string, string>
  exempted: boolean
}

function objectOf(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function runtimeVersionOf(value: unknown, subject = 'dsh runtime version'): string {
  if (typeof value !== 'string' || semver.valid(value) === null) {
    throw new Error(`Invalid ${subject}: ${JSON.stringify(value)}; expected a semantic version`)
  }
  return value
}

function identityField(manifest: Record<string, unknown>, field: 'name' | 'version'): string {
  const value = Object.hasOwn(manifest, field) ? manifest[field] : undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Plugin manifest ${field} must be a non-empty string when dsh requirements are unmet`)
  }
  return value
}

/**
 * Read release and API versions from the manifest beside the running bundle.
 * @returns validated versions, preserving their exact spelling.
 * @throws when the manifest or a declared version is invalid.
 */
function readRuntimeVersions(): { version: string; apiVersion: string } {
  // The executable's virtual filesystem intercepts string paths, not URL arguments.
  const filename = fileURLToPath(new URL('../package.json', import.meta.url))
  const manifest = objectOf(JSON.parse(fs.readFileSync(filename, 'utf8')), 'app-boot package.json')
  const version = runtimeVersionOf(Object.hasOwn(manifest, 'version') ? manifest.version : undefined)
  const apiVersion = Object.hasOwn(manifest, 'dshApiVersion')
    ? runtimeVersionOf(manifest.dshApiVersion, 'dsh API compatibility version') : version
  return { version, apiVersion }
}

/**
 * Read the application's exact release version, independently of its official API baseline.
 * @returns Validated package version, including its prerelease or build suffix.
 * @throws When the manifest or either declared version is invalid.
 */
export function getDshRuntimeVersion(): string {
  return readRuntimeVersions().version
}

/**
 * Read the official API version declared by this installation for plugin requirements.
 * @returns `dshApiVersion`, or the package version when no separate baseline is declared.
 * @throws When the manifest or either declared version is invalid.
 */
export function getDshApiVersion(): string {
  return readRuntimeVersions().apiVersion
}

function satisfies(apiVersion: string, runtimeVersion: string, range: string): boolean {
  return range.trim() !== '' && (range === runtimeVersion || semver.satisfies(apiVersion, range, { includePrerelease: true }))
}

function unmetRequirements(fields: Record<string, unknown>, apiVersion: string, runtimeVersion: string): Record<string, string> {
  const engines = Object.hasOwn(fields, 'engines') ? objectOf(fields.engines, 'Plugin manifest engines') : {}
  if (Object.hasOwn(engines, 'dsh')) {
    const range = engines.dsh
    if (typeof range !== 'string') throw new Error('Plugin manifest engines.dsh must be a string')
    return satisfies(apiVersion, runtimeVersion, range) ? {} : { 'engines.dsh': range }
  }
  if (!Object.hasOwn(fields, 'peerDependencies')) return {}
  const dependencies = objectOf(fields.peerDependencies, 'Plugin manifest peerDependencies')
  const unmet: Record<string, string> = {}
  for (const [name, range] of Object.entries(dependencies)) {
    if (typeof range !== 'string') {
      throw new Error(`Plugin manifest peerDependencies[${JSON.stringify(name)}] must be a string`)
    }
    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
    const requirement = ['workspace:^', 'workspace:~', 'workspace:*'].includes(range) ? apiVersion : range
    if (!satisfies(apiVersion, runtimeVersion, requirement)) unmet[name] = range
  }
  return unmet
}

/**
 * Check plugin requirements against the official API baseline, also admitting exact distribution-release pins.
 * An own `engines.dsh` range decides alone and
 * peerDependencies are ignored; otherwise every @deepseek-ai/dsh or @deepseek-ai/dsh-* peer must match.
 * Prereleases participate in ranges. For peers only, workspace:^, workspace:~, and workspace:* refer to
 * the API baseline; other empty or invalid ranges, including any workspace: `engines.dsh`, are unmet.
 * @param manifest - parsed plugin package.json; inherited fields are ignored.
 * @param exemptions - exact plugin name@version keys mapped to exact runtime versions.
 * @param runtimeVersion - Runtime and API version for detached checks; omission resolves this installation's two versions.
 * @returns unmet requirements and exemption status, or undefined when every requirement is met.
 * @throws for malformed manifest engines or peer fields, invalid runtime versions, or missing identity on a mismatch.
 */
export function evaluatePluginCompatibility(
  manifest: object,
  exemptions: Readonly<Record<string, readonly string[]>> = {},
  runtimeVersion?: string,
): PluginCompatibility | undefined {
  const resolved = runtimeVersion === undefined ? readRuntimeVersions()
    : { version: runtimeVersionOf(runtimeVersion), apiVersion: runtimeVersion }
  runtimeVersion = resolved.version
  const fields = objectOf(manifest, 'Plugin manifest')
  const requirements = unmetRequirements(fields, resolved.apiVersion, runtimeVersion)
  if (Object.keys(requirements).length === 0) return undefined
  const name = identityField(fields, 'name')
  const version = identityField(fields, 'version')
  const key = `${name}@${version}`
  const exemptedVersions = Object.hasOwn(exemptions, key) ? exemptions[key] : undefined
  const exempted = exemptedVersions?.includes(runtimeVersion) === true
  return { name, version, runtimeVersion, requirements, exempted,
    ...(resolved.apiVersion === runtimeVersion ? {} : { apiVersion: resolved.apiVersion }) }
}

/**
 * Describe unmet requirements, their risk, and the exact-version remedy.
 * Surfaces with their own grant mechanism or locale render the structured result themselves.
 * @param issue - incompatible plugin/runtime result, including exempted mismatches.
 * @returns an English diagnostic for logs and stderr.
 */
export function pluginCompatibilityWarning(issue: PluginCompatibility): string {
  const key = `${issue.name}@${issue.version}`
  const runtime = `${issue.runtimeVersion}${issue.apiVersion === undefined ? '' : ` (official API ${issue.apiVersion})`}`
  return `Plugin ${key} is incompatible with dsh ${runtime}: requirements ${JSON.stringify(issue.requirements)}. `
    + 'Running it may cause crashes or data loss. '
    + 'Update the plugin or install a plugin version compatible with this dsh runtime. '
    + `To accept this risk explicitly, grant the exact-version exemption for ${key} on dsh ${issue.runtimeVersion} with \`dsh plugin allow-version\` or the plugin manager, then retry the installation or restart dsh. `
    + `Exact-version exemption: ${issue.exempted ? 'active' : 'not active'}.`
}
