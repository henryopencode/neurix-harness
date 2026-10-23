/** Real browser input modes, pointer gestures, native dialogs, and cancellation with an HTTP oracle. */

import { createServer } from 'node:http'
import { readFile, mkdir, mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CuaDriver as Driver } from '@trycua/cua-driver'
import { expect, it } from 'vitest'
import { z } from 'zod'
import sharp from 'sharp'
import { Config, type ResolvedConfig } from '../src/index.ts'
import { ComputerRuntime } from '../src/runtime.ts'
import { NativeCalls, type NativeResult } from '../src/native.ts'
import { withMacApplicationLaunch } from '../src/launch.ts'
import { computerInput } from '../src/schema.ts'
import { reserveTestDesktop } from './fixtures/desktop-lease.ts'
import { captureKeyPanel, compileKeycapReader, desktopState, keycapText, keyPanelText, keyPanelWindow } from './fixtures/keyboard-visual.ts'

type Mode = 'headless' | 'background' | 'foreground'
interface Workbench {
  execute: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<NativeResult>
  state: () => Promise<Record<string, unknown>>
  runtime: ComputerRuntime
  url: string
}

async function withBrowser(mode: Mode, signal: AbortSignal, body: (workbench: Workbench) => Promise<void>,
  options: Partial<ResolvedConfig> = {}): Promise<void> {
  const html = await readFile(new URL('./fixtures/complete-workbench.html', import.meta.url))
  let state: Record<string, unknown> = {}
  const server = createServer((request, response) => {
    if (request.url === '/state') {
      if (request.method === 'POST') {
        const chunks: string[] = []
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => { chunks.push(chunk) })
        request.on('end', () => { state = z.record(z.string(), z.unknown()).parse(JSON.parse(chunks.join(''))); response.end('ok') })
      } else { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(state)) }
    } else { response.setHeader('content-type', 'text/html'); response.end(html) }
  })
  let driver: Driver | undefined, runtime: ComputerRuntime | undefined, release: (() => Promise<void>) | undefined
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Workbench did not bind a port')
    if (mode !== 'headless') {
      release = await reserveTestDesktop(signal)
      const { CuaDriver } = await import('@trycua/cua-driver')
      driver = CuaDriver.create({ embedded: true, claudeCodeCompatibility: false }) as Driver
    }
    const active = new ComputerRuntime(driver === undefined ? undefined : new NativeCalls(withMacApplicationLaunch(driver), 30_000),
      Config({ headless: mode === 'headless', inputMode: mode === 'foreground' ? 'foreground' : 'background',
        screenshots: false, typingDelayMs: 45, operationTimeoutMs: 30_000, ...options }))
    runtime = active
    const url = `http://127.0.0.1:${address.port}/`
    await body({ runtime: active, url,
      execute: (input, activeSignal = signal) => active.execute(computerInput.parse(input), activeSignal),
      state: async () => z.record(z.string(), z.unknown()).parse(await (await fetch(new URL('/state', url), { signal })).json()),
    })
  } finally {
    try { await runtime?.close() } finally {
      try { await driver?.shutdown() } finally {
        driver?.uniffiDestroy()
        try {
          server.closeAllConnections()
          await new Promise<void>((resolve, reject) => {
            server.close((error) => { if (error) reject(error); else resolve() })
          })
        } finally { await release?.() }
      }
    }
  }
}

it.skipIf(process.env.DSH_COMPUTER_USE_E2E !== '1' || process.platform !== 'darwin')(
  'native prompt: keeps real Chinese and letter case visible in the panel and preview without moving system input', { retry: 0 },
  async ({ signal }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-prompt-visual-'))
    try {
      const reader = await compileKeycapReader(root, signal)
      await withBrowser('foreground', signal, async ({ execute, runtime, state, url }) => {
        const target = z.string().parse((await execute({ action: 'open_browser', url })).structuredContent?.target)
        expect((await execute({ action: 'click', target, locator: { by: 'css', selector: '#prompt' } })).structuredContent?.status)
          .toBe('dialog')
        const before = await desktopState(signal)
        const text = ['真', 'a', 'A', '实'].map(character => character.repeat(4)).join('')
        const cancel = new AbortController()
        let failure: unknown
        const pending = execute({ action: 'dialog', target, accept: true, text }, AbortSignal.any([signal, cancel.signal]))
          .then(value => ({ value }), (error: unknown) => { failure = error; return { error } })
        const captures: { path: string; key: string }[] = []
        try {
          for (const [index, key] of ['真', 'a', 'A', '实'].entries()) {
            await expect.poll(async () => {
              if (failure !== undefined) throw failure
              const frame = await runtime.capturePreview(signal)
              return frame.kind === 'frame' ? frame.keyboard?.kind === 'typing' ? frame.keyboard.key : undefined : frame.kind
            }, { timeout: 20_000 }).toBe(key)
            const panel = await keyPanelWindow(signal)
            expect(await keyPanelText(reader, panel, signal)).toContain(key)
            const path = join(root, `prompt-key-${index}.png`)
            await captureKeyPanel(panel, path, signal)
            const artifacts = process.env.DSH_COMPUTER_USE_ARTIFACT_DIR
            if (artifacts !== undefined) {
              await mkdir(artifacts, { recursive: true })
              await copyFile(path, join(artifacts, `prompt-key-${index}.png`))
              const frame = await runtime.capturePreview(signal)
              if (frame.kind === 'frame') await writeFile(join(artifacts, `prompt-preview-${index}.png`),
                Buffer.from(frame.imageUrl.slice('data:image/png;base64,'.length), 'base64'))
            }
            captures.push({ path, key })
            expect(await desktopState(signal)).toEqual(before)
          }
          const result = await pending
          if ('error' in result) throw result.error
          for (const capture of captures.filter(item => /^[a-z]$/iu.test(item.key))) {
            expect(await keycapText(reader, capture.path, signal), capture.path).toContain(capture.key)
          }
          await expect.poll(async () => (await state()).dialog).toBe(text)
        } finally {
          cancel.abort(new Error('Prompt visual test finished'))
          await pending
        }
      }, { operationTimeoutMs: 60_000, typingDelayMs: 200 })
    } finally { await rm(root, { recursive: true, force: true }) }
  },
)

it.skipIf(process.env.DSH_COMPUTER_USE_E2E !== '1' || process.platform !== 'darwin')(
  'system input deadline: stops partial foreground typing and preserves the owned browser for observation', { retry: 0 },
  async ({ signal }) => {
    await withBrowser('foreground', signal, async ({ execute, state, url }) => {
      const target = z.string().parse((await execute({ action: 'open_browser', url })).structuredContent?.target)
      const text = 'timeout-'.repeat(100)
      const result = await execute({ action: 'type', target, locator: { by: 'css', selector: '#title' }, text, replace: true })
        .then(value => ({ value }), (error: unknown) => ({ error }))
      if (!('error' in result)) throw new Error('Long system input ignored its deadline')
      expect(result.error).toMatchObject({ code: 'TIMEOUT' })
      const observed = await execute({ action: 'observe', target })
      const fields = z.object({ fields: z.array(z.object({ locator: z.object({ selector: z.string() }).loose(), value: z.string() })) })
        .parse(observed.structuredContent).fields
      const value = z.string().parse(fields.find(field => field.locator.selector === '#title')?.value)
      expect(value).toMatch(/^t/u)
      expect(value.length).toBeLessThan(text.length)
      await expect.poll(async () => (await state()).draft).toBe(value)
    }, { operationTimeoutMs: 15_000, typingDelayMs: 200 })
  },
)

it.skipIf(process.env.DSH_COMPUTER_USE_E2E !== '1' || process.platform !== 'darwin')(
  'background keys: matches real lowercase captions and preview metadata without moving system input', { retry: 0 },
  async ({ signal }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-background-visual-'))
    try {
      const reader = await compileKeycapReader(root, signal)
      await withBrowser('background', signal, async ({ execute, state, runtime, url }) => {
        const target = z.string().parse((await execute({ action: 'open_browser', url })).structuredContent?.target)
        const before = await desktopState(signal)
        const text = 'a'.repeat(60) + 'Aß👩🏽‍💻'
        const cancel = new AbortController()
        const pending = execute({ action: 'type', target, locator: { by: 'css', selector: '#title' }, text },
          AbortSignal.any([signal, cancel.signal])).then(value => ({ value }), (error: unknown) => ({ error }))
        try {
          await expect.poll(async () => {
            const frame = await runtime.capturePreview(signal)
            return frame.kind === 'frame' ? frame.keyboard?.kind === 'typing' ? frame.keyboard.key : undefined : frame.kind
          }, { timeout: 10_000 }).toBe('a')
          const panel = await keyPanelWindow(signal)
          expect(await keyPanelText(reader, panel, signal)).toContain('a')
          const path = join(root, 'background-a.png')
          await captureKeyPanel(panel, path, signal)
          const artifacts = process.env.DSH_COMPUTER_USE_ARTIFACT_DIR
          if (artifacts !== undefined) {
            await mkdir(artifacts, { recursive: true })
            await copyFile(path, join(artifacts, 'browser-background-a.png'))
          }
          expect(await desktopState(signal)).toEqual(before)
          const result = await pending
          if ('error' in result) throw result.error
          expect(await keycapText(reader, path, signal)).toContain('a')
          await expect.poll(async () => (await state()).draft).toBe(text)
        } finally {
          cancel.abort(new Error('Background key test finished'))
          await pending
        }
      }, { typingDelayMs: 100 })
    } finally { await rm(root, { recursive: true, force: true }) }
  },
)

const targetOf = (result: NativeResult) => z.string().parse(result.structuredContent?.target)
const css = (selector: string) => ({ by: 'css', selector })

for (const mode of ['headless', 'background', 'foreground'] as const) {
  const test = it.skipIf(process.env.DSH_COMPUTER_USE_E2E !== '1' || mode !== 'headless' && process.platform !== 'darwin')
  test(`${mode}: verifies text, keys, click variants, movement, scrolling, dragging, screenshots and tab lifecycle`, { retry: 0 }, async ({ signal }) => {
    await withBrowser(mode, signal, async ({ execute, state, runtime, url }) => {
      const opened = await execute({ action: 'open_browser', url })
      const target = targetOf(opened)
      expect(opened.structuredContent?.inputMode).toBe(mode === 'foreground' ? 'foreground' : 'background')
      await expect.poll(state).toMatchObject({ page: 'first' })
      await execute({ action: 'observe', target })
      await execute({ action: 'type', target, locator: css('#title'), text: '真实浏览器✅', replace: true })
      await execute({ action: 'type', target, text: ' append' })
      await execute({ action: 'key', target, keys: [process.platform === 'darwin' ? 'Meta' : 'Control', 'a'] })
      const title = `Complete ${mode} ✅`
      await execute({ action: 'type', target, text: title })
      await execute({ action: 'key', target, keys: ['Tab'] })
      const notes = '  first line\nsecond line🙂'
      await execute({ action: 'type', target, text: notes })
      await execute({ action: 'click', target, locator: css('#save') })
      await expect.poll(state).toMatchObject({ title, notes })
      await execute({ action: 'move', target, locator: css('#increment') })
      await expect.poll(async () => (await state()).pointerMoves).toBeGreaterThan(0)
      await execute({ action: 'click', target, locator: css('#increment'), count: 2 })
      await execute({ action: 'click', target, locator: css('#increment'), button: 'right' })
      await expect.poll(state).toMatchObject({ clicks: 2, doubleClicks: 1, rightClicks: 1 })
      for (const direction of ['down', 'right', 'up', 'left'] as const) {
        await execute({ action: 'scroll', target, locator: css('#scroll-box'), direction, amount: direction === 'down' || direction === 'right' ? 120 : 60 })
      }
      await expect.poll(async () => (await state()).scrollX).toBeGreaterThan(0)
      await expect.poll(async () => (await state()).scrollY).toBeGreaterThan(0)
      await execute({ action: 'drag', target, locator: css('#drag-source'), toLocator: css('#drop-target') })
      await expect.poll(state).toMatchObject({ drops: 1 })
      const screenshot = await execute({ action: 'observe', target, screenshot: true })
      const image = screenshot.content.find(block => block.type === 'image')
      if (image?.type !== 'image') throw new Error('Browser observation returned no screenshot')
      expect((await sharp(Buffer.from(image.data, 'base64')).metadata()).width).toBeGreaterThan(0)
      const preview = await runtime.capturePreview(signal)
      expect(preview.kind).toBe('frame')
      const artifacts = process.env.DSH_COMPUTER_USE_ARTIFACT_DIR
      if (artifacts !== undefined) {
        await mkdir(artifacts, { recursive: true })
        await writeFile(join(artifacts, `complete-browser-${mode}.png`), Buffer.from(image.data, 'base64'))
      }
      const second = targetOf(await execute({ action: 'new_tab', target, url: new URL('?page=second', url).href }))
      const tabs = (await execute({ action: 'list' })).structuredContent?.targets
      const ids = z.array(z.object({ target: z.string() }).loose()).parse(tabs).map(item => item.target)
      expect(ids).toEqual(expect.arrayContaining([target, second]))
      await execute({ action: 'navigate', target: second, url: new URL('?page=navigated', url).href })
      await expect.poll(state).toMatchObject({ page: 'navigated' })
      await execute({ action: 'close_tab', target: second })
      await expect(execute({ action: 'observe', target: second })).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' })
      await expect(execute({ action: 'navigate', target, url: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'INVALID_URL' })
      await execute({ action: 'observe', target })
      await expect(execute({ action: 'menu', target, path: ['File'] })).rejects.toMatchObject({ code: 'WINDOW_REQUIRED' })
      await execute({ action: 'reset' })
      await expect(execute({ action: 'observe', target })).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' })
    })
  })

  test(`${mode}: resolves real alert, confirmation and prompt dialogs, then cancels active typing`, { retry: 0 }, async ({ signal }) => {
    await withBrowser(mode, signal, async ({ execute, state, url }) => {
      const target = targetOf(await execute({ action: 'open_browser', url }))
      const cases = [
        { button: '#alert', accept: true, expected: 'alert accepted' },
        { button: '#confirm', accept: true, expected: true },
        { button: '#confirm', accept: false, expected: false },
        { button: '#prompt', accept: true, text: '真实弹窗🙂', expected: '真实弹窗🙂' },
        { button: '#prompt', accept: false, expected: null },
      ]
      for (const item of cases) {
        const clicked = await execute({ action: 'click', target, locator: css(item.button) })
        expect(clicked.structuredContent?.status).toBe('dialog')
        await execute({ action: 'dialog', target, accept: item.accept, ...item.text === undefined ? {} : { text: item.text } })
        await expect.poll(async () => (await state()).dialog).toEqual(item.expected)
      }
      await execute({ action: 'type', target, locator: css('#title'), text: '', replace: true })
      const cancel = new AbortController()
      const text = 'cancel-this-input-'.repeat(100)
      let failure: unknown
      const pending = execute({ action: 'type', target, locator: css('#title'), text }, AbortSignal.any([signal, cancel.signal]))
        .then(value => ({ value }), (error: unknown) => { failure = error; return { error } })
      try {
        await expect.poll(async () => failure === undefined ? (await state()).draft
          : `Input failed: ${failure instanceof Error ? failure.message : JSON.stringify(failure)}`, { timeout: 10_000 }).toMatch(/^c/u)
      } finally {
        cancel.abort(new Error('Complete workbench canceled input'))
        await pending
      }
      const stopped = await pending
      if (!('error' in stopped)) throw new Error('Canceled input completed unexpectedly')
      expect(z.object({ message: z.string() }).parse(stopped.error).message).toContain('Complete workbench canceled input')
      expect(String((await state()).draft).length).toBeLessThan(text.length)
      const after = await execute({ action: 'observe', target }).then(value => ({ value }), (error: unknown) => ({ error }))
      if ('error' in after) expect(after.error).toMatchObject({ code: 'TARGET_NOT_FOUND' })
      else {
        const fields = z.object({ fields: z.array(z.object({ locator: z.object({ selector: z.string() }).loose(), value: z.string() })) })
          .parse(after.value.structuredContent).fields
        const draft = fields.find(field => field.locator.selector === '#title')?.value
        expect(draft).toMatch(/^c/u)
        await expect.poll(async () => (await state()).draft).toBe(draft)
      }
    })
  })
}
