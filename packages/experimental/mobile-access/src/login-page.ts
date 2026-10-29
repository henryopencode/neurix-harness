/** Public phone sign-in document; no launch token, third-party resources, or account identifiers. @module */

/**
 * Render the phone's Neurix sign-in page with an explicit language choice from the request.
 * @param chinese - whether the browser prefers Chinese.
 * @returns standalone responsive sign-in HTML posting only to this Host.
 */
export function loginPage(chinese: boolean): string {
  const title = chinese ? '登录 Neurix' : 'Sign in to Neurix'
  const username = chinese ? '账号' : 'Account'
  const password = chinese ? '密码' : 'Password'
  const hint = chinese ? '使用这台电脑绑定的 Neurix 账号' : 'Use the Neurix account bound to this computer.'
  const failed = chinese ? '登录失败，请检查账号和密码，或稍后重试' : 'Sign-in failed. Check your credentials or try again later.'
  return `<!doctype html><html lang="${chinese ? 'zh-CN' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>html{color-scheme:light dark}body{margin:0;font-family:system-ui,sans-serif;min-height:100dvh;display:grid;place-items:center}
main{width:min(360px,calc(100% - 48px));padding:24px 0}h1{font-size:24px}p{line-height:1.5;opacity:.75}
form,label{display:flex;flex-direction:column;gap:10px}form{gap:20px}input,button{box-sizing:border-box;width:100%;font:inherit;font-size:16px;
padding:12px;border:1px solid #8887;border-radius:10px}button{cursor:pointer;background:#17191b;color:white}#error{color:#c53939}</style>
</head><body><main><h1>${title}</h1><p>${hint}</p><form id="login">
<label>${username}<input name="username" autocomplete="username" minlength="3" maxlength="80" required></label>
<label>${password}<input name="password" type="password" autocomplete="current-password" minlength="12" maxlength="128" required></label>
<p id="error" role="alert" hidden>${failed}</p><button type="submit">${title}</button></form></main>
<script>document.getElementById('login').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;
const button=form.querySelector('button');button.disabled=true;document.getElementById('error').hidden=true;
try{const fields=new FormData(form);const response=await fetch('/neurix/login',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({username:fields.get('username'),password:fields.get('password')})});if(!response.ok)throw new Error();
form.reset();location.replace('./')}catch(error){document.getElementById('error').hidden=false;button.disabled=false}});</script>
</body></html>`
}
