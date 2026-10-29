/** Private Unix-socket admission and activity checks for a supervised dsh Web profile. */
import { createServer } from 'node:http'
import { chmodSync, lstatSync, readFileSync, rmSync } from 'node:fs'
import { isAbsolute } from 'node:path'

/** Cordis plugin identity. */
export const name = 'neurix-server-update-control'
/** Services whose admitted requests and active work must settle before replacement. */
export const inject = ['connection', 'agents', 'jobs']

/**
 * Serve update control over a mode-0600 Unix socket, never an HTTP network listener.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Existing Web profile context.
 * @param {{socketPath: string, manifestPath: string, leaseMs: number}} config - Deployment paths and finite admission-lock lease.
 * @returns {Promise<void>} Resolves when the private socket accepts requests; disposal closes it and releases admission.
 */
export async function apply(ctx, config) {
  if (!isAbsolute(config.socketPath) || !isAbsolute(config.manifestPath)
    || !Number.isSafeInteger(config.leaseMs) || config.leaseMs < 1000) throw new Error('Invalid server update control configuration')
  const version = JSON.parse(readFileSync(config.manifestPath, 'utf8')).version
  if (typeof version !== 'string') throw new Error('Update control manifest has no version')
  const existing = lstatSync(config.socketPath, { throwIfNoEntry: false })
  if (existing != null) {
    if (!existing.isSocket()) throw new Error('Update control path is not a socket')
    rmSync(config.socketPath)
  }
  let locked = false
  let disposed = false
  let lease
  const pending = new Set()
  const unlock = () => { clearTimeout(lease); locked = false }
  const active = () => {
    const agents = ctx.agents.list()
    return agents.some(agent => agent.status === 'running' || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0)
      || [undefined, ...agents].some(agent => ctx.jobs.list(agent?.id).some(job => ['running', 'stopping'].includes(job.status)))
  }
  ctx.on('connection/request', async (_request, response, next) => {
    if (locked) { response.writeHead(503); response.end(); return }
    const completion = Promise.withResolvers()
    pending.add(completion.promise)
    try { await next() } finally { pending.delete(completion.promise); completion.resolve() }
  })
  const server = createServer((request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    void (async () => {
      if (disposed) { reply(503, { error: 'stopping' }); return }
      if (request.method === 'GET' && request.url === '/status') { reply(200, { version, active: active(), locked }); return }
      if (request.method === 'POST' && request.url === '/unlock') { unlock(); reply(200, { locked: false }); return }
      if (request.method !== 'POST' || request.url !== '/lock') { reply(404, { error: 'unknown-operation' }); return }
      if (active()) { reply(409, { active: true }); return }
      locked = true
      lease = setTimeout(unlock, config.leaseMs)
      await Promise.all(pending)
      if (disposed || !locked || active()) { unlock(); reply(409, { active: true }); return }
      reply(200, { version, active: false, locked: true })
    })().catch((error) => {
      unlock()
      ctx.logger.error('Server update inspection failed', error)
      reply(503, { error: 'inspection-failed', active: true })
    })
  })
  ctx.effect(() => async () => {
    disposed = true
    unlock()
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
    rmSync(config.socketPath, { force: true })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.socketPath, resolve) })
  chmodSync(config.socketPath, 0o600)
}
