/** The installed Team bundle assigns responsibilities through distinct model routes. */
import { describe, expect, it } from 'vitest'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runLoaderSmoke, LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const overlay = fileURLToPath(new URL('./fixtures/models.overlay.yml', import.meta.url))

describe('Team model assignment through the installed bundle', () => {
  it('uses the normal Team tools and records role-attributed replies without a separate mode', async () => {
    const result = await runLoaderSmoke({
      label: 'model-aware Team profile', tempDirPrefix: 'team-models-profile-',
      binScript: join(root, 'apps/cli/src/bin.ts'), configPath: overlay,
      binArgs: ['--profile', 'headless', '--patch', overlay, 'Assign architecture review and evidence research to suitable models.'],
      tsconfigPath: join(root, 'tsconfig.json'), sourceImport: 'tsx/esm',
      prepare: async (cwd) => {
        const profile = join(cwd, '.dsh', 'profiles', 'headless')
        await mkdir(profile, { recursive: true })
        await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'team-profile-fixture', private: true,
          dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@deepseek-ai/dsh-experimental-agent-team-profile'] } } }))
        await writeFile(join(profile, 'cordis.yml'), '[]\n')
        await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
      },
      inspect: async (cwd) => {
        const files = await readdir(join(cwd, '.sessions'), { recursive: true })
        const logs = await Promise.all(files.filter(file => file.endsWith('.jsonl')).map(file => readFile(join(cwd, '.sessions', file), 'utf8')))
        const events = logs.flatMap(log => log.trim().split('\n').map(line => JSON.parse(line) as { type: string; data?: { member?: string; model?: string } }))
        const replies = events.filter(event => event.type === 'team/post').map(event => [event.data?.member, event.data?.model])
        expect(replies).toContainEqual(['reviewer', 'review-model'])
        expect(replies).toContainEqual(['researcher', 'research-model'])
        expect(events.some(event => event.type.startsWith('model-group/'))).toBe(false)
      },
    })
    expect(result.stderr).not.toContain('did not activate')
    expect(result.stdout).toContain('Team complete: reviewer and researcher used different models.')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
