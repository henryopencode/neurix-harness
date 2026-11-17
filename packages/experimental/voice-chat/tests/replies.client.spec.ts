/** Streaming and settled answer snapshots produce each spoken sentence once. */
import { expect, it } from 'vitest'
import { ReplySentences } from '../src/client/replies.ts'

it('buffers unfinished text and does not replay streamed text after settlement', () => {
  const sentences = new ReplySentences(80)
  const reply = { key: '1/1', turn: 1, step: 1, text: '你好。', final: false }
  expect(sentences.take(reply)).toEqual(['你好。'])
  expect(sentences.take({ ...reply, text: '你好。下一句' })).toEqual([])
  expect(sentences.take({ ...reply, text: '你好。下一句。' })).toEqual(['下一句。'])
  expect(sentences.take({ ...reply, text: '你好。下一句。', final: true })).toEqual([])
})

it('skips history, code blocks, markup, images and bare URLs while keeping visible link labels', () => {
  const sentences = new ReplySentences(100)
  expect(sentences.take({ key: 'old', turn: 1, step: 1, text: 'Old reply.', final: true }, true)).toEqual([])
  expect(sentences.take({ key: 'old', turn: 1, step: 1, text: 'Old reply.', final: true })).toEqual([])
  const result = sentences.take({ key: 'new', turn: 2, step: 1, text: '**完成**。\n```sh\nrm -rf /\n```\n[查看结果](https://example.com)。', final: true })
  expect(result.join('')).toBe('完成。查看结果。')
  expect(sentences.take({ key: 'url', turn: 3, step: 1, text: '![image](https://example.com/image.png) https://example.com `secret`', final: true })).toEqual([])
})

it('splits long unpunctuated speech into bounded fragments without dropping characters', () => {
  const sentences = new ReplySentences(20), text = 'a'.repeat(55)
  const first = sentences.take({ key: 'long', turn: 1, step: 1, text, final: false })
  expect(first.map(value => value.length)).toEqual([20, 20])
  const last = sentences.take({ key: 'long', turn: 1, step: 1, text, final: true })
  expect([...first, ...last].join('')).toBe(text)
})

it('packs short sentences and preserves deferred text when playback capacity is full', () => {
  const sentences = new ReplySentences(20), reply = { key: 'long', turn: 1, step: 1, text: 'First. Second. Third. Fourth. Fifth.', final: true }
  expect(sentences.take(reply, false, 0)).toEqual([])
  expect(sentences.take(reply, false, 1)).toEqual(['First. Second.'])
  expect(sentences.take(reply, false, 1)).toEqual(['Third. Fourth.'])
  expect(sentences.take(reply, false, 1)).toEqual(['Fifth.'])
  expect(sentences.take(reply)).toEqual([])
})
