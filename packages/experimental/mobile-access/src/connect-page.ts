/** Public connection bootstrap; the link secret stays out of HTTP URLs and referrers. @module */

/**
 * Render an account-free connection page without embedding a secret.
 * @param chinese - whether the requesting browser prefers Chinese.
 * @param nonce - response-specific CSP nonce for the inline script and styles.
 * @returns responsive HTML that exchanges a URL fragment for an HttpOnly cookie.
 */
export function connectPage(chinese: boolean, nonce: string): string {
  const title = chinese ? '连接 Neurix' : 'Connect to Neurix'
  const hint = chinese ? '请在电脑的“手机连接”中扫码或复制完整链接' : 'Scan or copy the full link from Phone connection on your computer.'
  const failed = chinese ? '连接未完成，请重试或从电脑获取最新链接' : 'Could not connect. Retry or get the latest link from your computer.'
  const connecting = chinese ? '正在连接…' : 'Connecting…'
  const retry = chinese ? '重试' : 'Retry'
  return `<!doctype html><html lang="${chinese ? 'zh-CN' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style nonce="${nonce}">html{color-scheme:light dark}body{margin:0;font-family:system-ui,sans-serif;min-height:100dvh;display:grid;place-items:center}
main{width:min(360px,calc(100% - 48px));padding:24px 0}h1{font-size:24px;font-weight:500}p{line-height:1.5}
button{font:inherit;font-size:16px;padding:10px 20px;cursor:pointer}</style>
</head><body><main><h1>${title}</h1><p id="status" role="status">${hint}</p><button id="retry" hidden>${retry}</button></main>
<script nonce="${nonce}">(()=>{let token;let attempt=0;const status=document.getElementById('status');const button=document.getElementById('retry');
async function connect(){const current=++attempt;const value=token;button.hidden=true;status.textContent=${JSON.stringify(connecting)};
try{const response=await fetch('/neurix/connect',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
body:JSON.stringify({token:value})});if(current!==attempt)return;if(!response.ok)throw new Error();location.replace('/')}
catch(error){if(current!==attempt)return;status.textContent=${JSON.stringify(failed)};button.hidden=false}}
function readLink(){token=new URLSearchParams(location.hash.slice(1)).get('connect');
if(location.hash)history.replaceState(null,'',location.pathname+location.search);if(token)void connect()}
button.addEventListener('click',connect);window.addEventListener('hashchange',readLink);readLink()})();</script></body></html>`
}
