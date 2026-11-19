/** Exercise normal Session admission, long spoken replies, and barge-in through Web Audio. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-voice-chat'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { VoiceStatus } from '@deepseek-ai/dsh-voice-chat/types'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { launchWebScaffold, webSnapshotMode, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

interface PlayedAudio {
  start: number
  duration: number
  cancelled: boolean
}
interface VoiceResponseProof {
  speak: () => void
  audible: () => boolean
  output?: AudioContext
  playback: PlayedAudio[]
  tracks: MediaStreamTrack[]
}
declare global { interface Window { voiceResponseProof: VoiceResponseProof } }

const bundle = fileURLToPath(new URL('../../../packages/experimental/voice-chat-bundle', import.meta.url))
const cachedBreeze = process.env.DSH_VOICE_MODEL_CACHE
const cachedSenseVoice = process.env.DSH_VOICE_RECOGNITION_CACHE
const spokenFixture = process.env.DSH_VOICE_SPEECH_WAV

it.skipIf(webSnapshotMode() === 'record')('plays a long streamed reply, interrupts the next reply, then speaks again and returns to typing', async () => {
  if (cachedSenseVoice && !spokenFixture) throw new Error('DSH_VOICE_RECOGNITION_CACHE requires DSH_VOICE_SPEECH_WAV')
  const root = await mkdtemp(join(tmpdir(), 'dsh-voice-response-'))
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  const releaseReply = Promise.withResolvers<undefined>()
  onTestFinished(async () => {
    releaseReply.resolve(undefined)
    try { await resources.browser?.close() } finally {
      try { await resources.scaffold?.close() } finally { await rm(root, { recursive: true, force: true }) }
    }
  })
  const overlay = join(root, 'voice.yml'), replay = join(root, 'replies.json')
  const long = [
    '我们先从一个简单的例子开始。',
    '每次散步的时候，可以选一条自己熟悉的小路，走得慢一点，仔细听路边的鸟叫，也可以观察同一棵树在不同季节里的变化。',
    '如果天气不好，就坐在窗边，泡一杯茶，打开一本自己喜欢的书。读几页就停下来，想一想作者为什么从这个角度讲故事。',
    '最后把看到或者想到的一件小事写下来。几天之后重新读一遍，你会发现那些原本不起眼的细节，其实有很多值得留意的地方。',
  ]
  const second = ['我们换一个话题。', ...long.slice(1)]
  const short = ['好，我们接着聊。']
  await writeFile(replay, JSON.stringify([long, second, short, ['DONE']].map(parts => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'Do not speak reasoning.' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Do not speak reasoning.' } },
    { type: 'block-start', index: 1, blockType: 'text' },
    ...parts.map(text => ({ type: 'text-delta', index: 1, text })),
    { type: 'block-end', index: 1, block: { type: 'text', text: parts.join('') } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }))))
  const speech = cachedSenseVoice ? `config:\n    dataRoot: ${JSON.stringify(cachedSenseVoice)}` : 'disabled: true'
  await writeFile(overlay, `- id: speech-to-text-sensevoice\n  ${speech}\n- id: voice-chat\n  config:\n    dataRoot: ${JSON.stringify(cachedBreeze ?? join(root, 'models'))}\n`)
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: bundle, enabled: true }] },
    extraOverlayPath: [fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)), overlay],
    replayFixture: join(root, 'override-only.jsonl'), replayOverride: replay, compareReplaySession: false, paceMs: 160 })
  resources.scaffold = scaffold
  const synthesize = vi.spyOn(scaffold.ctx.voiceChat, 'synthesize')
  onTestFinished(() => { synthesize.mockRestore() })
  if (cachedBreeze) scaffold.ctx.voiceChat.prepare()
  else {
    const ready: VoiceStatus = { phase: 'ready', model: 'mlx-4bit', operation: null, completedBytes: 0,
      downloadBytes: 3_000_000_000, hardware: { platform: 'darwin', architecture: 'arm64', memoryBytes: 16 * 1024 ** 3 } }
    const follow = vi.spyOn(scaffold.ctx.voiceChat, 'follow').mockImplementation(async function* (signal) {
      const stopped = Promise.withResolvers<undefined>(), stop = (): void => { stopped.resolve(undefined) }
      signal.addEventListener('abort', stop, { once: true })
      try { yield ready; if (!signal.aborted) await stopped.promise }
      finally { signal.removeEventListener('abort', stop) }
    })
    const pcm = Buffer.alloc(48_000)
    for (let index = 0; index < pcm.length / 2; index++) {
      pcm.writeInt16LE(Math.round(Math.sin(index / 24000 * 440 * Math.PI * 2) * 16000), index * 2)
    }
    const audio = { pcmBase64: pcm.toString('base64'), sampleRate: 24000 }
    synthesize.mockImplementation(async function* (request) {
      const text = typeof request === 'string' ? request : request.text
      if (text.startsWith(long[0]!)) await releaseReply.promise
      yield audio
    })
    onTestFinished(() => { follow.mockRestore() })
  }
  if (!cachedSenseVoice) await scaffold.ctx.plugin({ inject: ['speechToText'], apply(ctx) {
    ctx.effect(() => ctx.speechToText.register({
      info: { id: 'sensevoice-local' as SpeechProviderId, name: 'Fixture recognizer', location: 'host-local', languages: ['auto'] },
      transcribe: async () => ({ text: '你好，请用中文讲一个散步的故事。', audioSeconds: 1, inferenceSeconds: 0.1 }),
    }))
  } })
  const admitted: string[] = []
  scaffold.ctx.on('session/event', (_session, event) => {
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      admitted.push(event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(''))
    }
  })
  const browser = await chromium.launch(); resources.browser = browser
  const page = await newEnglishPage(browser), watched = watchConsole(page)
  onTestFailed(async () => { await saveFailureShot(page, 'voice-response') })
  await page.addInitScript((recording: string | null) => {
    const capture = new AudioContext({ sampleRate: 16000 })
    const destination = capture.createMediaStreamDestination()
    const playback: PlayedAudio[] = []
    const analysers: AnalyserNode[] = []
    let sample: AudioBuffer | undefined
    const proof: VoiceResponseProof = {
      playback, tracks: destination.stream.getTracks(),
      speak: () => {
        if (!sample) throw new Error('Test microphone is not ready')
        const source = capture.createBufferSource()
        source.buffer = sample; source.connect(destination); source.start()
      },
      audible: () => analysers.some((analyser) => {
        const values = new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(values)
        return values.some(value => Math.abs(value) > 0.005)
      }),
    }
    window.voiceResponseProof = proof
    AudioContext.prototype.createGain = function () {
      const node = BaseAudioContext.prototype.createGain.call(this), analyser = this.createAnalyser()
      node.connect(analyser); analysers.push(analyser); proof.output = this
      return node
    }
    AudioContext.prototype.createBufferSource = function () {
      const node = BaseAudioContext.prototype.createBufferSource.call(this)
      if (this !== proof.output) return node
      const start = node.start.bind(node), stop = node.stop.bind(node)
      const item = { start: 0, duration: 0, cancelled: false }
      node.start = (when, offset, duration) => {
        item.start = when ?? this.currentTime; item.duration = node.buffer?.duration ?? 0
        playback.push(item); start(when, offset, duration)
      }
      node.stop = (when) => { item.cancelled = true; stop(when) }
      return node
    }
    navigator.mediaDevices.getUserMedia = async () => {
      await capture.resume()
      if (recording) sample = await capture.decodeAudioData(Uint8Array.from(atob(recording), value => value.charCodeAt(0)).buffer)
      else {
        sample = capture.createBuffer(1, 12800, 16000)
        const values = sample.getChannelData(0)
        for (let i = 0; i < values.length; i++) values[i] = Math.sin(i / 16000 * 440 * Math.PI * 2) * 0.2
      }
      return destination.stream
    }
    window.addEventListener('pagehide', () => { void capture.close() }, { once: true })
  }, spokenFixture ? (await readFile(spokenFixture)).toString('base64') : null)
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  await page.locator('[data-voice-ready="true"]').waitFor({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click()
  const listening = page.locator('[data-voice-chat="listening"]')
  await listening.waitFor({ timeout: 90_000 })
  const speak = () => page.evaluate(() => { window.voiceResponseProof.speak() })
  const audible = (after: number) => page.waitForFunction(count =>
    window.voiceResponseProof.playback.length > count && window.voiceResponseProof.audible(),
  after, { timeout: 90_000 })
  const playback = () => page.evaluate(() => window.voiceResponseProof.playback)
  const review = await mkdtemp(join(tmpdir(), 'dsh-voice-response-review-'))

  const firstTurn = scaffold.whenTurnSettled(120_000)
  const beforeFirst = Date.now()
  await speak()
  if (!cachedBreeze) {
    await page.locator('[data-voice-chat="thinking"]').waitFor()
    await page.evaluate(async () => { await window.voiceResponseProof.output?.suspend() })
    releaseReply.resolve(undefined)
  }
  await audible(0)
  const firstAudibleMs = Date.now() - beforeFirst
  expect(await page.evaluate(() => window.voiceResponseProof.output?.state)).toBe('running')
  await page.screenshot({ path: join(review, 'long-speaking.png') })
  await firstTurn
  await listening.waitFor({ timeout: 120_000 })
  const uninterrupted = await playback()
  const gaps = uninterrupted.slice(1).map((audio, index) => {
    const preceding = uninterrupted[index]!
    return Math.max(0, audio.start - preceding.start - preceding.duration)
  })
  const largestGapMs = Math.round(1000 * Math.max(0, ...gaps))
  expect(uninterrupted.length).toBeGreaterThan(1)
  expect(uninterrupted.every(audio => !audio.cancelled)).toBe(true)
  expect(synthesize.mock.calls.flatMap(([request]) => typeof request === 'string' || request.text === '你好。' ? [] : [request.text])
    .join('').replaceAll(' ', '')).toBe(long.join(''))

  const secondTurn = scaffold.whenTurnSettled(120_000)
  await speak()
  await audible(uninterrupted.length)
  await secondTurn
  const thirdTurn = scaffold.whenTurnSettled(120_000)
  await speak()
  await page.locator('[data-voice-chat="recording"]').waitFor()
  await page.waitForFunction(() => !window.voiceResponseProof.audible())
  const interrupted = await playback()
  expect(interrupted.slice(uninterrupted.length).some(audio => audio.cancelled)).toBe(true)
  await audible(interrupted.length)
  await thirdTurn
  await listening.waitFor({ timeout: 90_000 })

  const spoken = admitted.slice()
  expect(spoken).toHaveLength(3)
  expect(spoken.every(text => text.includes('散步'))).toBe(true)
  expect(synthesize.mock.calls.every(([request]) => typeof request !== 'string' && request.voice === 'natural'
    && !request.text.includes('reasoning'))).toBe(true)
  await page.getByRole('button', { name: 'End conversation', exact: true }).click()
  await page.getByRole('button', { name: 'Voice chat', exact: true }).waitFor()
  expect(await page.evaluate(() => window.voiceResponseProof.tracks.every(track => track.readyState === 'ended'))).toBe(true)
  const input = page.locator('[data-composer-input]')
  const typed = scaffold.whenTurnSettled(120_000)
  await input.fill('Continue by typing.')
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await typed
  await page.getByText('DONE', { exact: true }).waitFor()
  expect(admitted.at(-1)).toBe('Continue by typing.')
  expect(watched.pageErrors).toEqual([])
  process.stdout.write(`Voice Web evidence: ${JSON.stringify({ firstAudibleMs, largestGapMs,
    audioSeconds: Math.round(uninterrupted.reduce((sum, audio) => sum + audio.duration, 0)), review,
    recognition: cachedSenseVoice ? 'SenseVoice' : 'fixture', synthesis: cachedBreeze ? 'Breeze' : 'fixture' })}\n`)
})
