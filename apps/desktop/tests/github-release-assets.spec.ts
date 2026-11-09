/** Alternate download ids remain bound to the checked release and exact asset. */
import { expect, it, vi } from 'vitest'
import { GithubReleaseAssets } from '../src/github-release-assets.ts'
import type { GithubReleaseRequest } from '../src/github-release-transfer.ts'

function fixture(assets: unknown, overrides = {}) {
  const request = vi.fn<GithubReleaseRequest>(async () => Response.json({
    tag_name: 'v1.0.1', draft: false, prerelease: false, assets, ...overrides,
  }))
  const resolver = new GithubReleaseAssets('owner/repo', '1.0.1', request, new AbortController().signal, 10_000)
  return { resolver, request }
}

it('shares one release read and constructs API URLs independently of supplied destinations', async () => {
  const f = fixture([{ id: 13, name: 'installer', size: 21, browser_download_url: 'https://untrusted.invalid' },
    { id: 14, name: 'SHA256SUMS.txt', size: 100 }])
  expect(await Promise.all([f.resolver.url('installer', 21), f.resolver.url('SHA256SUMS.txt')])).toEqual([
    'https://api.github.com/repos/owner/repo/releases/assets/13', 'https://api.github.com/repos/owner/repo/releases/assets/14',
  ])
  expect(f.request).toHaveBeenCalledTimes(1)
  expect(f.request.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/owner/repo/releases/tags/v1.0.1')
})

it.each([
  [], [{ id: '13', name: 'installer', size: 21 }], [{ id: 0, name: 'installer', size: 21 }],
  [{ id: 13, name: 'installer', size: 20 }],
  [{ id: 13, name: 'installer', size: 21 }, { id: 14, name: 'installer', size: 21 }],
].map(assets => ({ assets })))('rejects a missing, ambiguous, or changed asset: %j', async ({ assets }) => {
  const f = fixture(assets)
  await expect(f.resolver.url('installer', 21)).rejects.toThrow('missing or changed')
})

it.each([{ tag_name: 'v1.0.2' }, { draft: true }, { prerelease: true }, { assets: null }])(
  'rejects changed release identity: %j', async (overrides) => {
    const f = fixture([{ id: 13, name: 'installer', size: 21 }], overrides)
    await expect(f.resolver.url('installer', 21)).rejects.toThrow('release identity changed')
  })
