/** Spoken replies reach a real Web Audio output after normal Session admission. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFinished, vi } from 'vitest'
import type {} from '@deepseek-ai/dsh-voice-chat'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type { VoiceStatus } from '@deepseek-ai/dsh-voice-chat/types'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { launchWebScaffold, webSnapshotMode, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

interface VoiceResponseProof {
  speak: () => void
  output?: AudioContext
  analysers: AnalyserNode[]
  started: number
}
declare global { interface Window { voiceResponseProof: VoiceResponseProof } }

const bundle = fileURLToPath(new URL('../../../packages/experimental/voice-chat-bundle', import.meta.url))
const cachedModel = process.env.DSH_VOICE_MODEL_CACHE

it.skipIf(webSnapshotMode() === 'record')('reads consecutive Chinese replies aloud in the centered voice view', async () => {
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
  const texts = ['我在呢，可以听见你的声音。我们继续聊吧。', '第二次回复也应该读出来，不会只有文字。']
  await writeFile(replay, JSON.stringify(texts.map(text => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'Do not speak reasoning.' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Do not speak reasoning.' } },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text },
    { type: 'block-end', index: 1, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }))))
  await writeFile(overlay, `- id: speech-to-text-sensevoice\n  disabled: true\n- id: voice-chat\n  config:\n    dataRoot: ${JSON.stringify(cachedModel ?? join(root, 'models'))}\n`)
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: bundle, enabled: true }] },
    extraOverlayPath: [fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)), overlay],
    replayFixture: join(root, 'override-only.jsonl'), replayOverride: replay, compareReplaySession: false })
  resources.scaffold = scaffold
  const synthesize = vi.spyOn(scaffold.ctx.voiceChat, 'synthesize')
  onTestFinished(() => { synthesize.mockRestore() })
  if (cachedModel) scaffold.ctx.voiceChat.prepare()
  else {
    const ready: VoiceStatus = { phase: 'ready', model: 'mlx-4bit', operation: null, completedBytes: 0,
      downloadBytes: 3_000_000_000, hardware: { platform: 'darwin', architecture: 'arm64', memoryBytes: 16 * 1024 ** 3 } }
    const follow = vi.spyOn(scaffold.ctx.voiceChat, 'follow').mockImplementation(async function* (signal) {
      const stopped = Promise.withResolvers<undefined>(), stop = (): void => { stopped.resolve(undefined) }
      signal.addEventListener('abort', stop, { once: true })
      try { yield ready; if (!signal.aborted) await stopped.promise }
      finally { signal.removeEventListener('abort', stop) }
    })
    const pcm = Buffer.alloc(96000)
    for (let index = 0; index < pcm.length / 2; index++) {
      pcm.writeInt16LE(Math.round(Math.sin(index / 24000 * 440 * Math.PI * 2) * 16000), index * 2)
    }
    synthesize.mockImplementation(async function* (request) {
      const text = typeof request === 'string' ? request : request.text
      if (text !== '你好。') await releaseReply.promise
      yield { pcmBase64: pcm.toString('base64'), sampleRate: 24000 }
    })
    onTestFinished(() => { follow.mockRestore() })
  }
  await scaffold.ctx.plugin({ inject: ['speechToText'], apply(ctx) {
    ctx.effect(() => ctx.speechToText.register({
      info: { id: 'sensevoice-local' as SpeechProviderId, name: 'Fixture recognizer', location: 'host-local', languages: ['auto'] },
      transcribe: async () => ({ text: '你好，请用中文回复。', audioSeconds: 1, inferenceSeconds: 0.1 }),
    }))
  } })
  const browser = await chromium.launch(); resources.browser = browser
  const page = await newEnglishPage(browser), watched = watchConsole(page)
  await page.addInitScript(() => {
    const capture = new AudioContext({ sampleRate: 16000 }), source = capture.createOscillator()
    const gain = capture.createGain(), destination = capture.createMediaStreamDestination()
    gain.gain.value = 0; source.connect(gain); gain.connect(destination); source.start()
    const proof: VoiceResponseProof = { analysers: [], started: 0, speak: () => {
      gain.gain.setValueAtTime(0.2, capture.currentTime)
      gain.gain.setValueAtTime(0, capture.currentTime + 0.8)
    } }
    window.voiceResponseProof = proof
    AudioContext.prototype.createGain = function () {
      const node = BaseAudioContext.prototype.createGain.call(this), analyser = this.createAnalyser()
      node.connect(analyser); proof.analysers.push(analyser); proof.output = this
      return node
    }
    AudioContext.prototype.createBufferSource = function () {
      const node = BaseAudioContext.prototype.createBufferSource.call(this), start = node.start.bind(node)
      node.start = (when, offset, duration) => { proof.started++; start(when, offset, duration) }
      return node
    }
    navigator.mediaDevices.getUserMedia = async () => { await capture.resume(); return destination.stream }
    window.addEventListener('pagehide', () => { void capture.close() }, { once: true })
  })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  await page.locator('[data-voice-ready="true"]').waitFor({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Voice chat', exact: true }).click()
  await page.locator('[data-voice-chat="listening"]').waitFor({ timeout: 90_000 })
  const review = await mkdtemp(join(tmpdir(), 'dsh-voice-centered-review-'))
  for (let index = 0; index < texts.length; index++) {
    await expect.poll(() => page.evaluate(() => window.voiceResponseProof.analysers.every((analyser) => {
      const samples = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(samples)
      return samples.every(value => Math.abs(value) < 0.005)
    })), { timeout: 10_000, interval: 20 }).toBe(true)
    const before = await page.evaluate(() => window.voiceResponseProof.started)
    const settled = scaffold.whenTurnSettled(120_000)
    await page.evaluate(() => { window.voiceResponseProof.speak() })
    if (index === 0 && !cachedModel) {
      await page.locator('[data-voice-chat="thinking"]').waitFor()
      await page.evaluate(async () => { await window.voiceResponseProof.output?.suspend() })
      releaseReply.resolve(undefined)
    }
    await expect.poll(() => page.evaluate((started) => {
      return window.voiceResponseProof.started > started && window.voiceResponseProof.analysers.some((analyser) => {
        const samples = new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(samples)
        return samples.some(value => Math.abs(value) > 0.005)
      })
    }, before), { timeout: 90_000, interval: 20 }).toBe(true)
    expect(await page.evaluate(() => window.voiceResponseProof.output?.state)).toBe('running')
    await page.screenshot({ path: join(review, `audible-reply-${index + 1}.png`) })
    await settled
    await page.locator('[data-voice-chat="listening"]').waitFor({ timeout: 90_000 })
  }
  await page.getByRole('button', { name: 'End conversation', exact: true }).click()
  expect(synthesize.mock.calls.map(([request]) => typeof request === 'string' ? request : request.text)
    .filter(text => text !== '你好。')).toEqual(texts)
  for (const text of texts) await page.getByText(text, { exact: true }).waitFor()
  expect(watched.pageErrors).toEqual([])
  process.stdout.write(`Centered voice and audible response evidence: ${review}\n`)
})
