/** Both SDKs retain the collaboration records exercised by the headless snapshots. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createProcessDeepSeekHarness } from '../src/api.ts'

it('retains model candidates and attributed Team replies without replacing the main response', async () => {
  const expected = JSON.parse(await readFile(new URL('./expected/collaboration-projection.json', import.meta.url), 'utf8')) as {
    finalResponse: string
    events: { type: string; data: Record<string, unknown>; seq: number; time: number }[]
  }
  const types = new Set(expected.events.map(event => event.type))
  const isCollaborationRecord = (value: unknown): value is { type: string } =>
    value !== null && typeof value === 'object' && 'type' in value
      && typeof value.type === 'string' && types.has(value.type)
  const harness = createProcessDeepSeekHarness({
    command: process.execPath,
    args: [fileURLToPath(new URL('./fake-runtime.ts', import.meta.url))],
    environment: () => ({ ...process.env, FAKE_TEXT: expected.finalResponse, FAKE_SESSION_EVENTS: JSON.stringify(expected.events) }),
    description: 'collaboration SDK projection', initializeTimeoutMs: 5000,
  })
  try {
    const result = await harness.run('Report the collaborative result.')
    expect({ finalResponse: result.finalResponse, events: result.events.filter(event => types.has(event.type)) }).toEqual(expected)
    const notifications = result.notifications.flatMap(notification =>
      notification.method === 'session.event' && isCollaborationRecord(notification.params.event)
        ? [{ sessionId: notification.params.sessionId, event: notification.params.event }] : [])
    expect(notifications.map(notification => notification.event)).toEqual(expected.events)
    expect(notifications.every(notification => notification.sessionId === result.sessionId)).toBe(true)
  } finally {
    await harness.close()
  }
})
