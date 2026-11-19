/** Small deterministic report records shared by browser and archive tests. */
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { DiagnosticGroupId, DiagnosticList, DiagnosticOccurrenceId } from '../src/types.ts'

/** @returns Two distinct redacted failure groups, without original arguments or successful output. */
export function diagnosticData(): DiagnosticList {
  return {
    incomplete: false, scannedSessions: 2, scannedEvents: 12, unindexedSessions: 0, omittedOccurrences: 0, failedSessions: 0,
    groups: ['INVALID_ARGS', 'EXIT_60'].map((code, index) => ({
      id: `group-${index}` as DiagnosticGroupId, category: index === 0 ? 'arguments' : 'command', source: index === 0 ? 'todo_write' : 'bash',
      code, message: index === 0 ? 'Required field is missing' : 'Command failed', count: 1, firstAt: 1_700_000_000_000 + index, lastAt: 1_700_000_000_000 + index,
      occurrences: [{
        id: `occurrence-${index}` as DiagnosticOccurrenceId, sessionId: SessionId(`session-${index}`), eventSeq: SessionSeq(index + 2),
        at: 1_700_000_000_000 + index, turn: 1, step: 1, message: index === 0 ? 'Required field is missing' : 'Command failed',
        details: index === 0 ? 'Required field is missing\napi_key=[redacted]' : 'Command failed\nexit 60',
        category: index === 0 ? 'arguments' : 'command', source: index === 0 ? 'todo_write' : 'bash', code,
      }],
    })),
  }
}
