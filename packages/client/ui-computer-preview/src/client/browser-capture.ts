/** One session's isolated browser feed, shared by both Client views. @module */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionGenerationState } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { BrowserPreviewOpenId, ComputerPreviewFrame } from '../types.ts'
import { BrowserPictureInPicture } from './ComputerPreview.tsx'
import { BrowserViewport } from './BrowserViewport.tsx'
import { BROWSER_CAPTURE, BROWSER_CAPTURE_PREFIX, browserCaptureAddress, browserCaptureSession } from './browser-capture-address.ts'
import type { BrowserCapture } from './browser-capture-address.ts'
import type { PreviewSource } from './preview-ui.ts'

/** One wake-up for a capture delay, retry, selection change, or reconnect. */
function waitForCapture(
  signal: AbortSignal,
  watch: readonly ((notify: () => void) => () => void)[],
  delay?: number,
): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const subscriptions = watch.map(subscribe => subscribe(done))
    const timer = delay === undefined ? undefined : setTimeout(done, delay)
    signal.addEventListener('abort', done, { once: true })
    function done() {
      if (timer !== undefined) clearTimeout(timer)
      for (const unsubscribe of subscriptions) unsubscribe()
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

const idle: BrowserCapture = { frame: { kind: 'idle' }, aspect: 1.6 }

/**
 * Register the session resource and its transient workspace and picture-in-picture views.
 * @param ctx - source owner's registration lifetime.
 * @param services - services injected into the shared preview plugin.
 * @param source - authenticated capture for the browser plugin's exact Session.
 * @param connection - connection generations that own the remote requests.
 * @returns withdrawal of live tabs, view registrations, and capture subscriptions.
 */
export function registerBrowserPreview(ctx: Context,
  services: Pick<Context, 'sidebarRight' | 'sidebarRightTabs' | 'resources' | 'locale'>,
  source: PreviewSource, connection: ConnectionGenerationState,
): () => Promise<void> {
  const { sidebarRight, sidebarRightTabs, resources, locale } = services
  const { mounted } = sidebarRight
  const t = locale.bind('computerPreview')
  const revealed = new Map<SessionId, BrowserPreviewOpenId>()
  const retries = new EventTarget()
  const close = (sessionId?: SessionId) => {
    for (const tab of sidebarRight.openTabs.getSnapshot()) {
      if (tab.kind === BROWSER_CAPTURE && (sessionId === undefined || tab.sessionId === sessionId)) {
        sidebarRight.closeIn(tab.sessionId, tab.tabId)
      }
    }
  }
  const updateTab = (id: SessionId, frame: ComputerPreviewFrame) => {
    if (frame.kind === 'idle') {
      revealed.delete(id)
      close(id)
    } else if (frame.openId !== undefined && revealed.get(id) !== frame.openId) {
      const address = browserCaptureAddress(id)
      sidebarRight.openResourceIn(id, address, { kind: BROWSER_CAPTURE, destination: 'sidebar' })
      if (sidebarRight.tabsIn(id).some(tab => tab.contentId === address)) revealed.set(id, frame.openId)
    }
  }
  const unregisterType = ctx.effect(() => sidebarRightTabs.register({
    id: BROWSER_CAPTURE, kind: BROWSER_CAPTURE, priority: 'builtin', persist: false,
    patterns: [BROWSER_CAPTURE_PREFIX + '**'], canOpen: (address) => {
      const id = browserCaptureSession(address)
      return id !== undefined && id === mounted.getSnapshot()
    },
    title: () => t('agentBrowserTab'),
  }), 'computer-preview: browser tab type')
  const unregisterProvider = ctx.effect(() => resources.register({
    protocol: BROWSER_CAPTURE,
    async *open(address, { signal }): AsyncIterable<RemoteResult<BrowserCapture>> {
      const sessionId = browserCaptureSession(address)
      if (sessionId === undefined) return
      const watches = [
        (notify: () => void) => mounted.subscribe(notify),
        (notify: () => void) => connection.subscribe(notify),
        (notify: () => void) => {
          retries.addEventListener(sessionId, notify)
          return () => { retries.removeEventListener(sessionId, notify) }
        },
      ]
      let delay: number | undefined
      let currentGeneration: number | undefined
      for (;;) {
        if (signal.aborted) return
        const generation = connection.getSnapshot()?.id
        if (mounted.getSnapshot() !== sessionId || generation === undefined) {
          if (currentGeneration !== undefined && generation === undefined) {
            currentGeneration = undefined
            yield { ok: true, value: idle }
            continue
          }
          await waitForCapture(signal, watches)
          continue
        }
        currentGeneration = generation
        const current = () => mounted.getSnapshot() === sessionId && connection.getSnapshot()?.id === generation
        const selection = new AbortController()
        const invalidate = () => { if (!current()) selection.abort() }
        const unwatchSession = mounted.subscribe(invalidate)
        const unwatchConnection = connection.subscribe(invalidate)
        const request = AbortSignal.any([signal, selection.signal])
        let result: RemoteResult<BrowserCapture>
        try {
          const { frame, refreshMs } = await source.loadPreview(sessionId, request)
          request.throwIfAborted()
          delay = refreshMs
          let aspect = idle.aspect
          if (frame.kind === 'frame') {
            const image = new Image()
            image.src = frame.imageUrl
            await image.decode()
            aspect = image.naturalWidth / image.naturalHeight
          }
          result = { ok: true, value: { frame, aspect } }
        } catch (error) {
          if (request.aborted) continue
          console.error('Computer preview request failed:', error)
          result = { ok: false, error: new RemoteError('gateway/internal', 'Browser capture could not be displayed', {}, { cause: error }) }
        } finally {
          unwatchConnection()
          unwatchSession()
        }
        if (request.aborted || !current()) continue
        if (result.ok) updateTab(sessionId, result.value.frame)
        yield result
        await waitForCapture(signal, watches, delay)
      }
    },
  }), 'computer-preview: browser capture')
  const retry = (id: SessionId) => { retries.dispatchEvent(new Event(id)) }
  const pane = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: BROWSER_CAPTURE, locale: 'computerPreview', inject: () => ({ retry }),
  }, BrowserViewport))
  const pip = ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id: 'browser-control.preview', locale: 'computerPreview', inject: () => ({ retry }),
  }, BrowserPictureInPicture))
  return async () => {
    close()
    pane()
    pip()
    await unregisterProvider()
    await unregisterType()
  }
}
