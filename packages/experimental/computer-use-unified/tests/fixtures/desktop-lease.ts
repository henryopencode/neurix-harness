/** Kernel-owned exclusion for opt-in tests sharing the host's physical desktop. @module */

import { constants } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import { z } from 'zod'

/**
 * Reserve this user's physical desktop across Vitest processes and jobs. The
 * persistent inode is never unlinked; process exit releases the kernel lock.
 * @param signal - test lifetime and acquisition deadline.
 * @returns an awaited release for the acquired file descriptor.
 */
export async function reserveTestDesktop(signal: AbortSignal): Promise<() => Promise<void>> {
  const root = join(homedir(), '.cache', 'neurix-desktop-e2e')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const file = await open(join(root, 'desktop.lock'), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
  try {
    for (;;) {
      signal.throwIfAborted()
      try { await tryLockExclusive(file.fd); return () => file.close() } catch (error) {
        if (!z.object({ code: z.enum(['EAGAIN', 'EWOULDBLOCK']) }).safeParse(error).success) throw error
      }
      await delay(50, undefined, { signal })
    }
  } catch (error) { await file.close(); throw error }
}
