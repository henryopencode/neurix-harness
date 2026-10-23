/** Opt-in macOS input against a test-owned Cocoa application with independent file and pixel checks. */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import sharp from 'sharp'
import { z } from 'zod'
import { Config } from '../src/index.ts'
import { NativeCalls } from '../src/native.ts'
import { ComputerRuntime } from '../src/runtime.ts'
import { computerInput } from '../src/schema.ts'
import { withMacApplicationLaunch } from '../src/launch.ts'
import { createNativeDriver, type NativeDriver } from '../src/native-driver.ts'
import { reserveTestDesktop } from './fixtures/desktop-lease.ts'
import { captureKeyPanel, compileKeycapReader, desktopState, keycapText, keyPanelWindow } from './fixtures/keyboard-visual.ts'

const observed = z.object({ state: z.object({ elements: z.array(z.object({
  role: z.string(), label: z.string().optional(), element_token: z.string().optional(), value: z.string().optional(),
  frame: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullish(),
}).loose()) }) })

for (const inputMode of ['foreground', 'background'] as const) {
  it.skipIf(process.env.DSH_COMPUTER_USE_NATIVE_INPUT_E2E !== '1' || process.platform !== 'darwin')(`${inputMode}: opens an owned native application, types, clicks Save, and verifies its file independently`, { retry: 0 }, async ({ signal }) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-unified-native-'))
    const bundleId = `ai.neurix.computer-fixture.${randomUUID()}`
    const installed = join(homedir(), 'Applications', `${bundleId}.app`)
    const appContents = join(installed, 'Contents')
    const executable = join(appContents, 'MacOS', 'HarnessNativeFixture')
    const destination = join(root, 'saved.json')
    const launchServices = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
    let installedOwned = false
    let launchedPid: number | undefined
    let driver: NativeDriver | undefined
    let runtime: ComputerRuntime | undefined
    let releaseDesktop: (() => Promise<void>) | undefined
    try {
      releaseDesktop = await reserveTestDesktop(signal)
      await mkdir(join(homedir(), 'Applications'), { recursive: true })
      await mkdir(installed)
      installedOwned = true
      await mkdir(join(appContents, 'MacOS'), { recursive: true })
      await writeFile(join(appContents, 'Info.plist'), `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleExecutable</key><string>HarnessNativeFixture</string><key>CFBundleName</key><string>Harness Native Fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>NSPrincipalClass</key><string>NSApplication</string><key>HarnessFixtureDestination</key><string>${destination}</string></dict></plist>`)
      await promisify(execFile)('/usr/bin/xcrun', ['swiftc', fileURLToPath(new URL('./fixtures/NativeWorkbench.swift', import.meta.url)), '-o', executable], { signal })
      const reader = join(root, 'ReadKeycap')
      if (inputMode === 'foreground') await compileKeycapReader(root, signal)
      await promisify(execFile)(launchServices, ['-f', installed], { signal })
      driver = createNativeDriver()
      const active = new ComputerRuntime(new NativeCalls(withMacApplicationLaunch(driver), 30_000),
        Config({ inputMode, screenshots: true, operationTimeoutMs: 30_000, maxElements: 12,
          ...inputMode === 'foreground' ? { typingDelayMs: 200, overlayIdleMs: 10_000 } : {} }))
      runtime = active
      const execute = (args: Record<string, unknown>, activeSignal = signal) => active.execute(computerInput.parse(args), activeSignal)
      const listed = await execute({ action: 'open_app', bundleId })
      const pid = z.object({ launch: z.object({ pid: z.number().int().positive() }) }).parse(listed.structuredContent).launch.pid
      launchedPid = pid
      await expect.poll(async () => {
        try { return await readFile(destination + '.pid', 'utf8') } catch (error) {
          // LaunchServices can acknowledge launch before the application delegate publishes readiness.
          if (z.object({ code: z.literal('ENOENT') }).safeParse(error).success) return undefined
          throw error
        }
      }, { timeout: 10_000 }).toBe(String(pid))
      expect(listed.structuredContent).toMatchObject({ status: 'opened', launch: { pid } })
      const targetSchema = z.array(z.object({ target: z.string(), pid: z.number().optional(), title: z.string().optional() }).loose())
      const mainWindow = (item: z.infer<typeof targetSchema>[number]) => item.pid === pid && item.title === 'Harness Native Workbench'
      let target = targetSchema.parse(listed.structuredContent?.targets).find(mainWindow)?.target
      if (target === undefined) target = targetSchema.parse((await execute({ action: 'list' })).structuredContent?.targets).find(mainWindow)?.target
      expect(target).toBeDefined()
      let raw = await execute({ action: 'observe', target })
      try {
        await expect.poll(async () => {
          raw = await execute({ action: 'observe', target, screenshot: true })
          return observed.parse(raw.structuredContent).state.elements.length
        }, { timeout: 10_000 }).toBeGreaterThan(0)
      } catch (error) {
        const artifacts = process.env.DSH_COMPUTER_USE_ARTIFACT_DIR
        if (artifacts !== undefined) {
          await mkdir(artifacts, { recursive: true })
          await writeFile(join(artifacts, `native-initial-${inputMode}.json`), JSON.stringify(raw.structuredContent, null, 2))
          const image = raw.content.find(block => block.type === 'image')
          if (image?.type === 'image') await writeFile(join(artifacts, `native-initial-${inputMode}.png`), Buffer.from(image.data, 'base64'))
        }
        throw error
      }
      const before = observed.parse(raw.structuredContent)
      let field = before.state.elements.find(element => element.role === 'AXTextField' && element.label?.includes('Task name'))
      expect(field?.element_token, JSON.stringify(raw.structuredContent)).toBeDefined()
      let panel: number | undefined, reference: Buffer | undefined
      const beforeInput = await desktopState(signal)
      if (inputMode === 'background') expect(beforeInput.pid).not.toBe(pid)
      if (inputMode === 'foreground') {
        const keyed = observed.parse((await execute({ action: 'key', target, keys: ['a'] })).structuredContent)
        field = keyed.state.elements.find(element => element.role === 'AXTextField' && element.label?.includes('Task name'))
        panel = await keyPanelWindow(signal)
        reference = await captureKeyPanel(panel, join(root, 'reference.png'), signal)
        const artifacts = process.env.DSH_COMPUTER_USE_ARTIFACT_DIR
        if (artifacts !== undefined) {
          await mkdir(artifacts, { recursive: true })
          await copyFile(join(root, 'reference.png'), join(artifacts, 'native-foreground-reference.png'))
        }
      }
      const text = (inputMode === 'foreground' ? 'a'.repeat(24) + 'A'.repeat(24) + 'aAß👩🏽‍💻' : '') + '原生软件输入成功✅'
      const captures: { path: string; key: string }[] = []
      const input = new AbortController()
      let completed = false
      const pending = execute({ action: 'type', target, ref: field?.element_token, text, replace: true },
        AbortSignal.any([signal, input.signal])).then(
        value => ({ value }), (error: unknown) => ({ error }),
      ).finally(() => { completed = true })
      let result: Awaited<typeof pending>
      try {
        if (panel !== undefined && reference !== undefined) {
          await expect.poll(async () => {
            const frame = await active.capturePreview(signal)
            return frame.kind === 'frame' ? { kind: frame.kind, keyboard: frame.keyboard } : frame
          }, { timeout: 10_000 }).toMatchObject({ kind: 'frame', keyboard: { kind: 'typing', key: 'a' } })
          let lowercase: Buffer | undefined
          for (let sample = 0; sample < 3; sample++) {
            expect(completed).toBe(false)
            const path = join(root, `typing-${sample}.png`)
            const pixels = await captureKeyPanel(panel, path, signal)
            expect(completed).toBe(false)
            const artifacts = process.env.DSH_COMPUTER_USE_ARTIFACT_DIR
            if (artifacts !== undefined) {
              await mkdir(artifacts, { recursive: true })
              await copyFile(path, join(artifacts, `native-foreground-key-${sample}.png`))
            }
            captures.push({ path, key: 'a' })
            expect(pixels.equals(reference), 'Lowercase input reused the uppercase shortcut caption').toBe(false)
            if (lowercase === undefined) lowercase = pixels
            else expect(pixels.equals(lowercase), `Foreground key panel changed during sample ${sample}`).toBe(true)
          }
          await expect.poll(async () => {
            const frame = await active.capturePreview(signal)
            return frame.kind === 'frame' ? frame.keyboard : undefined
          }, { timeout: 10_000 }).toMatchObject({ kind: 'typing', key: 'A' })
          const path = join(root, 'typing-uppercase.png')
          expect((await captureKeyPanel(panel, path, signal)).equals(reference)).toBe(true)
          captures.push({ path, key: 'A' })
          const artifacts = process.env.DSH_COMPUTER_USE_ARTIFACT_DIR
          if (artifacts !== undefined) await copyFile(path, join(artifacts, 'native-foreground-uppercase.png'))
        }
        result = await pending
      } finally {
        input.abort()
        await pending
      }
      if ('error' in result) throw result.error
      if (inputMode === 'background') expect(await desktopState(signal)).toEqual(beforeInput)
      for (const capture of captures) expect(await keycapText(reader, capture.path, signal), capture.path).toContain(capture.key)
      const typed = observed.parse(result.value.structuredContent)
      expect(typed.state.elements.find(element => element.role === 'AXTextField' && element.label === 'Task name')?.value).toBe(text)
      const save = typed.state.elements.find(element => element.role === 'AXButton' && element.label === 'Save task')
      expect(save?.element_token).toBeDefined()
      let current = result.value
      const readState = async () => z.object({ draft: z.string(), menu: z.number(), scrollX: z.number(), scrollY: z.number(),
        clicks: z.number(), doubleClicks: z.number(), rightClicks: z.number(), moves: z.number(), drags: z.number(),
        areas: z.object({ scroll: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
          gesture: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }) }),
      }).parse(JSON.parse(await readFile(destination + '.state', 'utf8')))
      const ref = (label: string) => {
        const elements = observed.parse(current.structuredContent).state.elements
        const value = elements.find(element => element.label === label)?.element_token
        if (value === undefined) throw new Error(`Native fixture has no element: ${label}`)
        return value
      }
      const point = async (area: 'scroll' | 'gesture', fraction = .5) => {
        const rect = (await readState()).areas[area]
        const image = z.object({ state: z.object({ window_bounds: z.object({ x: z.number(), y: z.number(),
          width: z.number(), height: z.number() }), screenshot_width: z.number(), screenshot_height: z.number() }) })
          .parse(current.structuredContent).state
        return { x: (rect.x + rect.width * fraction - image.window_bounds.x) * image.screenshot_width / image.window_bounds.width,
          y: (rect.y + rect.height / 2 - image.window_bounds.y) * image.screenshot_height / image.window_bounds.height }
      }
      const beforeMove = inputMode === 'background' ? beforeInput : await desktopState(signal)
      current = await execute({ action: 'move', target, ...await point('scroll') })
      if (inputMode === 'background') expect(await desktopState(signal)).toEqual(beforeMove)
      current = await execute({ action: 'scroll', target, ...await point('scroll'), direction: 'down', amount: 3 })
      await expect.poll(async () => (await readState()).scrollY).toBeGreaterThan(0)
      const down = (await readState()).scrollY
      current = await execute({ action: 'scroll', target, ...await point('scroll'), direction: 'up', amount: 1 })
      await expect.poll(async () => (await readState()).scrollY).toBeLessThan(down)
      current = await execute({ action: 'scroll', target, ...await point('scroll'), direction: 'right', amount: 3 })
      await expect.poll(async () => (await readState()).scrollX).toBeGreaterThan(0)
      const right = (await readState()).scrollX
      current = await execute({ action: 'scroll', target, ...await point('scroll'), direction: 'left', amount: 1 })
      await expect.poll(async () => (await readState()).scrollX).toBeLessThan(right)
      current = await execute({ action: 'menu', target, path: ['Actions', 'Record action'] })
      await expect.poll(async () => (await readState()).menu).toBe(1)
      if (inputMode === 'background') expect((await desktopState(signal)).pid).toBe(beforeMove.pid)
      // The file independently verifies Save; subsequent background input cannot rely on its unverified AXPress.
      current = await execute({ action: 'click', target, ref: ref('Save task') })
      if (inputMode === 'background') expect(await desktopState(signal)).toEqual(beforeInput)
      expect(JSON.parse(await readFile(destination, 'utf8'))).toEqual({ title: text })
      current = await execute({ action: 'observe', target, screenshot: true })
      const screenshot = current.content.find(block => block.type === 'image')
      if (screenshot?.type !== 'image') throw new Error('Native fixture returned no screenshot')
      const png = Buffer.from(screenshot.data, 'base64')
      expect((await sharp(png).metadata()).width).toBeGreaterThan(0)
      const artifacts = process.env.DSH_COMPUTER_USE_ARTIFACT_DIR
      if (artifacts !== undefined) {
        await mkdir(artifacts, { recursive: true })
        await writeFile(join(artifacts, `native-complete-${inputMode}.png`), png)
      }
      if (inputMode === 'foreground') {
        current = await execute({ action: 'move', target, ...await point('gesture') })
        await expect.poll(async () => (await readState()).moves).toBeGreaterThan(0)
        current = await execute({ action: 'click', target, ...await point('gesture'), count: 2 })
        current = await execute({ action: 'click', target, ...await point('gesture'), button: 'right' })
        await expect.poll(readState).toMatchObject({ clicks: 2, doubleClicks: 1, rightClicks: 1 })
        const end = await point('gesture', .8)
        current = await execute({ action: 'drag', target, ...await point('gesture'), toX: end.x, toY: end.y })
        await expect.poll(async () => (await readState()).drags).toBe(1)
        const cancel = new AbortController()
        const pending = execute({ action: 'type', target, ref: ref('Task name'), replace: true, text: 'cancel-'.repeat(100) },
          AbortSignal.any([signal, cancel.signal])).then(value => ({ value }), (error: unknown) => ({ error }))
        try { await expect.poll(async () => (await readState()).draft, { timeout: 10_000 }).toMatch(/^c/u) } finally {
          cancel.abort(new Error('Native workbench canceled input'))
          await pending
        }
        const stopped = await pending
        if (!('error' in stopped)) throw new Error('Canceled native input completed')
        expect(z.object({ message: z.string() }).parse(stopped.error).message).toContain('Native workbench canceled input')
        expect((await readState()).draft.length).toBeLessThan(700)
      }
      await execute({ action: 'reset' })
      await expect(execute({ action: 'observe', target })).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' })
    } finally {
      try { await runtime?.close() } finally {
        try { await driver?.close() } finally {
          try {
            let ownedPid: string | undefined
            try { ownedPid = await readFile(destination + '.pid', 'utf8') } catch (error) {
              // Compilation or launch can fail before the test-owned application starts.
              if (!z.object({ code: z.literal('ENOENT') }).safeParse(error).success) throw error
            }
            const pid = launchedPid ?? (ownedPid === undefined ? undefined : z.coerce.number().int().positive().parse(ownedPid))
            if (pid !== undefined) {
              try { process.kill(pid, 'SIGTERM') } catch (error) {
                // A crashing test-owned application may have exited before teardown.
                if (!z.object({ code: z.literal('ESRCH') }).safeParse(error).success) throw error
              }
              await expect.poll(() => {
                try { process.kill(pid, 0); return false } catch (error) {
                  if (z.object({ code: z.literal('ESRCH') }).safeParse(error).success) return true
                  throw error
                }
              }, { timeout: 10_000 }).toBe(true)
            }
            if (installedOwned) await promisify(execFile)(launchServices, ['-u', installed])
          } finally {
            try {
              if (installedOwned) await rm(installed, { recursive: true, force: true })
              await rm(root, { recursive: true, force: true })
            } finally { await releaseDesktop?.() }
          }
        }
      }
    }
  })
}
