// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createTurnBookmarkSource } from '../src/client/turn-bookmarks.ts'

afterEach(() => { vi.unstubAllGlobals() })

function storage() {
  const values = new Map<string, string>()
  const read = vi.fn((key: string) => values.get(key) ?? null)
  const write = vi.fn((key: string, value: string) => { values.set(key, value) })
  vi.stubGlobal('localStorage', { getItem: read, setItem: write })
  return { read, write, values }
}

describe('Turn bookmarks', () => {
  it('restores bookmarks after recreating a Session source and keeps Sessions separate', () => {
    storage()
    const notify = vi.fn()
    const source = createTurnBookmarkSource(SessionId('a'), notify)
    source.setBookmarked(8, true)
    source.setBookmarked(2, true)
    expect(createTurnBookmarkSource(SessionId('a'), notify).getSnapshot()).toEqual([2, 8])
    expect(createTurnBookmarkSource(SessionId('b'), notify).getSnapshot()).toEqual([])
    source.setBookmarked(2, false)
    expect(createTurnBookmarkSource(SessionId('a'), notify).getSnapshot()).toEqual([8])
    expect(notify.mock.calls.flat()).toEqual(['saved', 'saved', 'removed'])
  })

  it('includes newer bookmarks saved by another view when saving', () => {
    storage()
    const first = createTurnBookmarkSource(SessionId('shared'), vi.fn())
    const second = createTurnBookmarkSource(SessionId('shared'), vi.fn())
    first.setBookmarked(1, true)
    second.setBookmarked(2, true)
    first.setBookmarked(3, true)
    expect(createTurnBookmarkSource(SessionId('shared'), vi.fn()).getSnapshot()).toEqual([1, 2, 3])
  })

  it('keeps the saved and visible marks when a write fails and can retry', () => {
    const disk = storage()
    const notify = vi.fn()
    const source = createTurnBookmarkSource(SessionId('a'), notify)
    source.setBookmarked(1, true)
    const listener = vi.fn()
    const unsubscribe = source.subscribe(listener)
    disk.write.mockImplementationOnce(() => { throw new Error('quota') })
    source.setBookmarked(1, false)
    expect(source.getSnapshot()).toEqual([1])
    expect(createTurnBookmarkSource(SessionId('a'), vi.fn()).getSnapshot()).toEqual([1])
    expect(listener).not.toHaveBeenCalled()
    expect(notify).toHaveBeenLastCalledWith('saveFailed')
    source.setBookmarked(1, false)
    expect(source.getSnapshot()).toEqual([])
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it.each(['{', '{}', '[0]', '[-1]', '[1.5]', '["1"]', '[null]', '[9007199254740992]'])(
    'reports unreadable saved data and preserves it: %s', (raw) => {
      const disk = storage()
      const key = 'dsh.chat.turn-bookmarks.v1.a'
      disk.values.set(key, raw)
      const notify = vi.fn()
      const source = createTurnBookmarkSource(SessionId('a'), notify)
      source.setBookmarked(2, true)
      expect(source.getSnapshot()).toEqual([])
      expect(notify).toHaveBeenCalledWith('readFailed')
      expect(disk.values.get(key)).toBe(raw)
      expect(disk.write).not.toHaveBeenCalled()
    },
  )

  it('reports unavailable storage and retries its read before saving', () => {
    const disk = storage()
    disk.read.mockImplementation(() => { throw new Error('storage unavailable') })
    const notify = vi.fn()
    const source = createTurnBookmarkSource(SessionId('a'), notify)
    source.setBookmarked(1, true)
    expect(disk.write).not.toHaveBeenCalled()
    expect(notify.mock.calls.flat()).toEqual(['readFailed', 'readFailed'])
    disk.read.mockImplementation(key => disk.values.get(key) ?? null)
    source.setBookmarked(1, true)
    expect(createTurnBookmarkSource(SessionId('a'), vi.fn()).getSnapshot()).toEqual([1])
  })

  it('deduplicates saved Turn numbers and sorts them for display', () => {
    const disk = storage()
    disk.values.set('dsh.chat.turn-bookmarks.v1.a', '[3,1,3]')
    expect(createTurnBookmarkSource(SessionId('a'), vi.fn()).getSnapshot()).toEqual([1, 3])
  })
})
