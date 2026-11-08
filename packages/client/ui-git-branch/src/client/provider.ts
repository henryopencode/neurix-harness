/** One cancellable, reconnecting resource stream per displayed Session directory. */
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-git-branch/remote'
import type { GitHead } from '../types.ts'

type BranchResource = ResourceProvider<'git-branch'> & { settle(): Promise<void> }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    /** Git HEAD for the Session named by the resource address. */
    'git-branch': GitHead
  }
}

/**
 * Adapt the generated Remote stream to the shared resource lifecycle.
 * @param remote - generated Git namespace and stream supervisor.
 * @returns the provider and a teardown that waits for its Remote streams.
 */
export function branchProvider(remote: Pick<ClientRemote, '$stream' | 'gitBranch'>): BranchResource {
  const streams = new Set<{ dispose(): Promise<void> }>()
  return {
    protocol: 'git-branch',
    settle: async () => { await Promise.all([...streams].map(stream => stream.dispose())) },
    async *open(address, { signal }) {
      let id: string
      try {
        const url = new URL(address)
        id = decodeURIComponent(url.pathname.slice(1))
        if (url.protocol !== 'dsh-resource:' || url.hostname !== 'git-branch' || id === '' || id.includes('/')) id = ''
      } catch (_error) {
        // Invalid addresses produce a resource failure before any Host request.
        id = ''
      }
      if (id === '') {
        yield { ok: false, error: new RemoteError('git-branch/invalid-address', 'Expected a Session Git resource address', {}) }
        return
      }
      const stream = remote.$stream({
        name: 'git-branch', open: lifetime => remote.gitBranch.follow(id as SessionId, lifetime),
        ended: () => new Error('Git branch observation ended'),
      })
      streams.add(stream)
      const abort = () => { void stream.dispose() }
      signal.addEventListener('abort', abort, { once: true })
      try {
        if (signal.aborted) return
        for await (const item of stream) {
          item.accept()
          yield { ok: true, value: item.value }
          if (item.value.kind === 'unavailable') return
        }
      } catch (error) {
        if (signal.aborted) return
        const failure = remoteErrorOf(error)
        if (failure === undefined) throw error
        yield { ok: false, error: failure }
      } finally {
        signal.removeEventListener('abort', abort)
        await stream.dispose()
        streams.delete(stream)
      }
    },
  }
}
