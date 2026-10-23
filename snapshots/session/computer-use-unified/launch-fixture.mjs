/** Replace only the provider's LaunchServices subprocess with deterministic stdout. */
import { execFile as execute } from 'node:child_process'

export function execFile(command, args, options, callback) {
  if (command !== '/usr/bin/osascript' || args.at(-1) !== 'ai.neurix.fixture') throw new Error('Unexpected native launch')
  return execute('/usr/bin/printf', ['%s', JSON.stringify({ status: 'launched', pid: 9, bundle_id: 'ai.neurix.fixture', name: 'Fixture' })], options, callback)
}
export { spawn } from 'node:child_process'
