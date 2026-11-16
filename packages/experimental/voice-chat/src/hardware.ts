/** Conservative local model selection; unsupported hosts never download unusable weights. */
import { totalmem } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { VoiceHardware, VoiceModel } from './types.ts'

/**
 * Read the running Host's native architecture and physical memory.
 * @returns hardware facts without installing a runtime or probing the network.
 */
export function localHardware(): VoiceHardware {
  return { platform: process.platform, architecture: process.arch, memoryBytes: totalmem() }
}

/**
 * Detect the native Apple architecture even when the Host runs through Rosetta.
 * @param ctx - managed hardware-query subprocess owner.
 * @param hardware - facts reported by Node.
 * @param signal - plugin lifetime.
 * @param graceMs - hardware-query termination grace period.
 * @returns native hardware facts; a failed query rejects instead of selecting incompatible weights.
 */
export async function nativeHardware(ctx: Context, hardware: VoiceHardware, signal: AbortSignal, graceMs: number): Promise<VoiceHardware> {
  if (hardware.platform !== 'darwin' || hardware.architecture !== 'x64') return hardware
  const query = ctx.subprocess.spawn({ argv: ['/usr/sbin/sysctl', '-n', 'hw.optional.arm64'], cwd: '/', graceMs, signal,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } } })
  const result = await query.done
  signal.throwIfAborted()
  const value = query.collected.stdout?.readFrom(0).text.trim()
  if (result.exitCode !== 0 || value !== '0' && value !== '1') throw new Error('Cannot detect native Mac architecture')
  return { ...hardware, architecture: value === '1' ? 'arm64' : 'x64' }
}

/**
 * Select MLX weights while reserving memory for recognition, the browser, and model caches.
 * @param hardware - native Host hardware facts.
 * @param requested - explicit precision or conservative automatic selection.
 * @returns the usable weight variant, or null when this runtime cannot execute locally.
 */
export function selectModel(hardware: VoiceHardware, requested: 'auto' | VoiceModel): VoiceModel | null {
  if (hardware.platform !== 'darwin' || hardware.architecture !== 'arm64') return null
  const gib = hardware.memoryBytes / 1024 ** 3
  if (requested === 'mlx-8bit') return gib >= 24 ? requested : null
  if (requested === 'mlx-4bit') return gib >= 12 ? requested : null
  return gib >= 32 ? 'mlx-8bit' : gib >= 12 ? 'mlx-4bit' : null
}
