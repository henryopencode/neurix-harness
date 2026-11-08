/** Model groups boot through the shipped dsh profile and real Loader. */
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { runLoaderSmoke, LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const overlay = fileURLToPath(new URL('./fixtures/cordis.yml', import.meta.url))

describe('model-group installed composition', () => {
  it.each([
    { name: 'model groups alone', bundles: ['@deepseek-ai/dsh-experimental-model-group'] },
    { name: 'teams before model groups', bundles: ['@deepseek-ai/dsh-experimental-agent-team-profile', '@deepseek-ai/dsh-experimental-model-group'] },
    { name: 'model groups before teams', bundles: ['@deepseek-ai/dsh-experimental-model-group', '@deepseek-ai/dsh-experimental-agent-team-profile'] },
  ])('delegates through $name without duplicate providers', async ({ bundles }) => {
    const result = await runLoaderSmoke({
      label: 'model-group headless profile', tempDirPrefix: 'model-group-loader-',
      binScript: join(root, 'apps/cli/src/bin.ts'), configPath: overlay,
      binArgs: ['--profile', 'headless', '--patch', overlay, 'Run both configured models and summarize their results.'],
      tsconfigPath: join(root, 'tsconfig.json'), sourceImport: 'tsx/esm',
      env: { DEEPSEEK_API_KEY: 'sk-model-group-keyless-fixture' },
      prepare: async (cwd) => {
        const profile = join(cwd, '.dsh', 'profiles', 'headless')
        await mkdir(profile, { recursive: true })
        await writeFile(join(profile, 'package.json'), JSON.stringify({
          name: 'model-group-composition-fixture', private: true,
          dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', ...bundles] } },
        }))
        await writeFile(join(profile, 'cordis.yml'), '[]\n')
        await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
      },
      inspect: async (cwd) => {
        const files = await readdir(join(cwd, '.sessions'), { recursive: true })
        const logs = await Promise.all(files.filter(file => file.endsWith('.jsonl')).map(file => readFile(join(cwd, '.sessions', file), 'utf8')))
        const combined = logs.join('\n')
        expect(combined).toContain('Result from worker-b')
        expect(combined).toContain('Result from worker-c')
        expect(combined).toContain('model-group/configured')
        expect(combined).toContain('model-group/post')
        expect(combined.match(/"type":"model-group\/post"/g)).toHaveLength(2)
        expect(combined).toContain('"status":"completed"')
      },
    })
    expect(result.stdout).toContain('Group complete: worker-b and worker-c.')
    expect(result.stderr).not.toContain('did not activate')
    expect(result.stderr).not.toContain('has been registered')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
