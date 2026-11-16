/** Real profile composition keeps dictation and realtime voice independently switchable. */
import { fileURLToPath } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

it('toggles either voice feature without withdrawing the shared recognition API', async () => {
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally { await resources.scaffold?.close() }
  })
  const packages = ['voice-input-bundle', 'voice-chat-bundle'].map(name => ({
    dir: fileURLToPath(new URL(`../../../packages/experimental/${name}`, import.meta.url)), enabled: false,
  }))
  const scaffold = await launchWebScaffold({ profile: { packages } })
  resources.scaffold = scaffold
  const browser = await chromium.launch(); resources.browser = browser
  const page = await newEnglishPage(browser), errors = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const plugins = page.getByRole('button', { name: 'Plugins', exact: true })
  const workspace = page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' })
  await plugins.click()
  const dictate = page.getByRole('switch', { name: 'Enable Voice input', exact: true })
  const converse = page.getByRole('switch', { name: 'Enable Voice chat', exact: true })
  await dictate.waitFor(); await converse.waitFor()
  const review = await mkdtemp(join(tmpdir(), 'dsh-voice-toggles-review-'))
  await page.screenshot({ path: join(review, 'independent-switches.png') })
  expect(await converse.getAttribute('aria-checked')).toBe('false')
  await converse.click()
  try {
    await expect.poll(() => converse.getAttribute('aria-checked'), { timeout: 30_000 }).toBe('true')
  } catch (error) {
    process.stdout.write(JSON.stringify({ alerts: await page.getByRole('alert').allTextContents(),
      dialogs: await page.getByRole('dialog').allTextContents(), enabled: await converse.isEnabled(), pageErrors: errors.pageErrors }) + '\n')
    throw error
  }
  await workspace.click()
  await page.getByRole('button', { name: 'Voice chat', exact: true }).waitFor()
  expect(await page.getByRole('button', { name: 'Open voice input setup', exact: true }).count()).toBe(0)
  await plugins.click(); await dictate.click()
  const setup = page.getByRole('dialog', { name: 'Set up voice input before recording', exact: true })
  await setup.getByRole('button', { name: 'Later', exact: true }).click()
  await workspace.click()
  await page.getByRole('button', { name: 'Voice chat', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Open voice input setup', exact: true }).waitFor()
  await plugins.click(); await converse.click()
  await expect.poll(() => converse.getAttribute('aria-checked'), { timeout: 30_000 }).toBe('false')
  await workspace.click()
  await page.getByRole('button', { name: 'Open voice input setup', exact: true }).waitFor()
  expect(await page.getByRole('button', { name: 'Voice chat', exact: true }).count()).toBe(0)
  expect(errors.pageErrors).toEqual([])
  process.stdout.write(`Independent voice switch evidence: ${review}\n`)
})
