/** Offline execution checks for pinned CI downloads, integrity failure and extraction ordering. */
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'

const posixIt = it.skipIf(process.platform === 'win32')
const source = readFileSync(new URL('./prepare-ci-bubblewrap.sh', import.meta.url), 'utf8')

function run(options: { primaryFails?: boolean; mirrorsFail?: boolean; allFail?: boolean; badChecksum?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-bubblewrap-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const scripts = {
    uname: 'if [[ "$1" == -s ]]; then echo Linux; else echo x86_64; fi',
    curl: `output=''
url=''
printf 'curl %s\\n' "$*" >> "$TRACE"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == --output ]]; then output="$2"; shift; fi
  url="$1"
  shift
done
if [[ "$FAIL_ALL" == 1 || ( "$FAIL_PRIMARY" == 1 && "$url" == https://archive.ubuntu.com/* ) ]]; then exit 7; fi
if [[ "$FAIL_MIRRORS" == 1 && "$url" != https://launchpad.net/* ]]; then exit 7; fi
printf 'pinned payload' > "$output"`,
    sha256sum: `printf 'checksum %s\\n' "$(cat)" >> "$TRACE"
if [[ "$BAD_CHECKSUM" == 1 ]]; then exit 1; fi`,
    'dpkg-deb': `echo extract >> "$TRACE"
mkdir -p "$3/usr/bin"
printf '#!/usr/bin/env bash\\necho probe >> "$TRACE"\\n' > "$3/usr/bin/bwrap"
chmod +x "$3/usr/bin/bwrap"`,
    sudo: 'echo sysctl >> "$TRACE"',
  }
  for (const [name, body] of Object.entries(scripts)) {
    const path = join(bin, name)
    writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`)
    chmodSync(path, 0o755)
  }
  const script = join(root, 'prepare.sh')
  writeFileSync(script, source)
  const trace = join(root, 'trace')
  writeFileSync(trace, '')
  const result = spawnSync('bash', [script], { encoding: 'utf8', timeout: 10_000, env: {
    ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, TRACE: trace,
    RUNNER_TEMP: root, GITHUB_PATH: join(root, 'github-path'),
    FAIL_PRIMARY: options.primaryFails ? '1' : '0', FAIL_ALL: options.allFail ? '1' : '0',
    FAIL_MIRRORS: options.mirrorsFail ? '1' : '0',
    BAD_CHECKSUM: options.badChecksum ? '1' : '0',
  } })
  expect(result.error).toBeUndefined()
  expect(result.signal).toBeNull()
  return { result, trace: readFileSync(trace, 'utf8').trim().split('\n') }
}

posixIt('checks the pinned mirrored payload before extracting and probing it', () => {
  const { result, trace } = run()
  expect(result.status, result.stderr).toBe(0)
  expect(trace[0]).toContain('https://archive.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_0.12.0-1_amd64.deb')
  expect(trace[0]).toContain('--connect-timeout 10 --max-time 45')
  expect(trace[0]).toContain('--retry-max-time 60')
  expect(trace[1]).toContain('checksum db4d572a7927bfd34cc9b8e24b56983efa8e0483d03da6c810f6caae081dcc36')
  expect(trace.slice(2)).toEqual(['extract', 'sysctl', 'probe', 'probe'])
})

posixIt('uses an independent mirror when the Ubuntu archive is unavailable', () => {
  const { result, trace } = run({ primaryFails: true })
  expect(result.status, result.stderr).toBe(0)
  expect(trace[1]).toContain('https://mirrors.kernel.org/ubuntu/pool/main/b/bubblewrap/bubblewrap_0.12.0-1_amd64.deb')
  expect(trace[2]).toMatch(/^checksum /)
  expect(trace[3]).toBe('extract')
})

posixIt('uses the immutable build when both mirrors refuse the pinned version', () => {
  const { result, trace } = run({ mirrorsFail: true })
  expect(result.status, result.stderr).toBe(0)
  expect(trace[2]).toContain('https://launchpad.net/ubuntu/+source/bubblewrap/0.12.0-1/+build/33546835/')
  expect(trace[3]).toMatch(/^checksum /)
  expect(trace[4]).toBe('extract')
})

posixIt('stops before extraction when every download fails', () => {
  const { result, trace } = run({ allFail: true })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Could not download the pinned bubblewrap payload')
  expect(trace).toHaveLength(3)
  expect(trace.every(line => line.startsWith('curl '))).toBe(true)
})

posixIt('stops before extraction and fallback when integrity verification fails', () => {
  const { result, trace } = run({ badChecksum: true })
  expect(result.status).toBe(1)
  expect(trace).toHaveLength(2)
  expect(trace[1]).toMatch(/^checksum /)
})
