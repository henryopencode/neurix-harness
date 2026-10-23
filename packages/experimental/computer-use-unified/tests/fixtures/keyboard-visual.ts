/** Screen-only keyboard observations scoped to the test process's AppKit worker. */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { z } from 'zod'

/**
 * @param signal - test lifetime.
 * @returns the system pointer and foreground process.
 */
export async function desktopState(signal: AbortSignal) {
  const result = await promisify(execFile)('/usr/bin/osascript', ['-l', 'JavaScript', '-e', String.raw`
    ObjC.import('AppKit');
    const point = $.NSEvent.mouseLocation;
    JSON.stringify({ x: point.x, y: point.y, pid: Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier) });
  `], { signal })
  return z.object({ x: z.number(), y: z.number(), pid: z.number() }).parse(JSON.parse(result.stdout))
}

/**
 * @param signal - test lifetime.
 * @returns visible keyboard panels belonging to the owned worker.
 */
export async function keyPanelWindows(signal: AbortSignal): Promise<number[]> {
  const processes = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,ppid=,comm='], { signal })
  const workers = processes.stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line)
    return match !== null && Number(match[2]) === process.pid && match[3]?.endsWith('/osascript') ? [Number(match[1])] : []
  })
  if (workers.length !== 1) throw new Error(`Expected one owned AppKit worker; found ${workers.length}`)
  const result = await promisify(execFile)('/usr/bin/osascript', ['-l', 'JavaScript', '-e', String.raw`
    ObjC.import('CoreGraphics');
    function run(args) {
      const raw = $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0);
      return JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject(raw)).filter(window =>
        window.kCGWindowOwnerPID === Number(args[0]) && window.kCGWindowBounds.Height === 58
      ).map(window => window.kCGWindowNumber));
    }
  `, '--', String(workers[0])], { signal })
  return z.array(z.number().int().positive()).parse(JSON.parse(result.stdout))
}

/**
 * @param signal - test lifetime.
 * @returns the sole visible keyboard panel.
 */
export async function keyPanelWindow(signal: AbortSignal): Promise<number> {
  const windows = await keyPanelWindows(signal)
  if (windows.length !== 1) throw new Error(`Expected one visible keyboard panel; found ${windows.length}`)
  return z.number().parse(windows[0])
}

/**
 * Capture one exact panel without activating it.
 * @param window - observed panel id.
 * @param path - test-owned PNG destination.
 * @param signal - test lifetime.
 * @returns decoded RGBA pixels.
 */
export async function captureKeyPanel(window: number, path: string, signal: AbortSignal): Promise<Buffer> {
  await promisify(execFile)('/usr/sbin/screencapture', ['-x', '-o', '-l', String(window), path], { signal })
  return sharp(await readFile(path)).ensureAlpha().raw().toBuffer()
}

/**
 * @param root - private test directory.
 * @param signal - test lifetime.
 * @returns the compiled offline text reader.
 */
export async function compileKeycapReader(root: string, signal: AbortSignal): Promise<string> {
  const reader = join(root, 'ReadKeycap')
  await promisify(execFile)('/usr/bin/xcrun', ['swiftc', fileURLToPath(new URL('./ReadKeycap.swift', import.meta.url)),
    '-o', reader], { signal })
  return reader
}

/**
 * Read glyphs from real panel pixels with offline Vision recognition.
 * @param reader - compiled text reader.
 * @param path - actual panel capture.
 * @param signal - test lifetime.
 * @returns recognized graphemes with their observed case.
 */
export async function keycapText(reader: string, path: string, signal: AbortSignal): Promise<string[]> {
  const metadata = await sharp(path).metadata()
  const scale = z.number().parse(metadata.height) / 58
  const glyph = await sharp(path).extract({ left: Math.round(59 * scale), top: Math.round(13 * scale),
    width: Math.round(z.number().parse(metadata.width) - 78 * scale), height: Math.round(32 * scale) })
    .flatten({ background: '#333333' }).threshold(180).negate().trim({ background: '#ffffff' }).png().toBuffer({ resolveWithObject: true })
  // Repeated copies of the same pixels give the detector a text line without changing the glyph.
  const width = glyph.info.width * 3 + 50, height = glyph.info.height + 40
  const strip = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite([0, 1, 2].map(index => ({ input: glyph.data, left: 20 + index * (glyph.info.width + 5), top: 20 }))).png().toBuffer()
  const prepared = path + '.ocr.png'
  await sharp(strip).resize(width * 4, height * 4).toFile(prepared)
  const result = await promisify(execFile)(reader, [prepared], { signal })
  const lines = z.array(z.string()).parse(JSON.parse(result.stdout))
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return lines.flatMap(line => [...segmenter.segment(line)].map(part => part.segment).filter(character => !/\s/u.test(character)))
}

/**
 * Read the real AppKit text label independently of preview metadata.
 * @param reader - compiled native reader.
 * @param window - exact visible key panel.
 * @param signal - test lifetime.
 * @returns labels exposed by the panel through macOS accessibility.
 */
export async function keyPanelText(reader: string, window: number, signal: AbortSignal): Promise<string[]> {
  const result = await promisify(execFile)(reader, ['--window', String(window)], { signal })
  return z.array(z.string()).parse(JSON.parse(result.stdout))
}
