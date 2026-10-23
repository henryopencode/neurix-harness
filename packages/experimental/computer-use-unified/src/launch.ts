/** Mode-specific macOS application launch through LaunchServices and exact-PID discovery. @module */

import { execFile } from 'node:child_process'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { z } from 'zod'
import { ComputerError } from './native.ts'

const script = `ObjC.import('AppKit');
function run(argv) {
  const workspace = $.NSWorkspace.sharedWorkspace;
  const url = workspace.URLForApplicationWithBundleIdentifier(argv[1]);
  if (url.isNil()) return JSON.stringify({ status: 'not_installed' });
  const application = workspace.launchApplicationAtURLOptionsConfigurationError(
    url, argv[0] === 'foreground' ? $.NSWorkspaceLaunchDefault : $.NSWorkspaceLaunchWithoutActivation,
    $.NSDictionary.dictionary, null);
  if (application.isNil()) return JSON.stringify({ status: 'launch_failed' });
  return JSON.stringify({ status: 'launched', pid: Number(application.processIdentifier),
    bundle_id: ObjC.unwrap(application.bundleIdentifier), name: ObjC.unwrap(application.localizedName) });
}`
const launchedApplication = z.discriminatedUnion('status', [
  z.object({ status: z.literal('launched'), pid: z.number().int().positive(), bundle_id: z.string(), name: z.string() }),
  z.object({ status: z.literal('not_installed') }),
  z.object({ status: z.literal('launch_failed') }),
])
type LaunchedApplication = Extract<z.infer<typeof launchedApplication>, { status: 'launched' }>
const launchedWindows = z.object({ structuredContent: z.object({
  windows: z.array(z.object({ pid: z.number().int(), window_id: z.number().int() }).loose()),
}) })
interface Driver {
  callTool(name: string, args: string, options: { signal: AbortSignal }): Promise<{ rawJson: string }>
}

/**
 * Launch one exact bundle without shell interpolation or installed-app scanning.
 * The command inherits a scrubbed environment and settles only after child exit.
 * @param bundleId - identifier validated by the tool's JSON parser.
 * @param signal - operation cancellation and startup deadline.
 * @param inputMode - foreground activates the application; background preserves current focus.
 * @returns LaunchServices' process identity; window readiness requires observation.
 */
export async function launchMacApplication(bundleId: string, signal: AbortSignal,
  inputMode: 'foreground' | 'background' = 'background'): Promise<LaunchedApplication> {
  signal.throwIfAborted()
  if (bundleId === 'com.trycua.driver' || bundleId === 'com.trycua.driver.local') {
    throw new ComputerError('PROTECTED_APPLICATION', 'The native permission host cannot be launched through the computer tool.', 'none', 'Open the permission host from the operating system.')
  }
  const exited = Promise.withResolvers<void>()
  const output = Promise.withResolvers<string>()
  const child = execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, '--', inputMode, bundleId],
    { encoding: 'utf8', env: scrubbedParentEnv(), signal }, (error, stdout) => {
      if (error !== null) output.reject(error)
      else output.resolve(stdout)
    })
  child.once('close', () => { exited.resolve() })
  let stdout: string
  try { stdout = await output.promise } finally { await exited.promise }
  const result = launchedApplication.parse(JSON.parse(stdout))
  if (result.status === 'not_installed') throw new ComputerError('APP_NOT_INSTALLED', `No installed application matches ${bundleId}.`, 'none', 'Check the application bundle identifier and installation.')
  if (result.status === 'launch_failed') throw new ComputerError('LAUNCH_FAILED', `LaunchServices could not open ${bundleId}.`, 'possible', 'List targets and check the application before another launch attempt.')
  return result
}

/**
 * Use LaunchServices for application launch and the SDK for desktop observation/input.
 * The caller serializes the complete launch and readback on the desktop queue.
 * @param driver - provider-owned native SDK.
 * @param launch - host launcher returning the exact launched process.
 * @returns the SDK call interface with shell-free macOS application launch.
 */
export function withMacApplicationLaunch(driver: Driver, launch = launchMacApplication): Driver {
  return { async callTool(name, args, options) {
    if (name !== 'launch_app') return driver.callTool(name, args, options)
    const { bundle_id: bundleId, input_mode: inputMode } = z.object({ bundle_id: z.string().min(1),
      input_mode: z.enum(['foreground', 'background']).default('background') }).parse(JSON.parse(args))
    const application = await launch(bundleId, options.signal, inputMode)
    try {
      options.signal.throwIfAborted()
      const raw = await driver.callTool('list_windows', JSON.stringify({ pid: application.pid, on_screen_only: false }), options)
      const windows = launchedWindows.parse(JSON.parse(raw.rawJson)).structuredContent.windows
        .filter(window => window.pid === application.pid)
      const structuredContent = {
        ...application, launch_state: { requested: true, process_running: true, window_ready: windows.length > 0 }, windows,
      }
      return { rawJson: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent }) }
    } catch (error) {
      const cause: unknown = options.signal.aborted ? options.signal.reason : error
      throw new ComputerError('OBSERVATION_FAILED', `Application ${bundleId} launched (pid ${application.pid}), but its windows could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
        'completed', 'List targets to discover the launched application. Do not repeat open_app automatically.')
    }
  } }
}
