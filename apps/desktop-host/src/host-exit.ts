/** Process completion after the Host has finished application teardown and flushed its acknowledgement. */

interface ExitRuntime {
  exitCode?: string | number | null | undefined
  once(event: 'exit', listener: (code: number) => void): unknown
  exit(code: number): never
}

/**
 * Finish an already stopped Host, retaining JavaScript exit listeners before native termination.
 * @param runtime - Process whose application resources have already been released.
 * @param nativeExit - Optional native exit after existing JavaScript exit listeners.
 * @returns Never returns after the process exits with code zero.
 */
export function finishHostProcess(runtime: ExitRuntime, nativeExit?: (code: number) => void): never {
  if (nativeExit !== undefined) runtime.once('exit', (code) => { nativeExit(Number(runtime.exitCode ?? code)) })
  runtime.exit(0)
}

/**
 * Prepare process completion without changing the Host's Node ABI.
 * macOS native runtime finalizers can park after application teardown; the final exit listener
 * ends only the stopped process, after JavaScript exit listeners and the flushed IPC acknowledgement.
 * @param platform - Host operating system.
 * @returns Exit action called only after successful application teardown and acknowledgement.
 */
export async function prepareHostProcessExit(platform: NodeJS.Platform = process.platform): Promise<() => never> {
  let nativeExit: ((code: number) => void) | undefined
  if (platform === 'darwin') {
    const { default: koffi } = await import('koffi')
    const exit = koffi.load(null).func('void _exit(int)')
    nativeExit = (code) => { exit(code) }
  }
  return () => finishHostProcess(process, nativeExit)
}
