/** Render compact voice controls without starting another Host, microphone, or conversation. */
import '@deepseek-ai/dsh-client-ui-theme/src/styles/design-platform.css'
import { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, IconChevronUpOutlineRegular, IconCloseOutlineRegular, IconMicrophoneOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DesktopVoiceCommand } from '@deepseek-ai/dsh-voice-chat/types'
import type { VoiceWindowApi, VoiceWindowSnapshot } from '../voice-window-protocol.ts'
import './voice-window.css'

declare global { interface Window { dshVoiceWindow: VoiceWindowApi } }

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
    <div className="voice-orb" data-phase={state.phase} data-muted={state.microphoneMuted} aria-hidden />
    <div className="voice-status" role="status">{labels.status}</div>
    <div className="voice-controls">
      <Tooltip label={state.microphoneMuted ? labels.unmuteMicrophone : labels.muteMicrophone} side="top" portal>
        <Button className="voice-control" aria-label={state.microphoneMuted ? labels.unmuteMicrophone : labels.muteMicrophone}
          aria-pressed={state.microphoneMuted} disabled={stopping} onClick={() => { act('microphone') }}>
          <span className={state.microphoneMuted ? 'voice-muted' : undefined}><IconMicrophoneOutlineRegular size={20} /></span>
        </Button>
      </Tooltip>
      <Tooltip label={state.speakerMuted ? labels.unmuteSpeaker : labels.muteSpeaker} side="top" portal>
        <Button className="voice-control" aria-label={state.speakerMuted ? labels.unmuteSpeaker : labels.muteSpeaker}
          aria-pressed={state.speakerMuted} disabled={stopping} onClick={() => { act('speaker') }}>
          <span className={state.speakerMuted ? 'voice-muted' : undefined}><span className="voice-speaker" aria-hidden /></span>
        </Button>
      </Tooltip>
      <Tooltip label={labels.end} side="top" portal><Button className="voice-control" aria-label={labels.end} disabled={stopping}
        onClick={() => { act('end') }}><IconCloseOutlineRegular size={20} /></Button></Tooltip>
      <Tooltip label={labels.restore} side="top" portal><Button className="voice-control" aria-label={labels.restore}
        onClick={() => { act('restore') }}><IconChevronUpOutlineRegular size={20} /></Button></Tooltip>
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
