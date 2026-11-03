/** Keyless MCP management through the shipped Web composition and a real stdio peer. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type McpManager from '../../../packages/mcp/mcp-manager/src/index.ts'
import { saveFailureShot } from './support.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'

const MODE = webSnapshotMode()
const EXPECTED = fileURLToPath(new URL('./expected/mcp-management/connected.expected.md', import.meta.url))
const SERVER = fileURLToPath(new URL('./fixtures/mcp-management-server.mjs', import.meta.url))

describe.skipIf(MODE === 'record')('MCP management', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleWatch: ReturnType<typeof watchConsole>
  beforeAll(async () => {
    scaffold = await launchWebScaffold({ profile: { packages: [] } })
    browser = await chromium.launch()
    page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 900 } })
    consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    await page.getByRole('button', { name: 'MCP', exact: true }).click()
  }, 120_000)
  afterAll(async () => { await browser?.close(); await scaffold?.close() })

  it('adds, inspects, edits, reconnects, disables, and removes an MCP connection', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mcp-management'))
    const panel = page.getByRole('region', { name: 'MCP', exact: true })
    await panel.getByText('No MCP servers added', { exact: true }).waitFor()
    await panel.getByRole('button', { name: 'Add server', exact: true }).click()
    let form = page.getByRole('dialog', { name: 'Add MCP server', exact: true })
    await form.getByLabel('Server name', { exact: true }).fill('knowledge')
    await form.getByLabel('Command', { exact: true }).fill(process.execPath)
    await form.getByLabel('Arguments (one per line)', { exact: true }).fill(SERVER)
    await form.getByLabel('Environment variables (JSON)', { exact: true }).fill('{"MCP_TEST_SECRET":"kept-on-edit"}')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    let server = panel.locator('[data-mcp-server="knowledge"]')
    await server.getByText('Connected', { exact: true }).waitFor()
    await server.locator('summary').click()
    await server.getByText('mcp__knowledge__search_notes', { exact: true }).waitFor()
    const manager = scaffold.ctx.get('mcpManager') as McpManager
    const state = await manager.list()
    const configured = state.servers[0]!
    const beforeInvalid = await readFile(join(scaffold.harnessHome, 'cordis.patch.yml'), 'utf8')
    await expect(manager.save(null, configured.draft, state.revision)).rejects.toMatchObject({ code: 'mcp/duplicate' })
    await expect(manager.setEnabled(configured.id, false, 'stale')).rejects.toMatchObject({ code: 'mcp/conflict' })
    await expect(manager.save(null, { ...configured.draft, serverName: 'invalid', transport: 'streamable-http', url: 'file:///invalid' },
      state.revision)).rejects.toMatchObject({ code: 'mcp/invalid-config' })
    expect(await readFile(join(scaffold.harnessHome, 'cordis.patch.yml'), 'utf8')).toBe(beforeInvalid)
    const snapshot = await captureStableAria(page, 'section[aria-label="MCP"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(EXPECTED, snapshot, MODE)

    await server.getByRole('button', { name: 'Edit', exact: true }).click()
    form = page.getByRole('dialog', { name: 'Edit MCP server', exact: true })
    expect(await form.getByLabel('Environment variables (JSON)', { exact: true }).inputValue()).toBe('')
    await form.getByLabel('Server name', { exact: true }).fill('knowledge_local')
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    server = panel.locator('[data-mcp-server="knowledge_local"]')
    await server.getByText('Connected', { exact: true }).waitFor()
    expect(await readFile(join(scaffold.harnessHome, 'cordis.patch.yml'), 'utf8')).toContain('kept-on-edit')
    const revisionBeforeReconnect = (await manager.list()).revision
    await server.getByRole('button', { name: 'Reconnect', exact: true }).click()
    await page.getByText('Connection restarted', { exact: true }).waitFor()
    await server.getByText('Connected', { exact: true }).waitFor()
    expect((await manager.list()).revision).toBe(revisionBeforeReconnect)
    await server.getByRole('switch').click()
    await page.getByText('MCP server disabled', { exact: true }).waitFor()
    await server.getByText('Disabled', { exact: true }).waitFor()
    expect(await server.getByRole('button', { name: 'Reconnect', exact: true }).isDisabled()).toBe(true)

    await page.setViewportSize({ width: 390, height: 844 })
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await server.getByRole('button', { name: 'Remove', exact: true }).click()
    const remove = page.getByRole('dialog', { name: 'Remove MCP server', exact: true })
    await remove.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await server.count()).toBe(1)
    await server.getByRole('button', { name: 'Remove', exact: true }).click()
    await remove.getByRole('button', { name: 'Remove', exact: true }).click()
    await panel.getByText('No MCP servers added', { exact: true }).waitFor()
    expect(await readFile(join(scaffold.harnessHome, 'cordis.patch.yml'), 'utf8')).not.toContain('kept-on-edit')
    expect(consoleWatch.pageErrors).toEqual([])
  }, 120_000)
})
