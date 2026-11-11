/** Point-read Session query using the production observation and projection path. */

import SessionQueryEngine from '@deepseek-ai/dsh-session-query'

/** Search is outside these continuation tests. */
export class TestSessionQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}
