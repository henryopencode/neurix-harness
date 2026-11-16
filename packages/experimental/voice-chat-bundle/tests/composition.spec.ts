/** Independent voice controls share exactly one recognizer and transcription API. */
import { readFileSync } from 'node:fs'
import { DEFAULT_SCHEMA, load, Type } from 'js-yaml'
import { expect, it } from 'vitest'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

const schema = DEFAULT_SCHEMA.extend(new Type('tag:yaml.org,2002:js', { kind: 'scalar' }))
const dictation = load(readFileSync(new URL('../../voice-input-bundle/cordis.patch.yml', import.meta.url), 'utf8'), { schema }) as PatchOptions[]
const conversation = load(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema }) as PatchOptions[]

it('enables realtime voice without also enabling dictation', () => {
  const rows = composeEntries([conversation])
  expect(rows.some(row => row.id === 'voice-chat')).toBe(true)
  expect(rows.some(row => row.id === 'ui-voice-input')).toBe(false)
  expect(composeEntries([dictation]).some(row => row.id === 'voice-chat')).toBe(false)
})

it.each([false, true])('shares speech resources in either bundle order (reversed=%s)', (reversed) => {
  const rows = composeEntries(reversed ? [conversation, dictation] : [dictation, conversation])
  for (const id of ['speech-to-text', 'speech-to-text-sensevoice', 'api-speech-to-text', 'ui-voice-input', 'voice-chat']) {
    expect(rows.filter(row => row.id === id)).toHaveLength(1)
  }
})
