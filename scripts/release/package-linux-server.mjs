/** Archive the verified Linux application runtime for the normal dsh Web profile. */
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { desktopTargetBuildPaths } from '../../apps/desktop/scripts/desktop-build-paths.mjs'

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Linux server packaging requires Linux x64')
const repository = resolve(import.meta.dirname, '../..')
const { version } = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'))
const paths = desktopTargetBuildPaths('linux-x64')
const launcher = join(paths.root, 'server', 'start.sh')
mkdirSync(join(paths.root, 'server'), { recursive: true })
writeFileSync(launcher, `#!/bin/sh
set -eu
NEURIX_RELEASE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
exec "$NEURIX_RELEASE_ROOT/runtime/primary-runtime/dependencies/node/bin/node" \\
  "$NEURIX_RELEASE_ROOT/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js" web "$@"
`)
chmodSync(launcher, 0o755)
const archive = join(paths.unsignedArtifacts, `neurix-harness-${version}-linux-x64-server.tar.gz`)
execFileSync('tar', ['-czf', archive, '-C', paths.root, 'dsh', 'runtime/primary-runtime', 'server'], { stdio: 'inherit' })
console.log(`Linux Web server archive: ${archive}`)
