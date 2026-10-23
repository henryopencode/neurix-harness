/** Opt-in real Chrome against a test-owned local application. */

import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Config } from '../src/index.ts'
import { ComputerRuntime } from '../src/runtime.ts'
import { computerInput } from '../src/schema.ts'
import { chromium } from 'playwright'
import { captureBrowserElements, requireBrowserElement } from '../src/browser-observation.ts'

it.skipIf(process.env.DSH_COMPUTER_USE_E2E !== '1')('headless: fills a real page, verifies the saved record, preserves tabs, handles dialogs, and cancels queued input', { retry: 0 }, async ({ signal }) => {
  const html = await readFile(new URL('./fixtures/workbench.html', import.meta.url))
  let saved: unknown
  const server = createServer((request, response) => {
    if (request.url === '/save' && request.method === 'POST') {
      const chunks: string[] = []
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => { chunks.push(chunk) })
      request.on('end', () => { saved = JSON.parse(chunks.join('')); response.end('saved') })
    } else if (request.url === '/state') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(saved ?? null))
    } else {
      response.setHeader('content-type', 'text/html')
      response.end(html)
    }
  })
  const runtime = new ComputerRuntime(undefined,
    Config({ headless: true, screenshots: false, operationTimeoutMs: 30_000 }))
  const execute = (args: Record<string, unknown>, activeSignal = signal) => runtime.execute(computerInput.parse(args), activeSignal)
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Fixture server did not bind a port')
    const url = `http://127.0.0.1:${address.port}/`
    const opened = await execute({ action: 'open_browser', url })
    const target = opened.structuredContent?.target
    const state = opened.structuredContent?.tree === undefined ? await execute({ action: 'observe', target, screenshot: false }) : opened
    expect(state.structuredContent?.tree, JSON.stringify({ opened: opened.structuredContent, state: state.structuredContent })).toContain('Task name')
    await execute({ action: 'type', target, locator: { by: 'role', role: 'textbox', name: 'Task name' }, text: 'Usable computer control', replace: true })
    await execute({ action: 'type', target, locator: { by: 'label', text: 'Notes' }, text: 'Verified through an independent HTTP read.', replace: true })
    await execute({ action: 'click', target, locator: { by: 'role', role: 'button', name: 'Save task' } })
    expect(await (await fetch(new URL('/state', url), { signal })).json()).toEqual({ title: 'Usable computer control', notes: 'Verified through an independent HTTP read.' })
    await expect.poll(async () => (await execute({ action: 'observe', target })).structuredContent?.tree).toContain('Saved task: Usable computer control')
    const screenshot = await execute({ action: 'observe', target, screenshot: true })
    expect(screenshot.content.some(block => block.type === 'image')).toBe(true)
    const artifactDirectory = process.env.DSH_COMPUTER_USE_ARTIFACT_DIR
    const image = screenshot.content.find(block => block.type === 'image')
    if (artifactDirectory !== undefined && image?.type === 'image') {
      await mkdir(artifactDirectory, { recursive: true })
      await writeFile(join(artifactDirectory, 'browser-workflow.png'), Buffer.from(image.data, 'base64'))
    }
    const second = await execute({ action: 'new_tab', target, url })
    await execute({ action: 'close_tab', target: second.structuredContent?.target })
    expect((await execute({ action: 'observe', target })).structuredContent?.tree).toContain('Usable computer control')
    const clicked = await execute({ action: 'click', target, locator: { by: 'role', role: 'button', name: 'Show confirmation' } })
    expect(clicked.structuredContent?.status).toBe('dialog')
    await execute({ action: 'dialog', target, accept: true })
    expect((await execute({ action: 'observe', target })).structuredContent?.tree).toContain('Confirmed')
    const cancel = new AbortController()
    const blocked = execute({ action: 'click', target, locator: { by: 'role', role: 'button', name: 'Never exists' } }, cancel.signal)
    const canceled = expect(blocked).rejects.toThrow('user canceled blocked input')
    cancel.abort(new Error('user canceled blocked input'))
    await canceled
    await execute({ action: 'reset' })
    const replacement = await execute({ action: 'open_browser', url })
    expect(replacement.structuredContent?.target).not.toBe(target)
  } finally {
    try { await runtime.close() } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
    }
  }
})

it.skipIf(process.env.DSH_COMPUTER_USE_E2E !== '1')('binds semantic locators to observed DOM identities and rejects replacement and focus changes', { retry: 0 }, async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  try {
    const page = await (await browser.newContext()).newPage()
    await page.setContent('<input id="first" aria-label="First"><input id="second" aria-label="Second"><button id="save">Save</button>')
    await page.locator('#first').focus()
    const observed = await captureBrowserElements(page, ['#first', '#save'])
    try {
      const save = await requireBrowserElement(page.getByRole('button', { name: 'Save' }), observed)
      const focused = await requireBrowserElement(page.locator(':focus'), observed, true)
      await focused.dispose()
      await expect(requireBrowserElement(page.getByLabel('Second'), observed)).rejects.toMatchObject({ code: 'ELEMENT_NOT_OBSERVED', effect: 'none' })
      await page.locator('#second').focus()
      await expect(requireBrowserElement(page.locator(':focus'), observed, true)).rejects.toMatchObject({ code: 'ELEMENT_NOT_OBSERVED' })
      await page.locator('#save').evaluate((element) => { element.replaceWith(element.cloneNode(true)) })
      await expect(requireBrowserElement(page.locator('#save'), observed)).rejects.toMatchObject({ code: 'ELEMENT_NOT_OBSERVED' })
      try {
        await expect(save.click({ timeout: 1000 })).rejects.toThrow()
        expect(await page.locator('#save').innerText()).toBe('Save')
      } finally { await save.dispose() }
    } finally { await observed.dispose() }
  } finally { await browser.close() }
})
