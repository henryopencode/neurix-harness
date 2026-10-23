/** Deterministic Images API response served over an ephemeral loopback listener. */
import { applyLoopbackServerEffect } from '../loopback-fixture-server.mjs'

const endpoint = 'https://images-fixture.invalid/v1/images/generations'
const minimaxEndpoint = 'https://minimax-images-fixture.invalid/v1/image_generation'
const failedEndpoint = 'https://minimax-images-fixture.invalid/v1/image_generation_failed'
const imageURL = 'https://minimax-images-fixture.invalid/generated.png'
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
// Distinct rasters keep image order observable through content-addressed storage.
const images = [image, 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNg+M8AAAICAQB7CYF4AAAAAElFTkSuQmCC', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4/58BAAT/Af9dfQKHAAAAAElFTkSuQmCC']
const imageURLs = images.map((_, index) => index === 0 ? imageURL : imageURL.replace('.png', `-${index + 1}.png`))

/** Replace only the fixture endpoint; the tool still performs a real HTTP POST. */
export async function apply(ctx) {
  const originalFetch = globalThis.fetch
  let forwardedFetch
  await applyLoopbackServerEffect(ctx, {
    label: 'generate-image provider fixture',
    requestListener(req, res) {
      void (async () => {
        const imageIndex = imageURLs.findIndex(url => new URL(url).pathname === req.url)
        if (req.method === 'GET' && imageIndex >= 0 && req.headers.authorization === undefined) {
          res.writeHead(200, { 'content-type': 'image/png' })
          res.end(Buffer.from(images[imageIndex], 'base64'))
          return
        }
        const parts = []
        for await (const part of req) parts.push(Buffer.from(part))
        const body = JSON.parse(Buffer.concat(parts).toString('utf8'))
        if (req.method === 'POST' && req.url === '/v1/image_generation_failed'
          && req.headers.authorization === 'Bearer fixture-key' && body.model === 'image-01' && body.n === 1
          && ['A red square', 'A blue square', 'A green square'].includes(body.prompt)) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ base_resp: { status_code: 1008, status_msg: 'fixture provider failure' } }))
          return
        }
        const minimax = req.url === '/v1/image_generation'
        if (req.method !== 'POST' || !['/v1/images/generations', '/v1/image_generation'].includes(req.url)
          || req.headers.authorization !== 'Bearer fixture-key'
          || body.model !== (minimax ? 'image-01' : 'fixture-image-model') || body.prompt !== 'A red square' || ![1, 4].includes(body.n)
          || minimax && (!(
            body.width === 1024 && body.height === 1024 && !('aspect_ratio' in body)
            || body.aspect_ratio === '1:1' && !('width' in body) && !('height' in body)
          ) || 'size' in body || 'quality' in body)) {
          res.writeHead(422)
          res.end('Unexpected image-generation request')
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(minimax
          ? { base_resp: { status_code: 0 }, data: { image_urls: imageURLs.slice(0, body.n) } }
          : { data: images.slice(0, body.n).map(b64_json => ({ b64_json })) }))
      })().catch(error => res.destroy(error))
    },
    onListening(address) {
      const urls = new Map([
        [endpoint, `http://127.0.0.1:${address.port}/v1/images/generations`],
        [minimaxEndpoint, `http://127.0.0.1:${address.port}/v1/image_generation`],
        [failedEndpoint, `http://127.0.0.1:${address.port}/v1/image_generation_failed`],
        ...imageURLs.map(url => [url, `http://127.0.0.1:${address.port}${new URL(url).pathname}`]),
      ])
      forwardedFetch = (input, init) => originalFetch(urls.get(input) ?? input, init)
      globalThis.fetch = forwardedFetch
    },
    onCleanup() {
      if (globalThis.fetch === forwardedFetch) globalThis.fetch = originalFetch
    },
  })
}
