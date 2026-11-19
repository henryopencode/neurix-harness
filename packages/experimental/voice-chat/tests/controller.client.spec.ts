/** Voice input follows normal Session admission and invalidates late asynchronous results. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionFace, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import { FixtureSession, sessionSnapshot } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SpeechCatalog } from '@deepseek-ai/dsh-experimental-api-speech-to-text/types'
import type { VoiceOptions } from '../src/types.ts'
import type { LiveAudio } from '../src/client/audio.ts'
import { VoiceConversation, type VoiceConversationDependencies } from '../src/client/controller.ts'

const sid = 'voice-session' as SessionId
const options: VoiceOptions = { speechThreshold: 0.02, silenceMs: 300, minimumSpeechMs: 150,
  preRollMs: 200, maxUtteranceSeconds: 2, maxSentenceCharacters: 100, maxPendingSentences: 32, warmupText: '你好。', voice: 'natural', playbackBufferMs: 320, playbackResumeTimeoutMs: 5000 }

function fixture() {
  const audio = { start: vi.fn<LiveAudio['start']>(async () => {}), play: vi.fn<LiveAudio['play']>(async (_audio, _signal, started) => { started?.() }),
    finishPlayback: vi.fn(), interrupt: vi.fn(), setMicrophoneMuted: vi.fn(), setSpeakerMuted: vi.fn(), dispose: vi.fn(async () => {}) }
  const prompt = vi.fn<SessionFace['prompt']>(async () => ({ ok: true, value: { accepted: true } }))
  const cancel = vi.fn<SessionFace['cancel']>(async () => ({ ok: true, value: { accepted: true } }))
  const root = new Context()
  onTestFinished(async () => { await root.fiber.dispose() })
  const scope = createScope(root, sid)
  const session = new FixtureSession(sid, createSnapshotStore({ ...sessionSnapshot(sid), running: true }), { prompt, cancel })
  const binding = { sessionId: sid, session, eventSource: session.eventSource, ctx: scope.ctx }
  const release = vi.fn()
  const reference = { sessionId: sid, binding, ready: Promise.resolve(binding),
    release, [Symbol.dispose]: release } satisfies SessionReference
  const dependencies: VoiceConversationDependencies = {
    createAudio: () => audio, retain: () => reference, warm: vi.fn(async () => {}),
    catalog: () => ({ maxAudioBytes: 10000 } as SpeechCatalog),
    transcribe: vi.fn<VoiceConversationDependencies['transcribe']>(async () => ({
      ok: true, value: { text: '请检查代码', audioSeconds: 1, inferenceSeconds: 0.1 } })),
    synthesize: vi.fn<VoiceConversationDependencies['synthesize']>(async (_text, _voice, _signal, accept) => {
      accept({ pcmBase64: 'AAAAAA==', sampleRate: 24000 })
    }),
  }
  const conversation = new VoiceConversation(dependencies)
  return { conversation, dependencies, audio, prompt, cancel, release,
    speech: () => { audio.start.mock.calls[0]![1]() },
    utterance: () => { audio.start.mock.calls[0]![2](new Uint8Array(100)) },
  }
}

it('routes microphone and speaker mute controls to the same audio owner without releasing the Session', async () => {
  const b = fixture()
  await b.conversation.start(sid, options, [], 0)
  b.conversation.toggleMicrophone(); b.conversation.toggleSpeaker()
  expect(b.audio.setMicrophoneMuted).toHaveBeenLastCalledWith(true)
  expect(b.audio.setSpeakerMuted).toHaveBeenLastCalledWith(true)
  expect(b.conversation.state.getSnapshot()).toMatchObject({ microphoneMuted: true, speakerMuted: true })
  expect(b.release).not.toHaveBeenCalled()
  b.conversation.toggleMicrophone(); b.conversation.toggleSpeaker()
  expect(b.audio.setMicrophoneMuted).toHaveBeenLastCalledWith(false)
  expect(b.audio.setSpeakerMuted).toHaveBeenLastCalledWith(false)
  await b.conversation.stop()
  expect(b.release).toHaveBeenCalledOnce()
})

it('keeps capture muted until local warmup completes and ignores early microphone callbacks', async () => {
  const b = fixture(), warm = Promise.withResolvers<undefined>()
  vi.mocked(b.dependencies.warm).mockReturnValue(warm.promise)
  const starting = b.conversation.start(sid, { ...options, voice: 'warm' }, [], 0)
  await vi.waitFor(() => { expect(b.audio.start).toHaveBeenCalledOnce() })
  expect(b.conversation.state.getSnapshot().phase).toBe('warming')
  expect(b.audio.setMicrophoneMuted).toHaveBeenLastCalledWith(true)
  b.speech(); b.utterance()
  expect(b.dependencies.transcribe).not.toHaveBeenCalled()
  expect(b.dependencies.warm).toHaveBeenCalledWith('warm', expect.any(AbortSignal))
  warm.resolve(undefined); await starting
  expect(b.conversation.state.getSnapshot().phase).toBe('listening')
  expect(b.audio.setMicrophoneMuted).toHaveBeenLastCalledWith(false)
  await b.conversation.stop()
})

it('shows thinking for a typed message and keeps the selected voice throughout queued playback', async () => {
  const b = fixture(), first = Promise.withResolvers<undefined>(), second = Promise.withResolvers<undefined>()
  b.audio.play.mockImplementationOnce(async (_audio, _signal, started) => { started?.(); await first.promise })
    .mockImplementationOnce(async (_audio, _signal, started) => { started?.(); await second.promise })
  await b.conversation.start(sid, { ...options, voice: 'calm', maxSentenceCharacters: 20 }, [], 0)
  b.conversation.observe(sid, [], 1, true)
  expect(b.conversation.state.getSnapshot().phase).toBe('thinking')
  const reply = { key: '1/1', turn: 1, step: 1, text: `${'一'.repeat(19)}。${'二'.repeat(19)}。`, final: true }
  b.conversation.observe(sid, [reply], 1, false)
  await vi.waitFor(() => { expect(b.dependencies.synthesize).toHaveBeenCalledTimes(2) })
  expect(vi.mocked(b.dependencies.synthesize).mock.calls.every(call => call[1] === 'calm')).toBe(true)
  first.resolve(undefined)
  await first.promise
  expect(b.conversation.state.getSnapshot().phase).toBe('speaking')
  second.resolve(undefined)
  await vi.waitFor(() => { expect(b.conversation.state.getSnapshot().phase).toBe('listening') })
  await b.conversation.stop()
})

it('joins cancelled inference before releasing the retained Session', async () => {
  const b = fixture(), inference = Promise.withResolvers<undefined>()
  vi.mocked(b.dependencies.synthesize).mockImplementation(async () => { await inference.promise })
  await b.conversation.start(sid, options, [], 0)
  b.conversation.observe(sid, [{ key: '1/1', turn: 1, step: 1, text: '正在回复。', final: true }], 1)
  await vi.waitFor(() => { expect(b.dependencies.synthesize).toHaveBeenCalledOnce() })
  const stopping = b.conversation.stop()
  expect(vi.mocked(b.dependencies.synthesize).mock.calls[0]![2].aborted).toBe(true)
  expect(b.release).not.toHaveBeenCalled()
  inference.resolve(undefined); await stopping
  expect(b.release).toHaveBeenCalledOnce()
})

it('joins short queued sentences before starting another synthesis request', async () => {
  const b = fixture(), inference = Promise.withResolvers<undefined>()
  vi.mocked(b.dependencies.synthesize).mockImplementationOnce(async () => { await inference.promise })
  await b.conversation.start(sid, options, [], 0)
  const reply = { key: '1/1', turn: 1, step: 1, text: '第一句。', final: false }
  b.conversation.observe(sid, [reply], 1)
  await vi.waitFor(() => { expect(b.dependencies.synthesize).toHaveBeenCalledOnce() })
  b.conversation.observe(sid, [{ ...reply, text: '第一句。第二句。' }], 1)
  b.conversation.observe(sid, [{ ...reply, text: '第一句。第二句。第三句。', final: true }], 1)
  inference.resolve(undefined)
  await vi.waitFor(() => { expect(b.dependencies.synthesize).toHaveBeenCalledTimes(2) })
  expect(vi.mocked(b.dependencies.synthesize).mock.calls[1]![0]).toBe('第二句。第三句。')
  await b.conversation.stop()
})

it('keeps controls in the stopping state until audio release settles', async () => {
  const b = fixture(), released = Promise.withResolvers<undefined>()
  b.audio.dispose.mockReturnValue(released.promise)
  await b.conversation.start(sid, options, [], 0)
  const stopping = b.conversation.stop()
  expect(b.conversation.state.getSnapshot().phase).toBe('stopping')
  expect(b.release).not.toHaveBeenCalled()
  released.resolve(undefined)
  await stopping
  expect(b.conversation.state.getSnapshot().phase).toBe('idle')
})

it('submits recognized text through Session admission and speaks each new visible sentence once', async () => {
  const b = fixture()
  const old = { key: '1/1', turn: 1, step: 1, text: 'Old response.', final: true }
  try {
    await b.conversation.start(sid, options, [old], 1)
    b.conversation.observe(sid, [old], 1)
    expect(b.dependencies.synthesize).not.toHaveBeenCalled()
    b.speech(); b.utterance()
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledWith(
      [{ type: 'text', text: '请检查代码' }], 'steer', expect.any(AbortSignal), expect.any(String)) })
    expect(b.cancel).not.toHaveBeenCalled()
    const reply = { key: '2/1', turn: 2, step: 1, text: '检查完成。', final: false }
    b.conversation.observe(sid, [old, reply], 2)
    await vi.waitFor(() => { expect(b.audio.play).toHaveBeenCalledTimes(1) })
    b.conversation.observe(sid, [{ ...reply, final: true }], 2)
    expect(b.dependencies.synthesize).toHaveBeenCalledTimes(1)
  } finally { await b.conversation.stop() }
  expect(b.audio.dispose).toHaveBeenCalledTimes(1); expect(b.release).toHaveBeenCalledTimes(1)
  b.conversation.observe(sid, [{ key: '3/1', turn: 3, step: 1, text: 'Late.', final: true }], 3)
  expect(b.dependencies.synthesize).toHaveBeenCalledTimes(1)
})

it('speaks the next assistant step when a voice message steers the current turn', async () => {
  const b = fixture()
  const old = { key: '1/1', turn: 1, step: 1, text: '先前的回复。', final: true }
  try {
    await b.conversation.start(sid, options, [old], 1)
    b.conversation.observe(sid, [old], 1)
    b.speech(); b.utterance()
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledOnce() })
    const reply = { key: '1/2', turn: 1, step: 2, text: '这是新的语音回复。', final: true }
    b.conversation.observe(sid, [old, reply], 1)
    await vi.waitFor(() => { expect(b.dependencies.synthesize).toHaveBeenCalledOnce() })
    expect(vi.mocked(b.dependencies.synthesize).mock.calls[0]![0]).toBe(reply.text)
  } finally { await b.conversation.stop() }
})

it('aborts playback at speech onset and never submits a stale recognition result', async () => {
  const b = fixture(), recognized = Promise.withResolvers<Awaited<ReturnType<VoiceConversationDependencies['transcribe']>>>()
  vi.spyOn(b.dependencies, 'transcribe').mockImplementation(async () => await recognized.promise)
  try {
    await b.conversation.start(sid, options, [], 0)
    b.speech(); b.utterance()
    await vi.waitFor(() => { expect(b.dependencies.transcribe).toHaveBeenCalledTimes(1) })
    b.speech()
    expect(b.audio.interrupt).toHaveBeenCalledTimes(2)
    recognized.resolve({ ok: true, value: { text: 'stale', audioSeconds: 1, inferenceSeconds: 0 } })
    await recognized.promise
    await b.conversation.stop()
    expect(b.prompt).not.toHaveBeenCalled()
  } finally { await b.conversation.stop() }
})

it('preserves uncertain-delivery text and stops automatic work after a submission failure', async () => {
  const b = fixture()
  b.prompt.mockRejectedValueOnce(new Error('connection lost after admission'))
  try {
    await b.conversation.start(sid, options, [], 0)
    b.speech(); b.utterance()
    await vi.waitFor(() => { expect(b.conversation.state.getSnapshot()).toMatchObject({ phase: 'idle', error: 'send', transcript: '请检查代码' }) })
    expect(b.prompt).toHaveBeenCalledTimes(1)
    expect(b.audio.dispose).toHaveBeenCalledTimes(1)
  } finally { await b.conversation.stop() }
})

it('invalidates a microphone permission grant when the conversation closes', async () => {
  const b = fixture(), grant = Promise.withResolvers<undefined>()
  b.audio.start.mockReturnValueOnce(grant.promise)
  const starting = b.conversation.start(sid, options, [], 0)
  await vi.waitFor(() => { expect(b.audio.start).toHaveBeenCalledTimes(1) })
  await b.conversation.stop()
  grant.resolve(undefined); await starting
  expect(b.conversation.state.getSnapshot()).toMatchObject({ phase: 'idle', sessionId: sid })
  expect(b.audio.dispose).toHaveBeenCalledTimes(1)
})

it('bounds queued speech and resumes a long answer as playback releases capacity', async () => {
  const b = fixture()
  const playing: PromiseWithResolvers<undefined>[] = []
  b.audio.play.mockImplementation(() => {
    const playback = Promise.withResolvers<undefined>(); playing.push(playback); return playback.promise
  })
  b.audio.dispose.mockImplementation(async () => { for (const playback of playing) playback.resolve(undefined) })
  try {
    await b.conversation.start(sid, { ...options, maxSentenceCharacters: 20, maxPendingSentences: 2 }, [], 0)
    b.speech(); b.utterance()
    await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledTimes(1) })
    const text = `${'一'.repeat(19)}。`.repeat(10)
    b.conversation.observe(sid, [{ key: '1/1', turn: 1, step: 1, text, final: true }], 1)
    await vi.waitFor(() => { expect(b.audio.play).toHaveBeenCalledTimes(2) })
    expect(b.dependencies.synthesize).toHaveBeenCalledTimes(2)
    for (let index = 0; index < 10; index++) {
      await vi.waitFor(() => { expect(playing[index]).toBeDefined() })
      playing[index]!.resolve(undefined)
    }
    await vi.waitFor(() => { expect(b.conversation.state.getSnapshot()).toMatchObject({ phase: 'listening', error: null }) })
    expect(vi.mocked(b.dependencies.synthesize).mock.calls.map(call => call[0]).join('')).toBe(text)
  } finally { await b.conversation.stop() }
})
