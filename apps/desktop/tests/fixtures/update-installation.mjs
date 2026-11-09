/** Isolated production installation presentation; no Host, network, or installer runs. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, nativeTheme, protocol } from 'electron'
import { DesktopUpdateDialog } from '../../lib/types/update-dialog.js'
import { DesktopUpdateOverlays } from '../../lib/types/update-overlay.js'
import { resolveDesktopLocale } from '../../lib/types/locale.js'

const directory = fileURLToPath(new URL('../../.desktop-build/qualification/', import.meta.url))
mkdirSync(directory, { recursive: true })
const root = mkdtempSync(join(directory, 'update-installation-'))
app.setPath('userData', join(root, 'profile'))
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
app.on('window-all-closed', () => {})

async function main() {
  await app.whenReady()
  const original = nativeTheme.themeSource
  const locale = resolveDesktopLocale('zh-CN')
  const results = []
  const windows = []
  let dialogs
  const deadline = setTimeout(() => { console.error('Installation presentation deadline exceeded'); app.exit(1) }, 60_000)
  protocol.handle('dsh-app', async request => {
    const name = new URL(request.url).pathname.slice(1)
    const file = new URL(`${name === 'design-platform.css' ? '../../lib/welcome' : '../../renderer'}/${name}`, import.meta.url)
    const mime = name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript'
      : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html'
    return new Response(await readFile(file), { headers: { 'content-type': mime } })
  })
  try {
    for (const spec of [
      { theme: 'dark', width: 1100, height: 800, reduced: false },
      { theme: 'light', width: 1100, height: 800, reduced: false },
      { theme: 'dark', width: 390, height: 640, reduced: false },
      { theme: 'dark', width: 390, height: 640, reduced: true },
    ]) {
      console.log(`Checking ${spec.theme} ${spec.width}px reduced=${spec.reduced}`)
      nativeTheme.themeSource = spec.theme
      const parent = new BrowserWindow({ show: true, useContentSize: true, width: spec.width, height: spec.height })
      windows.push(parent)
      await parent.loadURL('data:text/html,<h1>Workspace preview available</h1>')
      const overlays = new DesktopUpdateOverlays()
      let surface
      dialogs = new DesktopUpdateDialog(fileURLToPath(new URL('../../lib/preload-update-dialog.cjs', import.meta.url)), locale, {
        create(owner, preload) {
          surface = overlays.create(owner, preload)
          const contents = surface.webContents
          contents.on('preload-error', (_event, _path, error) => { console.error(error) })
          contents.on('did-fail-load', (_event, code, description) => { console.error(`Installation page load: ${code} ${description}`) })
          return surface
        },
      })
      const confirmation = dialogs.show(parent, { title: locale.messages.updateTitle, message: locale.messages.mandatoryReady,
        buttons: [locale.messages.installAndRestart], cancelId: 1 })
      const contents = surface.webContents
      await once(contents, 'did-finish-load', { signal: AbortSignal.timeout(10_000) })
      contents.debugger.attach('1.3')
      await contents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [
        { name: 'prefers-reduced-motion', value: spec.reduced ? 'reduce' : 'no-preference' },
      ] })
      await contents.executeJavaScript(`Promise.all(document.getAnimations().map(animation => animation.finished))`)
      const entrance = confirmation.then(async result => {
        assert.equal(result.response, 0)
        return dialogs.showInstallation(parent, '1.1.1')
      })
      await contents.executeJavaScript(`document.querySelector('.primary').click(); undefined`)
      assert.equal(await entrance, true)
      await parent.webContents.executeJavaScript(`document.querySelector('h1').textContent = 'Preview unavailable'; undefined`)
      const result = await contents.executeJavaScript(`(() => {
        const page = document.getElementById('installation');
        const style = getComputedStyle(page);
        const box = page.getBoundingClientRect();
        const detail = document.getElementById('installation-detail').getBoundingClientRect();
        return {
          title: document.getElementById('installation-title').textContent,
          detail: document.getElementById('installation-detail').textContent,
          version: document.getElementById('installation-version').textContent,
          opaque: style.opacity === '1' && !style.backgroundColor.includes('rgba'),
          workspaceBlocked: document.getElementById('dialog').inert,
          focused: document.activeElement.id,
          fits: box.width === innerWidth && page.scrollWidth <= page.clientWidth
            && document.documentElement.scrollWidth <= innerWidth && detail.left >= 0 && detail.right <= innerWidth && detail.bottom <= innerHeight,
          animated: document.getAnimations().some(animation => animation.effect.getTiming().iterations === Infinity),
          isolated: typeof window.require === 'undefined',
        };
      })()`)
      if (!result.fits) console.log(await contents.executeJavaScript(`({ width: innerWidth, height: innerHeight,
        scroll: [document.documentElement.scrollWidth, document.getElementById('installation').scrollWidth],
        overflow: [...document.querySelectorAll('.installation, .installation *')].map(element => {
          const rect = element.getBoundingClientRect(); return [element.className || element.id, rect.left, rect.right, rect.bottom];
        }).filter(([, left, right, bottom]) => left < 0 || right > innerWidth || bottom > innerHeight) })`))
      assert.deepEqual(result, { title: '正在更新 Neurix Harness', detail: '应用即将重启，请稍候。', version: 'V1.1.1',
        opaque: true, workspaceBlocked: true, focused: 'installation', fits: true, animated: !spec.reduced, isolated: true })
      await contents.executeJavaScript(`Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished))`)
      const name = `${spec.theme}-${spec.width}${spec.reduced ? '-reduced' : ''}`
      await writeFile(join(root, `${name}.png`), (await contents.capturePage()).toPNG())
      results.push({ ...spec, ...result })
      dialogs.endInstallation()
      const failure = dialogs.show(parent, { message: locale.messages.updateInstallFailed })
      await contents.executeJavaScript(`Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished))`)
      assert.equal(await contents.executeJavaScript(`getComputedStyle(document.body, '::before').backgroundColor === getComputedStyle(document.getElementById('installation')).backgroundColor`), true)
      dialogs.cancel()
      await failure
      const destroyed = once(contents, 'destroyed')
      dialogs.dispose(); dialogs = undefined
      await destroyed
      assert.equal(overlays.input(parent).blocked, false)
      parent.destroy()
    }
    await writeFile(join(root, 'result.json'), JSON.stringify(results, null, 2) + '\n')
    console.log(`Installation presentation passed (${results.length} cases): ${root}`)
  } finally {
    clearTimeout(deadline)
    dialogs?.dispose()
    for (const window of windows) if (!window.isDestroyed()) window.destroy()
    protocol.unhandle('dsh-app')
    nativeTheme.themeSource = original
  }
}
void main().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
