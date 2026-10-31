/** Two independent browsers connect by private link and continue one recorded Agent session. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { launchWebScaffold, webSnapshotMode, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

vi.mock('node:os', async (load) => {
  const actual = await load<typeof import('node:os')>()
  return { ...actual, networkInterfaces: () => ({ fixture: [{ address: '127.0.0.1', family: 'IPv4', internal: false }] }) }
})

it('connects by link from the phone plugin, continues the same session, and revokes the previous link', async () => {
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
    const settings = desktop.getByRole('button', { name: 'Settings', exact: true })
    await settings.waitFor()
    await expect(`${await settings.ariaSnapshot()}\n`).toMatchFileSnapshot('./expected/neurix-phone-account/settings-launcher.expected.md')
    await settings.click()
    await desktop.getByRole('menuitem', { name: 'Feedback', exact: true }).click()
    await desktop.getByText('The feedback channel is not available yet.', { exact: true }).waitFor()
    await desktop.getByRole('dialog', { name: 'Feedback' }).getByRole('button', { name: 'Close', exact: true }).last().click()
    await connectFreshWorkspace(desktop, scaffold.workspaceCwd)
    const firstSettled = scaffold.whenTurnSettled()
    await desktop.locator('[data-composer-input]').first().fill('Reply with the single word DESKTOP_READY and stop.')
    await desktop.locator('[data-composer-input]').first().press('Enter')
    const sessionId = await firstSettled
    await desktop.getByText('DESKTOP_READY', { exact: true }).waitFor()
    await desktop.getByRole('button', { name: 'Plugins', exact: true }).first().click()
    await desktop.getByRole('button', { name: 'View Phone connection', exact: true }).click()
    const connection = desktop.getByRole('region', { name: 'Phone connection' })
    await connection.getByRole('button', { name: 'Enable connection', exact: true }).click()
    const address = connection.getByRole('textbox', { name: 'Phone connection link' })
    await address.waitFor()
    const phoneUrl = await address.inputValue()
    expect(new URL(phoneUrl).hash).toMatch(/^#connect=[A-Za-z0-9_-]{43}$/)
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
      locale: 'en-US', timezoneId: 'Asia/Shanghai' })
    const phone = await context.newPage()
    const phoneErrors = watchConsole(phone)
    await phone.goto(phoneUrl)
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
    await desktop.getByRole('button', { name: 'New session', exact: true }).first().click()
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await desktop.getByRole('button', { name: 'Plugins', exact: true }).first().click()
    await desktop.getByRole('button', { name: 'View Phone connection', exact: true }).click()
    const previous = await address.inputValue()
    await connection.getByRole('button', { name: 'Update link', exact: true }).click()
    await expect.poll(() => address.inputValue()).not.toBe(previous)
    const next = await address.inputValue()
    await phone.goto(previous)
    await phone.getByText('Could not connect. Retry or get the latest link from your computer.', { exact: true }).waitFor()
    await phone.goto(next)
    await phone.waitForSelector('[data-composer-input]')
    expect(new URL(phone.url()).hash).toBe('')
    expect(errors.pageErrors).toEqual([])
    expect(phoneErrors.pageErrors).toEqual([])
    expect(webSnapshotMode()).not.toBe('record')
  } finally {
    await browser.close()
    await scaffold.close()
  }
})
