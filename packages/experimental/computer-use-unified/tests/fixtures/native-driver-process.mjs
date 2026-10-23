/** External SDK fixture that can synchronously block its own process. */
import { writeFileSync } from 'node:fs'

export class CuaDriver {
  previewStarts = 0
  static create() { return new CuaDriver() }
  async callTool(name, json) {
    const args = JSON.parse(json)
    const expirePreview = new URL(import.meta.url).searchParams.has('expire-preview')
    if (expirePreview && name === 'start_session' && args.session?.startsWith('preview-') && ++this.previewStarts === 1) {
      return { rawJson: JSON.stringify({ content: [], structuredContent: { refusal: { code: 'session_ended' } } }) }
    }
    if (name === 'block' || name === 'get_window_state' && args.block === true) {
      writeFileSync(args.readyPath, JSON.stringify({ pid: process.pid }))
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
    }
    if (name === 'invalid_ipc') { process.send?.({ invalid: true }); return new Promise(() => {}) }
    if (name === 'fail') throw new Error('External SDK failure')
    return { rawJson: JSON.stringify({ content: [], structuredContent: { name, pid: process.pid, session: args.session,
      ...expirePreview ? { previewStarts: this.previewStarts } : {} } }) }
  }
}
