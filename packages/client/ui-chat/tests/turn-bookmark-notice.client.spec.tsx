// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { TurnBookmarkNoticeHost } from '../src/client/chat/TurnBookmarkNoticeHost.tsx'
import type { TurnBookmarkNoticeHostProps } from '../src/client/contract/slots.ts'
import type { TurnBookmarkNotice, TurnBookmarkNoticeKind } from '../src/client/turn-bookmarks.ts'
import { zh } from '../src/client/locale.ts'

afterEach(cleanup)

describe('Turn bookmark feedback', () => {
  it.each<TurnBookmarkNoticeKind>(['saved', 'removed', 'readFailed', 'saveFailed'])('reports %s with localized copy', (kind) => {
    const source = createSnapshotStore<TurnBookmarkNotice | null>(null)
    const props = {
      useNotice: bindSnapshotSelector(source),
      dismissNotice: () => { source.set(null) },
      t: makeTranslate(zh, commonZh),
    } as TurnBookmarkNoticeHostProps
    const view = render(<TurnBookmarkNoticeHost {...props} />)
    expect(view.queryByRole('alert')).toBeNull()
    act(() => { source.set({ kind, seq: 1 }) })
    expect(view.getByRole('alert').textContent).toBe(zh[`chat.turnNavigation.bookmark.${kind}`])
    act(() => { props.dismissNotice() })
    expect(view.queryByRole('alert')).toBeNull()
  })
})
