/** Desktop control publication keeps hidden audio owned by a visible native control window. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DesktopVoiceBridge, DesktopVoiceState } from '../types.ts'
import type { VoiceConversation } from './controller.ts'
import { NS } from './locales.ts'

/** Desktop capability owned by one Client plugin instance. */
export interface DesktopVoiceControls {
  readonly available: SnapshotStore<boolean>
  /** Minimize the application only while desktop voice controls are available. */
  minimize(): void
}

/**
 * Connect native controls without creating another microphone or conversation owner.
 * @param ctx - Client registration lifetime and localized reporting.
 * @param conversation - sole owner of recording and playback.
 * @returns availability and the user-requested minimize action.
 */
export function connectDesktopVoice(ctx: Context, conversation: VoiceConversation): DesktopVoiceControls {
  const bridge = (window as Window & { dshDesktop?: { voice?: DesktopVoiceBridge } }).dshDesktop?.voice
  const available = createSnapshotStore(bridge !== undefined)
  const pending = new Set<Promise<void>>()
  let disposed = false, last = ''
  const t = ctx.locale.bind(NS)
  const failed = (error: unknown): void => {
    ctx.logger.warn('Desktop voice controls failed', error)
    if (disposed || !available.getSnapshot()) return
    available.set(false)
    conversation.state.set({ ...conversation.state.getSnapshot(), error: 'controls' })
    const cleanup = conversation.stop().then(async () => { if (bridge) await bridge.publish(null) })
      .catch((failure: unknown) => { ctx.logger.warn('Voice audio cleanup failed', failure) })
    pending.add(cleanup)
    void cleanup.finally(() => { pending.delete(cleanup) })
  }
  const observe = (request: Promise<void>): void => {
    const operation = request.catch(failed).finally(() => { pending.delete(operation) })
    pending.add(operation)
  }
  const publish = (): void => {
    if (!bridge || disposed || !available.getSnapshot()) return
    const current = conversation.state.getSnapshot()
    const state: DesktopVoiceState | null = current.phase === 'idle' ? null : {
      phase: current.phase, microphoneMuted: current.microphoneMuted, speakerMuted: current.speakerMuted,
      labels: {
        status: current.error ? t(`error.${current.error}`)
          : current.microphoneMuted && current.phase === 'listening' ? t('microphoneMuted') : t(`phase.${current.phase}`),
        muteMicrophone: t('muteMicrophone'), unmuteMicrophone: t('unmuteMicrophone'),
        muteSpeaker: t('muteSpeaker'), unmuteSpeaker: t('unmuteSpeaker'), end: t('end'), restore: t('restore'),
      },
    }
    const serialized = JSON.stringify(state)
    if (serialized === last) return
    last = serialized
    observe(bridge.publish(state))
  }
  if (bridge) ctx.effect(() => {
    const unobserve = conversation.state.subscribe(publish)
    const unsubscribe = bridge.subscribe((command) => {
      if (disposed) return
      if (command === 'microphone') conversation.toggleMicrophone()
      else if (command === 'speaker') conversation.toggleSpeaker()
      else if (command === 'end') void conversation.stop().catch(failed)
      else if (command === 'unavailable') failed(new Error('Desktop voice window is unavailable'))
      // Window restoration belongs to the shell; it does not create another voice conversation.
    })
    publish()
    return async () => {
      disposed = true
      unsubscribe(); unobserve()
      await conversation.stop()
      await Promise.all(pending)
      await bridge.publish(null)
    }
  })
  ctx.on('locale/change', publish)
  return { available, minimize: () => {
    if (bridge && available.getSnapshot()) observe(bridge.minimize())
  } }
}
