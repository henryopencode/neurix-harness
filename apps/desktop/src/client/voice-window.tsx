/** Render compact voice controls without starting another Host, microphone, or conversation. */
import '@deepseek-ai/dsh-client-ui-theme/src/styles/base.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/corner-shape.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/focus.css'
import '@deepseek-ai/dsh-client-ui-theme/src/styles/gradient-shadow-text.css'
import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives/src/Button.tsx'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives/src/Tooltip.tsx'
import { VoiceOrb } from '@deepseek-ai/dsh-client-ui-primitives/src/VoiceOrb.tsx'
import { ICON_SYMBOLS, type IconSymbolId } from '@deepseek-ai/dsh-client-ui-primitives/src/icons/artwork.ts'
import type { DesktopVoiceCommand } from '@deepseek-ai/dsh-voice-chat/types'
import type { VoiceWindowApi, VoiceWindowSnapshot } from '../voice-window-protocol.ts'
import './voice-window.css'

declare global { interface Window { dshVoiceWindow: VoiceWindowApi } }

const tooltipOptions = { portal: true, maxWidth: 160, delayMs: 500 } as const

function VoiceIcon({ id }: { id: IconSymbolId }) {
  return <span className="voice-icon" aria-hidden dangerouslySetInnerHTML={{ __html: ICON_SYMBOLS[id] }} />
}

function VoiceWindow({ api }: { api: VoiceWindowApi }) {
  const [snapshot, setSnapshot] = useState<VoiceWindowSnapshot>({ revision: -1, state: null })
  const act = useCallback((command: DesktopVoiceCommand): void => {
    void api.command(command).catch((error: unknown) => { console.error('Desktop voice action failed', error) })
  }, [api])
  useEffect(() => {
    let live = true
    const accept = (next: VoiceWindowSnapshot): void => {
      if (live) setSnapshot(previous => next.revision >= previous.revision ? next : previous)
    }
    const unsubscribe = api.subscribe(accept)
    void api.state().then(accept).catch((error: unknown) => {
      if (!live) return
      console.error('Desktop voice state unavailable', error)
      act('restore'); act('end')
    })
    return () => { live = false; unsubscribe() }
  }, [api, act])
  const state = snapshot.state
  if (!state) return null
  const { labels } = state, stopping = state.phase === 'stopping'
  return <main className="voice-window" data-voice-window={state.phase}>
    <Tooltip label={labels.restore} side="bottom" {...tooltipOptions}>
      <button type="button" className="voice-orb" aria-label={labels.restore} onClick={() => { act('restore') }}>
        <VoiceOrb phase={state.phase} visible={!stopping} inputLevel={state.inputLevel ?? 0} sentCount={state.sentCount ?? 0} />
      </button>
    </Tooltip>
    <div className="voice-status" role="status">{labels.status}</div>
    <div className="voice-controls">
      <Tooltip label={state.microphoneMuted ? labels.unmuteMicrophone : labels.muteMicrophone} side="top" {...tooltipOptions}>
        <Button className="voice-control" aria-label={state.microphoneMuted ? labels.unmuteMicrophone : labels.muteMicrophone}
          aria-pressed={state.microphoneMuted} disabled={stopping} onClick={() => { act('microphone') }}>
          <span className={state.microphoneMuted ? 'voice-muted' : undefined}><VoiceIcon id="dsw-icon-microphone-outline-regular" /></span>
        </Button>
      </Tooltip>
      <Tooltip label={labels.end} side="top" {...tooltipOptions}><Button className="voice-control voice-end" aria-label={labels.end} disabled={stopping}
        onClick={() => { act('end') }}><VoiceIcon id="dsw-icon-close-outline-regular" /></Button></Tooltip>
      <Tooltip label={state.speakerMuted ? labels.unmuteSpeaker : labels.muteSpeaker} side="top" {...tooltipOptions}>
        <Button className="voice-control" aria-label={state.speakerMuted ? labels.unmuteSpeaker : labels.muteSpeaker}
          aria-pressed={state.speakerMuted} disabled={stopping} onClick={() => { act('speaker') }}>
          <span className={state.speakerMuted ? 'voice-muted' : undefined}><span className="voice-speaker" aria-hidden /></span>
        </Button>
      </Tooltip>
    </div>
  </main>
}

const root = document.getElementById('root')
if (!root) throw new Error('Desktop voice window root is missing')
const renderer = createRoot(root)
const scheme = matchMedia('(prefers-color-scheme: dark)')
const theme = (): void => { document.body.toggleAttribute('data-ds-dark-theme', scheme.matches) }
theme(); scheme.addEventListener('change', theme)
renderer.render(<VoiceWindow api={window.dshVoiceWindow} />)
window.addEventListener('pagehide', () => { scheme.removeEventListener('change', theme); renderer.unmount() }, { once: true })
