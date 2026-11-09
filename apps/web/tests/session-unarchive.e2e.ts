// Archive, restore, and permanently delete through sidebar row menus and the archived filter,
// then reload from the Host baseline. This flow makes no model calls.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, onTestFinished, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, seedSession, watchConsole, type WebScaffold,
  compareOrRefreshGolden, webSnapshotMode,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

// The seed is another scenario's committed fixture, reused read-only: this
// spec needs any one cold Session row, not new recorded content.
const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const SEED_ID = 'session-unarchive-web-e2e'
const DELETE_GOLDEN = fileURLToPath(new URL('../../../snapshots/web/session-archive-actions/delete-confirm.expected.md', import.meta.url))

describe('web e2e: archived Session restoration and permanent deletion', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  /**
   * Expand the Ungrouped group when it renders collapsed so its rows are
   * addressable, then return the section holding them.
   * @returns the expanded Ungrouped section locator.
   */
  async function ungroupedSection(): Promise<Locator> {
    const header = page.getByText('Ungrouped', { exact: true })
    const groupRow = header.locator('..').locator('..')
    await expect.poll(async () => {
      if (await groupRow.count() === 0) return 'absent'
      if (await groupRow.getAttribute('aria-expanded') !== 'true') {
        await header.click()
        return 'collapsed'
      }
      return 'expanded'
    }, { timeout: 15_000 }).toBe('expanded')
    return groupRow.locator('..')
  }

  /**
   * Reveal and click a row action, re-hovering if a projection update replaces
   * the row before its hover-only button becomes visible.
   * @param row - the row owning the action.
   * @param name - accessible name of the action button.
   */
  async function clickHoverAction(row: Locator, name: string): Promise<void> {
    const button = row.getByRole('button', { name })
    await expect.poll(async () => {
      await row.hover()
      return await button.isVisible()
    }, { timeout: 10_000 }).toBe(true)
    await button.click()
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    // Seed one cold session; with no Workspace registered it is the sidebar's
    // only row, in the Ungrouped bucket.
    await seedSession(scaffold, await readFile(SEED, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('restores archived history, confirms permanent deletion, and keeps it absent across reload and search', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-unarchive'))
    // Select the only visible Session, then give it a user-owned title: the
    // locator binds to the seed's own copy on both sides of the round trip.
    const seededRow = (await ungroupedSection()).locator('[role="treeitem"]')
      .filter({ has: page.locator('button[aria-label^="Session actions for "]') })
    await expect.poll(() => seededRow.count(), { timeout: 10_000 }).toBe(1)
    await seededRow.click()
    await expect.poll(() => seededRow.getAttribute('aria-selected'), { timeout: 10_000 }).toBe('true')
    const { title } = await scaffold.ctx.sessionController.rename({
      sessionId: SessionId(SEED_ID), title: `Unarchive target ${SEED_ID}`,
    })
    const sessionRow = page.getByRole('treeitem').filter({ has: page.getByText(title, { exact: true }) })
    await expect.poll(() => sessionRow.count(), { timeout: 10_000 }).toBe(1)
    await expect.poll(() => sessionRow.getAttribute('aria-selected'), { timeout: 10_000 }).toBe('true')

    // Archive from the row menu: no confirmation dialog, and losing the last
    // visible Session withdraws the whole Ungrouped bucket.
    await clickHoverAction(sessionRow, `Session actions for ${title}`)
    await page.getByRole('menuitem', { name: 'Archive session' }).click()
    await expect.poll(() => sessionRow.count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(() => page.getByText('Ungrouped', { exact: true }).count(), { timeout: 10_000 }).toBe(0)
    // Durable on the host: the registry-global set carries the id while the
    // Session log itself stays in persistence untouched.
    expect([...scaffold.ctx.workspaceRegistry.archivedSessionIds]).toEqual([SessionId(SEED_ID)])
    expect((await scaffold.ctx.sessionPersistence.list()).map(snapshot => snapshot.header.id))
      .toContain(SessionId(SEED_ID))

    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitem', { name: 'All conversations (show archived)', exact: true }).click()
    await ungroupedSection()
    await expect.poll(() => sessionRow.count(), { timeout: 10_000 }).toBe(1)
    await clickHoverAction(sessionRow, `Session actions for ${title}`)
    await page.getByRole('menuitem', { name: 'Unarchive session' }).click()
    await expect.poll(
      () => [...scaffold.ctx.workspaceRegistry.archivedSessionIds],
      { timeout: 10_000 },
    ).toEqual([])
    // Back to the default filter: the restored row must be an ordinary row
    // again, visible without any archived rows in the view.
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitem', { name: 'Hide archived', exact: true }).click()
    await ungroupedSection()
    await expect.poll(() => sessionRow.count(), { timeout: 15_000 }).toBe(1)

    // Reload: the restored row is rebuilt from the host baseline, so the
    // unarchive was durable and not merely client state.
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await ungroupedSection()
    await expect.poll(() => sessionRow.count(), { timeout: 15_000 }).toBe(1)

    await clickHoverAction(sessionRow, `Session actions for ${title}`)
    expect(await page.getByRole('menuitem', { name: 'Permanently delete session…' }).count()).toBe(0)
    await page.getByRole('menuitem', { name: 'Archive session', exact: true }).click()
    await expect.poll(() => sessionRow.count(), { timeout: 10_000 }).toBe(0)
    await page.getByRole('button', { name: 'View options' }).click()
    await page.getByRole('menuitem', { name: 'Archived only', exact: true }).click()
    await ungroupedSection()
    await expect.poll(() => sessionRow.count(), { timeout: 10_000 }).toBe(1)
    const archived = (await scaffold.ctx.sessionPersistence.stat(SessionId(SEED_ID)))!.header
    const searchQuery = 'single'
    expect((await scaffold.ctx.sessionQuery.searchSessions({ query: searchQuery })).items.map(item => item.header.id))
      .toContain(SessionId(SEED_ID))

    await clickHoverAction(sessionRow, `Session actions for ${title}`)
    await page.getByRole('menuitem', { name: 'Permanently delete session…', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Permanently delete this session?' })
    await expect.poll(() => dialog.isVisible()).toBe(true)
    await compareOrRefreshGolden(DELETE_GOLDEN, await dialog.ariaSnapshot(), webSnapshotMode())
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await scaffold.ctx.sessionPersistence.stat(SessionId(SEED_ID))).toBeDefined()
    expect(await sessionRow.count()).toBe(1)

    await clickHoverAction(sessionRow, `Session actions for ${title}`)
    await page.getByRole('menuitem', { name: 'Permanently delete session…', exact: true }).click()
    const remove = vi.spyOn(scaffold.ctx.sessionPersistence, 'delete').mockRejectedValueOnce(new Error('storage unavailable'))
    onTestFinished(() => { remove.mockRestore() })
    await dialog.getByRole('button', { name: 'Permanently delete', exact: true }).click()
    await expect.poll(() => page.getByText('Deletion is incomplete. Some records may already be deleted. Retry to finish cleanup.', { exact: true }).isVisible(), { timeout: 15_000 }).toBe(true)
    expect(await dialog.isVisible()).toBe(true)
    expect(await sessionRow.count()).toBe(1)
    expect(await scaffold.ctx.sessionPersistence.stat(SessionId(SEED_ID))).toBeDefined()
    remove.mockRestore()
    await dialog.getByRole('button', { name: 'Permanently delete', exact: true }).click()
    await expect.poll(() => dialog.count(), { timeout: 15_000 }).toBe(0)
    await expect.poll(() => sessionRow.count(), { timeout: 10_000 }).toBe(0)
    expect(await scaffold.ctx.sessionPersistence.stat(SessionId(SEED_ID))).toBeUndefined()
    expect(scaffold.ctx.sessions.get(SessionId(SEED_ID))).toBeUndefined()
    expect(scaffold.ctx.workspaceRegistry.archivedSessionIds).toEqual([])
    expect(scaffold.ctx.sessionProjectionCache.cachedSnapshot(archived)).toBeUndefined()
    expect((await scaffold.ctx.sessionQuery.searchSessions({ query: searchQuery })).items).toEqual([])
    await expect(scaffold.ctx.sessionQuery.observeSession(SessionId(SEED_ID))).rejects.toMatchObject({ code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
    const deleteReloadWarningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, deleteReloadWarningStart)
    expect(await sessionRow.count()).toBe(0)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)
})
