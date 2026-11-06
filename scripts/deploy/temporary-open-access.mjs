/** Deployment-only anonymous owner access, withdrawn when this plugin is disabled or unloaded. */

/** Cordis plugin identity. */
export const name = 'neurix-temporary-open-access'
/** Browser and API admission owner. */
export const inject = ['connection']

/**
 * Admit requests without cookies while retaining Connection's Host/Origin checks.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Existing Web profile context.
 * @param {{enabled: boolean}} config - Explicit deployment opt-in; false retains normal authentication.
 */
export function apply(ctx, config) {
  if (typeof config?.enabled !== 'boolean') throw new Error('Temporary open access requires an explicit enabled boolean')
  if (!config.enabled) return
  const connection = ctx.connection
  connection.registerBrowserAuth({
    authenticate: () => connection.browserPeer,
    authorizeIndex: () => true,
  })
}
