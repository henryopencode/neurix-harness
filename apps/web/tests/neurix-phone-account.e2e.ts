/** Two independent browsers sign in to Neurix and continue one recorded Agent session. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { launchWebScaffold, webSnapshotMode, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

vi.mock('node:os', async (load) => {
  const actual = await load<typeof import('node:os')>()
  return { ...actual, networkInterfaces: () => ({ fixture: [{ address: '127.0.0.1', family: 'IPv4', internal: false }] }) }
})

it('uses Neurix login, retains feedback without sending it, and continues the same session from a phone', async () => {
  const scaffold = await launchWebScaffold({
    replayFixture: fileURLToPath(new URL('../../../snapshots/web/neurix-phone-account/session.v4.jsonl', import.meta.url)),
    extraOverlayPath: fileURLToPath(new URL('./neurix-phone-account.overlay.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('../../../packages/experimental/mobile-access/package.json', import.meta.url))],
    compareReplaySession: true,
    paceMs: 2,
  })
  const browser = await chromium.launch()
  try {
    const desktop = await newEnglishPage(browser)
    const errors = watchConsole(desktop)
    await desktop.goto(scaffold.authenticatedUrl)
    await desktop.getByRole('button', { name: 'More', exact: true }).last().click()
    await desktop.getByRole('menuitem', { name: 'Feedback', exact: true }).click()
    await desktop.getByText('The feedback channel is not available yet.', { exact: true }).waitFor()
    await desktop.getByRole('dialog', { name: 'Feedback' }).getByRole('button', { name: 'Close', exact: true }).last().click()
    await desktop.getByRole('button', { name: 'More', exact: true }).last().click()
    await desktop.getByRole('menuitem', { name: 'Sign in', exact: true }).click()
    const account = desktop.getByRole('dialog', { name: 'Neurix account' })
    await account.getByLabel('Account name', { exact: true }).fill('phone.owner')
    await account.getByLabel('Password', { exact: true }).fill('synthetic-phone-password')
    await account.getByRole('button', { name: 'Create account', exact: true }).click()
    await account.waitFor({ state: 'hidden' })
    await connectFreshWorkspace(desktop, scaffold.workspaceCwd)
    const firstSettled = scaffold.whenTurnSettled()
    await desktop.locator('[data-composer-input]').first().fill('Reply with the single word DESKTOP_READY and stop.')
    await desktop.locator('[data-composer-input]').first().press('Enter')
    const sessionId = await firstSettled
    await desktop.getByText('DESKTOP_READY', { exact: true }).waitFor()
    await desktop.getByRole('button', { name: 'More', exact: true }).last().click()
    await desktop.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    const connection = desktop.getByRole('region', { name: 'Phone connection' })
    await connection.getByRole('button', { name: 'Connect phone', exact: true }).click()
    const address = connection.getByRole('textbox', { name: 'Phone connection link' })
    await address.waitFor()
    const phoneUrl = await address.inputValue()
    expect(phoneUrl).not.toContain('token=')
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
      locale: 'en-US', timezoneId: 'Asia/Shanghai' })
    const phone = await context.newPage()
    const phoneErrors = watchConsole(phone)
    await phone.goto(phoneUrl)
    await phone.getByLabel('Account', { exact: true }).fill('phone.owner')
    await phone.getByLabel('Password', { exact: true }).fill('synthetic-phone-password')
    await phone.getByRole('button', { name: 'Sign in to Neurix', exact: true }).click()
    await phone.waitForSelector('[data-composer-input]')
    if (await phone.getByText('DESKTOP_READY', { exact: true }).count() === 0) {
      await phone.getByRole('button', { name: 'Search sessions', exact: true }).click()
      await phone.getByRole('textbox', { name: 'Search session names', exact: true }).fill('DESKTOP_READY')
      await phone.getByRole('tree', { name: 'Search results' }).getByRole('treeitem').first().click()
    }
    await phone.getByText('DESKTOP_READY', { exact: true }).waitFor()
    const secondSettled = scaffold.whenTurnSettled()
    await phone.locator('[data-composer-input]').first().fill('Reply with the single word PHONE_READY and stop.')
    await phone.locator('[data-composer-input]').first().press('Enter')
    expect(await secondSettled).toBe(sessionId)
    await phone.getByText('PHONE_READY', { exact: true }).waitFor()
    await desktop.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close', exact: true }).click()
    await desktop.getByText('PHONE_READY', { exact: true }).waitFor()
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const rejected: unknown = await phone.evaluate(async () => {
      const response = await fetch('./api/neurixAccount/signOut', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'phone-signout-fixture', method: 'neurixAccount/signOut', payload: { args: {} } }) })
      const value: unknown = await response.json()
      return value
    })
    expect(rejected).toMatchObject({ result: { ok: false, error: { code: 'neurix-account/device-logout-required' } } })
    await phone.getByRole('button', { name: 'More', exact: true }).last().click()
    await phone.getByRole('menuitem', { name: 'Neurix account', exact: true }).click()
    await phone.getByRole('button', { name: 'Sign out of this phone', exact: true }).click()
    await phone.getByRole('button', { name: 'Sign in to Neurix', exact: true }).waitFor()
    const computerAccount: unknown = await desktop.evaluate(async () => {
      const response = await fetch('./api/neurixAccount/describe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'computer-account-fixture', method: 'neurixAccount/describe', payload: { args: {} } }) })
      const value: unknown = await response.json()
      return value
    })
    expect(computerAccount).toMatchObject({ result: { ok: true, value: { signedIn: true, username: 'phone.owner' } } })
    expect(errors.pageErrors).toEqual([])
    expect(phoneErrors.pageErrors).toEqual([])
    expect(webSnapshotMode()).not.toBe('record')
  } finally {
    await browser.close()
    await scaffold.close()
  }
})
