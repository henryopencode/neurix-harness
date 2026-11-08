// @vitest-environment jsdom
/** Branch context follows live resources and keeps long names accessible on activation. */
import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ResourceProtocol, ResourceSnapshot } from '@deepseek-ai/dsh-client-resources/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { GitBranchBadge } from '../src/client/GitBranchBadge.tsx'
import { dictionaries } from '../src/client/locales.ts'
import type { GitHead } from '../src/types.ts'

afterEach(cleanup)
type Props = ComponentProps<typeof GitBranchBadge>

function props(value: GitHead | undefined, status: ResourceSnapshot<GitHead>['status'] = 'live', cwd: string | undefined = '/project'): Props {
  const sessionId = 'session' as SessionId
  const list: SessionListState = {
    ids: [sessionId], phase: 'ready', projectionsBySession: {},
    byId: { [sessionId]: {
      id: sessionId, displayTitle: 'Project', running: false, blank: false, updatedAt: 1, retainedBy: {},
      ...cwd === undefined ? {} : { cwd },
    } },
  }
  const resource: ResourceSnapshot<GitHead> = { status, value, failure: status === 'failed' ? new RemoteError('git-branch/read-failed', 'failed', {}) : undefined }
  return {
    sessionId,
    useSessions: selector => selector(list),
    useResource: (() => resource) as Props['useResource'],
    t: makeTranslate(dictionaries.en),
  }
}

it('shows the full branch name in its accessible label and reveals it on click', async () => {
  const name = 'feature/a-very-long-branch-for-workspace-changes'
  render(<GitBranchBadge {...props({ kind: 'branch', name })} />)
  const badge = screen.getByRole('button', { name: `Git branch: ${name}` })
  fireEvent.click(badge)
  expect((await screen.findByRole('tooltip')).textContent).toContain(name)
  fireEvent.keyDown(document, { key: 'Escape' })
})

it('shows branch switches and detached commits through the same mounted control', () => {
  const view = render(<GitBranchBadge {...props({ kind: 'branch', name: 'main' })} />)
  view.rerender(<GitBranchBadge {...props({ kind: 'branch', name: 'feature/next' })} />)
  expect(screen.queryByRole('button', { name: 'Git branch: main' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Git branch: feature/next' })).toBeTruthy()
  view.rerender(<GitBranchBadge {...props({ kind: 'detached', commit: 'abc1234' })} />)
  expect(screen.getByRole('button', { name: 'Detached · abc1234' })).toBeTruthy()
})

it.each([
  props(undefined, 'none'), props(undefined, 'loading'), props({ kind: 'not-repository' }),
  props({ kind: 'unavailable' }), props(undefined, 'live', undefined),
])('omits the badge when no repository metadata is available', (value) => {
  expect(render(<GitBranchBadge {...value} />).container.textContent).toBe('')
})

it('offers a fresh resource subscription after a read failure', () => {
  const value = props(undefined, 'failed')
  const addresses: string[] = []
  const reader: Props['useResource'] = <P extends ResourceProtocol>(address: string) => {
    addresses.push(address)
    return value.useResource<P>(address)
  }
  render(<GitBranchBadge {...value} useResource={reader} />)
  fireEvent.click(screen.getByRole('button', { name: 'Retry Git' }))
  expect(addresses.at(-1)).toContain('retry=1')
})
