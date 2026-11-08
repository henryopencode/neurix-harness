/** Anonymous admission remains reversible and retains Host/Origin checks. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { HostConnectionService } from '../../packages/client/connection/src/rpc-host.ts'
import * as plugin from './temporary-open-access.mjs'

const require = createRequire(new URL('../../packages/client/connection/package.json', import.meta.url))
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)

test('admits anonymous documents, APIs and sockets only during the enabled plugin lifetime', async (t) => {
  const ctx = new Context()
  const owner = ctx.plugin((connectionCtx) => {
    new HostConnectionService(connectionCtx, ['agent.henryweb.site'], {
      isAuthenticated: () => false,
      authenticateApi: () => undefined,
      authorizeIndex: (_request, response) => { response.writeHead(401); response.end(); return false },
    })
  })
  t.after(() => owner.dispose())
  await owner.await()
  const connection = ctx.get('connection')
  const request = { method: 'GET', url: '/', headers: { host: 'agent.henryweb.site' } }
  const response = { writeHead: () => {}, end: () => {} }
  assert.equal(connection.requestRejection(request), 401)
  const enabled = ctx.plugin(plugin, { enabled: true })
  t.after(() => enabled.dispose())
  await enabled.await()
  assert.equal(connection.authorizeIndex(request, response), true)
  assert.equal(connection.admit(request).peer, connection.browserPeer)
  assert.equal(connection.admitConnection(request).peer, connection.browserPeer)
  assert.equal(connection.requestRejection({ headers: { host: 'unrelated.example' } }), 403)
  assert.equal(connection.requestRejection({ headers: { host: 'agent.henryweb.site', origin: 'https://unrelated.example' } }), 403)
  await enabled.dispose()
  assert.equal(connection.requestRejection(request), 401)
  assert.equal(connection.authorizeIndex(request, response), false)
  const disabled = ctx.plugin(plugin, { enabled: false })
  t.after(() => disabled.dispose())
  await disabled.await()
  assert.equal(connection.requestRejection(request), 401)
  assert.throws(() => plugin.apply(ctx, {}), /explicit enabled boolean/)
})
