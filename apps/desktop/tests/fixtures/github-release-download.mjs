/** Download real published bytes with the production updater; installer execution is intercepted. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { GithubReleaseDownloads } from '../../lib/types/github-release-downloads.js'
import { GithubReleaseRequests } from '../../lib/types/github-release-requests.js'

const evidence = fileURLToPath(new URL('../../.desktop-build/qualification/', import.meta.url))
mkdirSync(evidence, { recursive: true })
const root = mkdtempSync(join(evidence, 'github-release-download-'))
app.setPath('userData', join(root, 'profile'))

async function main() {
  await app.whenReady()
  const transport = new GithubReleaseRequests()
  const requests = []
  let permitted = false, installations = 0, prepared
  let shown = -1
  const updates = new GithubReleaseDownloads('henryopencode/neurix-harness', '0.0.0', state => {
    const progress = Math.floor((state.percent ?? 0) / 10)
    if (state.phase !== 'downloading' || progress !== shown) {
      shown = progress
      console.log(JSON.stringify({ phase: state.phase, version: state.version, percent: state.percent }))
    }
    return state
  }, {
    directory: join(root, 'download'), platform: process.platform, arch: process.arch,
    installMode: 'restart', metadataTimeoutMs: 30_000, idleTimeoutMs: 60_000,
    request: async (url, init) => {
      if (process.env.DSH_RELEASE_TEST_DIRECT_GATEWAY === '1' && url.startsWith('https://github.com/')
        && !url.endsWith('/desktop-update.json')) {
        requests.push({ url, status: 504, injected: true })
        return new Response(null, { status: 504 })
      }
      const response = await transport.request(url, init)
      requests.push({ url, status: response.status, range: init.headers?.Range })
      return response
    },
    beforeRestart: async () => permitted,
    install: async (file, version) => { installations++; prepared = { file, version, bytes: (await stat(file)).size } },
  })
  const deadline = setTimeout(() => { updates.dispose() }, 10 * 60_000)
  try {
    const available = await updates.check(true)
    assert.equal(available.phase, 'available', available.message)
    if (process.env.DSH_EXPECT_RELEASE_VERSION !== undefined) assert.equal(available.version, process.env.DSH_EXPECT_RELEASE_VERSION)
    const downloaded = await updates.download(available.version)
    assert.equal(downloaded.phase, 'ready', downloaded.message)
    assert.equal(installations, 0)
    assert.equal((await updates.install(available.version)).phase, 'ready')
    assert.equal(installations, 0)
    permitted = true
    assert.equal((await updates.install(available.version)).phase, 'installing')
    assert.equal(installations, 1)
    await writeFile(join(root, 'result.json'), JSON.stringify({
      version: available.version, platform: process.platform, arch: process.arch,
      prepared, requests, installation: 'intercepted after production checksum revalidation and confirmation',
      injectedDirectGatewayFailure: process.env.DSH_RELEASE_TEST_DIRECT_GATEWAY === '1',
      installedApplicationChanged: false,
    }, null, 2) + '\n')
    console.log(`Real release download and intercepted handoff passed: ${root}`)
  } finally {
    clearTimeout(deadline)
    updates.dispose()
    await updates.cancel()
    await transport.dispose()
  }
}
void main().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
