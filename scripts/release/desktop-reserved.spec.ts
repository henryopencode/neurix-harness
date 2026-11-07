/** Existing reservations retain their source while qualification workflows evolve. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import yaml from 'js-yaml'
import { readReservedDesktopRelease } from './desktop-reserved.ts'

function fixture(timeout: number, version = '1.1.0') {
  const root = mkdtempSync(join(tmpdir(), 'neurix-reserved-release-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) })
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout }).trim()
  git('init', '--initial-branch=master')
  git('config', 'user.name', 'Reservation fixture')
  git('config', 'user.email', 'reservation@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('config', 'tag.gpgsign', 'false')
  git('config', 'core.autocrlf', 'false')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }) + '\n')
  git('add', '.')
  git('commit', '-m', 'Release source')
  const source = git('rev-parse', 'HEAD')
  git('commit', '--allow-empty', '-m', `Reservation\n\nNeurix-Release-Source: ${source}`)
  const commit = git('rev-parse', 'HEAD')
  git('tag', 'v1.1.0')
  git('tag', 'dsh-v1.1.0')
  git('update-ref', 'refs/remotes/origin/master', commit)
  return { root, git, source, commit }
}

describe('reserved Desktop packaging source', () => {
  it('resolves the original commit without changing tags or checkout files', ({ task }) => {
    const state = fixture(task.timeout)
    const refs = state.git('show-ref')
    expect(readReservedDesktopRelease(state.root, 'v1.1.0')).toEqual({ version: '1.1.0', tag: 'v1.1.0', commit: state.commit })
    expect(state.git('show-ref')).toBe(refs)
    expect(state.git('status', '--porcelain')).toBe('')
  })

  it.each(['master', 'v1.1.0-rc.1', 'v01.1.0', 'v1.1.0\nmaster'])('rejects nonstable or ambiguous input %j', (tag) => {
    expect(() => readReservedDesktopRelease('unused-release-fixture', tag)).toThrow('stable v-prefixed tag')
  })

  it('requires both tags to exist and identify the same commit', ({ task }) => {
    const state = fixture(task.timeout)
    state.git('tag', '-d', 'dsh-v1.1.0')
    expect(() => readReservedDesktopRelease(state.root, 'v1.1.0')).toThrow()
    state.git('tag', 'dsh-v1.1.0', state.source)
    expect(() => readReservedDesktopRelease(state.root, 'v1.1.0')).toThrow('different commits')
  })

  it('rejects a tag that disagrees with the packaged version', ({ task }) => {
    const state = fixture(task.timeout, '1.1.1')
    expect(() => readReservedDesktopRelease(state.root, 'v1.1.0')).toThrow('manifest version')
  })

  it('requires reservation metadata and master ancestry', ({ task }) => {
    const state = fixture(task.timeout)
    state.git('update-ref', 'refs/remotes/origin/master', state.source)
    expect(() => readReservedDesktopRelease(state.root, 'v1.1.0')).toThrow()
    state.git('tag', '-d', 'v1.1.0', 'dsh-v1.1.0')
    state.git('tag', 'v1.1.0', state.source)
    state.git('tag', 'dsh-v1.1.0', state.source)
    expect(() => readReservedDesktopRelease(state.root, 'v1.1.0')).toThrow('reservation source')
  })

  it('rejects a reservation that names an unrelated source commit', ({ task }) => {
    const state = fixture(task.timeout)
    state.git('checkout', '--orphan', 'unrelated')
    state.git('commit', '-m', 'Unrelated source')
    const unrelated = state.git('rev-parse', 'HEAD')
    state.git('checkout', 'master')
    state.git('commit', '--allow-empty', '-m', `Reservation\n\nNeurix-Release-Source: ${unrelated}`)
    state.git('tag', '-d', 'v1.1.0', 'dsh-v1.1.0')
    state.git('tag', 'v1.1.0')
    state.git('tag', 'dsh-v1.1.0')
    state.git('update-ref', 'refs/remotes/origin/master', state.git('rev-parse', 'HEAD'))
    expect(() => readReservedDesktopRelease(state.root, 'v1.1.0')).toThrow()
  })
})

it('keeps reserved builds on their tag while updating only post-build qualification tests', () => {
  const text = readFileSync(new URL('../../.github/workflows/neurix-desktop-release.yml', import.meta.url), 'utf8')
  const workflow = yaml.load(text) as {
    on: { workflow_dispatch: { inputs: Record<string, unknown> } }
    jobs: {
      version: { if: string; outputs: Record<string, string> }
      package: { steps: { name?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown> }[] }
    }
  }
  expect(workflow.on.workflow_dispatch.inputs).toHaveProperty('existing_tag')
  expect(workflow.jobs.version.if).toContain("inputs.validation_only || github.ref == 'refs/heads/master'")
  expect(workflow.jobs.version.outputs.commit).toContain('steps.reserved.outputs.commit')
  const steps = workflow.jobs.package.steps
  expect(steps[0]?.with?.ref).toBe('${{ needs.version.outputs.commit }}')
  const build = steps.findIndex(step => step.name === 'Build and verify installer')
  const harness = steps.findIndex(step => step.name === 'Use the current reservation fixture after packaging')
  const verify = steps.findIndex(step => step.name === 'Verify update discovery, transfers and installation handoff')
  expect(build).toBeGreaterThan(-1)
  expect(harness).toBeGreaterThan(build)
  expect(verify).toBeGreaterThan(harness)
  expect(steps[build]?.env?.NODE_OPTIONS).toContain('--max-old-space-size=4096')
  expect(steps[harness]?.if).toContain("inputs.existing_tag != ''")
})
