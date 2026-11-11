/** Main-owned copy and responses; Escape is cancellation, never acceptance. */
const api = window.dshUpdateDialog
let view
let responding = false
function respond(index) {
  if (responding || view === undefined || view.busyButton !== undefined || view.installationVersion !== undefined) return
  responding = true
  void api.respond(view.revision, index).catch(() => { responding = false })
}
document.getElementById('close').addEventListener('click', () => { respond(view.cancelId) })
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && view !== undefined) { event.preventDefault(); respond(view.cancelId) }
  if (event.key !== 'Tab') return
  if (view?.installationVersion !== undefined) { event.preventDefault(); return }
  const controls = [...document.querySelectorAll('button:not(:disabled), details:not([hidden]) > summary, details[open]:not([hidden]) > pre')]
  if (controls.length === 0) { event.preventDefault(); return }
  const current = controls.indexOf(document.activeElement)
  const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
    : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length
  event.preventDefault()
  controls[next].focus()
})
function render(state) {
  if (state === null) {
    responding = true
    document.body.classList.remove('visible')
    return
  }
  if (view !== undefined && state.revision <= view.revision) return
  responding = false
  view = state
  document.documentElement.lang = state.locale
  document.title = state.title
  const installing = state.installationVersion !== undefined
  const installation = document.getElementById('installation')
  document.getElementById('dialog').inert = installing
  document.getElementById('dialog').setAttribute('aria-hidden', String(installing))
  installation.inert = !installing
  if (installing) {
    document.getElementById('installation-title').textContent = state.message
    document.getElementById('installation-detail').textContent = state.detail
    document.getElementById('installation-version').textContent = state.installationVersionLabel
    document.body.classList.add('installation-backdrop')
    // Establish the transparent entrance even when this is the document's first view.
    installation.getBoundingClientRect()
  }
  document.body.classList.toggle('installing', installing)
  document.getElementById('title').textContent = state.message
  document.getElementById('detail').textContent = state.detail
  document.getElementById('detail').hidden = state.detail === ''
  document.getElementById('close').disabled = state.busyButton !== undefined
  document.getElementById('close').setAttribute('aria-label', state.closeLabel)
  document.getElementById('technical-details').hidden = state.technicalDetails === ''
  document.getElementById('technical-details-label').textContent = state.technicalDetailsLabel
  document.getElementById('technical-details-content').textContent = state.technicalDetails
  document.getElementById('technical-details').open = false
  document.getElementById('actions').replaceChildren()
  for (const [index, label] of state.buttons.entries()) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.disabled = state.busyButton !== undefined
    if (state.busyButton === index) button.setAttribute('aria-busy', 'true')
    button.className = index === 0 ? 'primary' : 'secondary'
    button.addEventListener('click', () => { respond(index) })
    document.getElementById('actions').append(button)
  }
  document.querySelector('main').hidden = false
  document.getElementById('dialog').scrollTop = 0
  document.body.classList.add('visible')
  if (installing) {
    installation.focus()
    void acknowledgeCoverage(state.revision).catch(error => { console.error('desktop update: presentation failed', error) })
  } else document.getElementById('dialog').focus()
}
async function acknowledgeCoverage(revision) {
  // Animation completion and a subsequent paint precede service shutdown.
  await new Promise(resolve => requestAnimationFrame(resolve))
  await Promise.allSettled(document.getElementById('installation').getAnimations().map(animation => animation.finished))
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  if (!responding && view?.revision === revision && view.installationVersion !== undefined
    && getComputedStyle(document.getElementById('installation')).opacity === '1') {
    document.getElementById('installation').focus()
    await api.covered(revision)
  }
}
let received = false
const unsubscribe = api.subscribe(state => { received = true; render(state) })
window.addEventListener('pagehide', unsubscribe, { once: true })
void api.status().then(state => { if (!received) render(state) })
