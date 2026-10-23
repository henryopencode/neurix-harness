/** Page-owned software cursor that follows browser-window stacking automatically. @module */

import type { Page } from 'playwright'

const feedbackMarkup = `<style>
:host{pointer-events:none}
.cursor{position:absolute;left:0;top:0;width:32px;height:32px;filter:drop-shadow(0 2px 4px #0008);transition-timing-function:ease-in-out}
.cursor[data-pressed="true"] path{fill:#4b85ff;stroke:#fff}
.cursor.clicked path{animation:click-color 450ms ease-out}
.ring{position:absolute;width:20px;height:20px;border:2px solid #4b85ff;border-radius:50%;opacity:0;transform:translate(-50%,-50%)}
.ring.pulse{animation:click-ring 450ms ease-out}
@keyframes click-ring{from{opacity:.9;scale:1}to{opacity:0;scale:3}}
@keyframes click-color{0%,55%{fill:#4b85ff}100%{fill:#888}}
.keys{position:absolute;bottom:20px;left:50%;display:flex;align-items:center;gap:12px;transform:translateX(-50%);border:1px solid #ffffff20;border-radius:14px;padding:10px 14px;color:#fff;background:#202020ed;box-shadow:0 4px 18px #0003;opacity:0}
kbd{display:grid;place-items:center;min-width:36px;height:36px;box-sizing:border-box;padding:0 8px;border:1px solid #ffffff35;border-bottom-width:3px;border-radius:7px;background:#ffffff10;color:#fff;font:500 23px -apple-system,BlinkMacSystemFont,system-ui,sans-serif}
.keyboard{display:grid;grid-template-columns:repeat(6,5px);gap:3px;padding:5px;border:1.5px solid #eee;border-radius:5px}
.keyboard i{display:block;width:5px;height:4px;background:#eee;border-radius:1px}.keyboard i:last-child{grid-column:2/6;width:auto}
.scroll{position:absolute;display:flex;align-items:center;gap:9px;padding:8px 11px;border:1px solid #ffffff20;border-radius:12px;background:#202020ed;color:#fff;box-shadow:0 3px 14px #0002;opacity:0;transition:opacity 160ms ease-out;white-space:nowrap}
.scroll.visible{opacity:1}.scroll[data-running="false"] .wheel-dot{animation-play-state:paused}.scroll-arrow{font:500 24px/1 system-ui}.wheel-shell{display:block;position:relative;width:18px;height:27px;border:1.5px solid #fff;border-radius:8px}
.wheel-dot{position:absolute;left:6px;top:6px;width:3px;height:6px;border-radius:2px;background:#fff;animation:wheel 650ms ease-out infinite}
.scroll[data-direction="up"]{--wheel-y:-5px;--wheel-x:0px}.scroll[data-direction="down"]{--wheel-y:5px;--wheel-x:0px}
.scroll[data-direction="left"]{--wheel-y:0px;--wheel-x:-4px}.scroll[data-direction="right"]{--wheel-y:0px;--wheel-x:4px}
@keyframes wheel{from{transform:translate(0,0);opacity:1}to{transform:translate(var(--wheel-x),var(--wheel-y));opacity:.2}}
@media(prefers-reduced-motion:reduce){.wheel-dot{animation:none;opacity:1}}
</style>
<svg class="cursor" viewBox="0 0 32 32"><path d="M3 3 Q1 1 2 6 L9 27 Q10 30 12 26 L15 17 L25 13 Q29 11 25 9 Z" fill="#888" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>
<div class="ring"></div>
<div class="keys"></div>
<div class="scroll"><span class="wheel-shell"><i class="wheel-dot"></i></span><span class="scroll-arrow"></span></div>`

/**
 * Display feedback inside the exact page without sending OS input or activating it.
 * The closed, inaccessible shadow root does not enter page accessibility text.
 * @param page - exact Agent-owned browser tab.
 * @param event - cursor point or display-only action indicator with at most the current key.
 * @returns after the page has applied the visual update.
 */
export async function showBrowserFeedback(page: Pick<Page, 'evaluate'>, event: {
  x?: number
  y?: number
  keys?: readonly string[]
  typing?: boolean
  key?: string
  click?: boolean
  pressed?: boolean
  hold?: boolean
  scroll?: 'up' | 'down' | 'left' | 'right'
  durationMs?: number
  idleMs: number
}): Promise<void> {
  await page.evaluate(`(event => {
    const id = Symbol.for('neurix.computer.feedback');
    let state = window[id];
    if (!state || !state.host.isConnected) {
      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.setAttribute('data-neurix-computer-feedback', '');
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden';
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = ${JSON.stringify(feedbackMarkup)};
      document.documentElement.appendChild(host);
      state = window[id] = { host, cursor: root.querySelector('.cursor'), ring: root.querySelector('.ring'), keys: root.querySelector('.keys'), scroll: root.querySelector('.scroll'), x: 0, y: 0 };
    }
    clearTimeout(state.timer); clearTimeout(state.hideTimer);
    state.hold = event.hold === true;
    state.host.style.visibility = 'visible';
    state.cursor.style.opacity = '1';
    if (event.x !== undefined && event.y !== undefined) {
      state.x = event.x; state.y = event.y;
      state.cursor.style.transitionDuration = (event.durationMs || 0) + 'ms';
      state.cursor.style.transform = 'translate(' + event.x + 'px,' + event.y + 'px)';
    }
    if (event.pressed !== undefined) {
      state.pressed = event.pressed;
      state.cursor.dataset.pressed = String(event.pressed);
    }
    if (event.click) {
      state.ring.style.left = state.x + 'px'; state.ring.style.top = state.y + 'px';
      state.cursor.classList.remove('clicked'); state.ring.classList.remove('pulse');
      state.cursor.getBoundingClientRect();
      state.cursor.classList.add('clicked'); state.ring.classList.add('pulse');
    }
    if (event.scroll !== undefined) {
      state.scroll.dataset.direction = event.scroll;
      state.scroll.querySelector('.scroll-arrow').textContent = { up: '↑', down: '↓', left: '←', right: '→' }[event.scroll];
      state.scroll.dataset.running = String(event.hold === true);
      const width = state.scroll.offsetWidth, height = state.scroll.offsetHeight;
      const right = state.x + 40;
      const left = right + width <= innerWidth - 8 ? right : state.x - width - 8;
      state.scroll.style.left = Math.max(8, Math.min(innerWidth - width - 8, left)) + 'px';
      state.scroll.style.top = Math.max(8, Math.min(innerHeight - height - 8, state.y + 16 - height / 2)) + 'px';
      state.scroll.classList.add('visible');
      state.cursor.classList.remove('clicked'); state.ring.classList.remove('pulse');
    } else state.scroll.classList.remove('visible');
    if (event.typing) {
      state.keys.innerHTML = '<span class="keyboard">' + '<i></i>'.repeat(13) + '</span>';
      if (event.key !== undefined) {
        const cap = document.createElement('kbd'); cap.textContent = event.key; state.keys.appendChild(cap);
      }
      state.keys.dataset.mode = 'typing';
      state.keys.style.opacity = '1';
    } else if (event.keys !== undefined) {
      state.keys.replaceChildren(...event.keys.map(key => {
        const cap = document.createElement('kbd'); cap.textContent = key; return cap;
      }));
      state.keys.dataset.mode = 'shortcut';
      state.keys.style.opacity = '1';
    } else {
      state.keys.style.opacity = '0';
    }
    if (!state.pressed && !state.hold) state.timer = setTimeout(() => {
      state.keys.style.opacity = '0';
      if (event.scroll !== undefined) {
        state.scroll.classList.remove('visible'); state.cursor.style.opacity = '0';
        state.hideTimer = setTimeout(() => { state.host.style.visibility = 'hidden'; }, 160);
      } else state.host.style.visibility = 'hidden';
    }, event.idleMs + (event.durationMs || 0));
  })(${JSON.stringify(event)})`)
}
