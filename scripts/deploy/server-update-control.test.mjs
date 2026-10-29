/** Unix-only admission checks prevent replacement while requests or Agent work remain. */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from './server-update-control.mjs'

function call(path, operation = 'status') {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: path, path: '/' + operation, method: operation === 'status' ? 'GET' : 'POST' }, (response) => {
      let body = ''
      response.on('data', chunk => { body += chunk })
      response.on('end', () => { resolve({ status: response.statusCode, body: JSON.parse(body) }) })
    })
    req.on('error', reject)
    req.end()
  })
}

test('blocks running work, drains admitted requests, and cleans up the control socket', { timeout: 10_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'neurix-control-'))
  const socketPath = join(root, 'control.sock')
  const manifestPath = join(root, 'package.json')
  writeFileSync(manifestPath, JSON.stringify({ version: '1.0.0' }))
  const effects = []
  let admission
  let running = false
  let queued = false
  let jobRunning = false
  const ctx = {
    agents: { list: () => [{ id: 'fixture', status: running ? 'running' : 'idle', inbox: { nextTurn: queued ? [{}] : [], nextStep: [] } }] },
    jobs: { list: () => jobRunning ? [{ status: 'running' }] : [] },
    logger: console,
    on: (_event, listener) => { admission = listener },
    effect: effect => { effects.push(effect()) },
  }
  t.after(async () => {
    for (const dispose of effects.reverse()) await dispose()
    rmSync(root, { recursive: true, force: true })
  })
  await apply(ctx, { socketPath, manifestPath, leaseMs: 10_000 })
  assert.equal(statSync(socketPath).mode & 0o777, 0o600)
  running = true
  assert.equal((await call(socketPath, 'lock')).status, 409)
  running = false
  queued = true
  assert.equal((await call(socketPath)).body.active, true)
  queued = false
  jobRunning = true
  assert.equal((await call(socketPath, 'lock')).status, 409)
  jobRunning = false
  const work = Promise.withResolvers()
  const admitted = admission({}, {}, () => work.promise)
  const pendingLock = call(socketPath, 'lock')
  while (!(await call(socketPath)).body.locked) await new Promise(resolve => { setImmediate(resolve) })
  const response = { writeHead: status => { response.status = status }, end: () => {} }
  let invoked = false
  await admission({}, response, () => { invoked = true })
  assert.equal(response.status, 503)
  assert.equal(invoked, false)
  work.resolve()
  await admitted
  assert.equal((await pendingLock).body.locked, true)
  assert.equal((await call(socketPath, 'unlock')).body.locked, false)
})
