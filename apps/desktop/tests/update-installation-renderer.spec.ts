import { readFileSync } from 'node:fs'
import { runInContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { expect, it, onTestFinished, vi } from 'vitest'
import { formatDesktopMessage, resolveDesktopLocale } from '../src/locale.ts'
import type { UpdateDialogApi, UpdateDialogView } from '../src/update-dialog.ts'

function fixture() {
  const dom = new JSDOM(readFileSync(new URL('../renderer/update-dialog.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' })
  onTestFinished(() => { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close() })
  const frames: FrameRequestCallback[] = []
  dom.window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length }
  const transition = Promise.withResolvers<undefined>()
  const element = (id: string): HTMLElement => {
    const value = dom.window.document.getElementById(id)
    if (value === null) throw new Error(`Missing update element: ${id}`)
    return value
  }
  Object.defineProperty(element('installation'), 'getAnimations', { value: () => [{ finished: transition.promise }] })
  element('installation').style.opacity = '1'
  const locale = resolveDesktopLocale('zh-CN')
  const state: UpdateDialogView = { revision: 1, locale: locale.id, title: locale.messages.updateTitle,
    message: locale.messages.updateInstallingTitle, detail: locale.messages.mandatoryRestarting, installationVersion: '1.1.1',
    installationVersionLabel: formatDesktopMessage(locale.messages.updateInstallationVersion, { version: '1.1.1' }),
    buttons: [], cancelId: -1, closeLabel: locale.messages.updateClose, technicalDetails: '',
    technicalDetailsLabel: locale.messages.updateTechnicalDetails }
  let publish!: (view: UpdateDialogView | null) => void
  const covered = vi.fn(async () => {})
  const respond = vi.fn(async () => {})
  const unsubscribe = vi.fn()
  const api: UpdateDialogApi = { status: async () => state, covered, respond,
    subscribe: (listener) => { publish = listener; return unsubscribe } }
  Object.defineProperty(dom.window, 'dshUpdateDialog', { value: api })
  runInContext(readFileSync(new URL('../renderer/update-dialog.js', import.meta.url), 'utf8'), dom.getInternalVMContext())
  const paint = async () => { for (const callback of frames.splice(0)) callback(0); await Promise.resolve() }
  return { dom, state, element, transition, paint, covered, respond,
    publish: (next: UpdateDialogView | null) => { publish(next) }, unsubscribe }
}

it('acknowledges coverage only after the opaque entrance and subsequent paint', async () => {
  const f = fixture()
  await Promise.resolve()
  expect(f.element('installation-title').textContent).toBe('正在更新 Neurix Harness')
  expect(f.element('installation-version').textContent).toBe('V1.1.1')
  expect(f.dom.window.document.body.classList.contains('installing')).toBe(true)
  expect(f.element('dialog').inert).toBe(true)
  expect(f.element('installation').inert).toBe(false)
  expect(f.dom.window.document.activeElement).toBe(f.element('installation'))
  for (const key of ['Escape', 'Tab']) {
    f.dom.window.document.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key, cancelable: true }))
  }
  expect(f.respond).not.toHaveBeenCalled()
  await f.paint()
  expect(f.covered).not.toHaveBeenCalled()
  f.transition.resolve(undefined)
  await Promise.resolve()
  await f.paint()
  expect(f.covered).not.toHaveBeenCalled()
  await f.paint()
  await f.paint()
  expect(f.covered).toHaveBeenCalledExactlyOnceWith(1)
  const failure = { ...f.state, revision: 2, message: '更新失败', buttons: ['重试'], cancelId: 0 }
  delete failure.installationVersion
  delete failure.installationVersionLabel
  f.publish(failure)
  expect(f.element('installation').inert).toBe(true)
  expect(f.dom.window.document.body.classList.contains('installation-backdrop')).toBe(true)
  expect(f.dom.window.document.activeElement).toBe(f.element('dialog'))
  expect(f.element('actions').textContent).toBe('重试')
})

it('uses the main-owned version label without adding a renderer prefix', async () => {
  const f = fixture()
  await Promise.resolve()
  f.publish({ ...f.state, revision: 2, installationVersion: '1.2.0-nightly.2',
    installationVersionLabel: 'Version 1.2.0-nightly.2' })
  expect(f.element('installation-version').textContent).toBe('Version 1.2.0-nightly.2')
})

it('does not acknowledge an entrance replaced by a failure', async () => {
  const f = fixture()
  await Promise.resolve()
  await f.paint()
  const failure = { ...f.state, revision: 2, message: '更新失败', buttons: ['关闭'], cancelId: 0 }
  delete failure.installationVersion
  delete failure.installationVersionLabel
  f.publish(failure)
  f.transition.resolve(undefined)
  await Promise.resolve()
  await f.paint()
  await f.paint()
  await f.paint()
  expect(f.covered).not.toHaveBeenCalled()
})
