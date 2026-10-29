/** Replace the external desktop SDK while preserving the normal Harness entry path. */
import { registerHooks } from 'node:module'

export const name = 'unified-computer-fixture'
export const inject = ['computerUse', 'browserUse', 'agents', 'tools', 'systemPrompt', 'approval']

export async function apply(ctx, config = {}) {
  ctx.on('approval/request', () => Promise.resolve('allowed-once'))
  const fixture = new URL('../../../packages/experimental/computer-use-unified/tests/fixtures/native.ts', import.meta.url).href
  ctx.effect(() => {
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        const providerBundle = context.parentURL?.endsWith('/packages/experimental/computer-use-unified/lib/index.js')
          || context.parentURL?.endsWith('/packages/experimental/computer-control/lib/index.js')
        if (specifier === 'node:os' && (providerBundle || context.parentURL?.endsWith('/packages/experimental/computer-use-unified/src/platform.ts'))) {
          return { url: new URL('./platform-fixture.mjs', import.meta.url).href, shortCircuit: true }
        }
        if (specifier === 'node:child_process' && (providerBundle || context.parentURL?.endsWith('/packages/experimental/computer-use-unified/src/launch.ts'))) {
          return { url: new URL('./launch-fixture.mjs', import.meta.url).href, shortCircuit: true }
        }
        if (specifier === 'playwright') return { url: new URL('./browser-fixture.mjs', import.meta.url).href, shortCircuit: true }
        if (specifier === './native-driver.ts' || /(?:^|\/)native-driver-[^/]+\.js$/u.test(specifier)) {
          return { url: fixture, shortCircuit: true }
        }
        return specifier === '@trycua/cua-driver'
          ? { url: fixture, shortCircuit: true }
          : nextResolve(specifier, context)
      },
    })
    return () => hooks.deregister()
  }, 'unified-computer-fixture.module')
  if (config.browserUnavailable === true) {
    const { browserFixture } = await import('../../../packages/experimental/computer-use-unified/tests/fixtures/browser.ts')
    ctx.effect(() => {
      const previous = browserFixture.launchError
      browserFixture.launchError = new Error('Browser executable is missing. Run an installer to recover.')
      return () => { browserFixture.launchError = previous }
    }, 'unified-computer-fixture.browser-startup')
  }
  const { desktop } = await import(fixture)
  ctx.effect(() => {
    const previous = desktop.call
    const previousElements = desktop.extraElements
    const previousComplete = desktop.elementsComplete
    desktop.elementsComplete = false
    desktop.extraElements = [{ element_token: 'contact', role: 'AXMenuItem', label: 'Contact',
      frame: { x: 128, y: 140, w: 250, h: 50 } },
    { element_token: 'contacts-tab', role: 'AXCheckBox', label: 'Contacts', value: '0',
      frame: { x: 100, y: 140, w: 28, h: 50 } }]
    desktop.call = async (name, args) => {
      if (name !== 'click') return undefined
      if (args.element_token === 'contacts-tab') desktop.extraElements[1].value = '1'
      return { content: [], structuredContent: {
        effect: 'unverifiable', route: 'accessibility', delivery: { mode: 'background' }, summary: 'AXPress delivered.',
      } }
    }
    return () => { desktop.call = previous; desktop.extraElements = previousElements; desktop.elementsComplete = previousComplete }
  }, 'unified-computer-fixture.action-evidence')
  const provider = config.browserControl === true
    ? await import('@deepseek-ai/dsh-experimental-browser-control')
    : config.computerControl === true
    ? await import('@deepseek-ai/dsh-experimental-computer-control')
    : await import('@deepseek-ai/dsh-experimental-computer-use-unified')
  const providers = config.splitControl === true
    ? [await import('@deepseek-ai/dsh-experimental-computer-control'), await import('@deepseek-ai/dsh-experimental-browser-control')]
    : [provider]
  for (const active of providers) await ctx.plugin(active, { requireInputApproval: true, screenshots: false, showOverlay: false, cursorMoveDurationMs: 0,
    ...config.computerControl === true || config.browserControl === true ? {} : { inputMode: 'background', nativeBackground: config.browserOnly !== true } })
}
