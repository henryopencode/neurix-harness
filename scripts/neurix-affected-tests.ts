/** Select affected unit tests for Neurix development checks without repeating the full suite. */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Include changed source and owner-local tests; Vitest adds statically related consumers.
 * @param changed - repository-relative paths in the validated Git diff.
 * @param tracked - current repository files; deleted paths are absent.
 * @returns source and unit-test inputs for `vitest related`, with deterministic ordering.
 */
export function affectedUnitInputs(changed: readonly string[], tracked: readonly string[]): string[] {
  const files = new Set(tracked.map(path => path.replaceAll('\\', '/')))
  const tests = [...files].filter(path => /\.spec\.tsx?$/u.test(path))
  const selected = new Set<string>()
  for (const entry of changed) {
    const path = entry.replaceAll('\\', '/')
    if (path.startsWith('vendor/')) continue
    const owner = /^(packages\/[^/]+\/[^/]+|apps\/[^/]+)\//u.exec(path)?.[1]
    if (owner !== undefined) {
      for (const test of tests) if (test.startsWith(`${owner}/tests/`)) selected.add(test)
    }
    if (files.has(path) && /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/u.test(path) && !/\.(?:e2e|snapshot|bench)\./u.test(path)) {
      selected.add(path)
    }
  }
  return [...selected].sort()
}

/**
 * Run affected unit tests against an explicit, existing Git base.
 * @param base - PR base commit or development push's previous commit.
 * @returns the Vitest exit code, or zero for a diff without unit-test inputs.
 */
export function runAffectedUnitTests(base: string): number {
  if (!/^[0-9a-f]{40}$/u.test(base)) throw new Error('Affected tests require a complete Git base commit')
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean)
  const changed = git(['diff', '--name-only', '-z', base, 'HEAD'])
  const tracked = git(['ls-files', '-z'])
  const inputs = affectedUnitInputs(changed, tracked).filter(path => existsSync(path))
  if (inputs.length === 0) {
    console.log('Affected unit tests: no source or owner-local unit tests in this diff.')
    return 0
  }
  console.log(`Affected unit tests: ${inputs.length} source and test inputs from ${changed.length} changed paths.`)
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'related', '--run', ...inputs], { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.signal !== null) throw new Error(`Affected tests were interrupted by ${result.signal}`)
  return result.status ?? 1
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  process.exitCode = runAffectedUnitTests(process.argv[2] ?? '')
}
