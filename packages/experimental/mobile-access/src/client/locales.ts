/** Phone connection settings copy. @module */

/** English phone connection dictionary. */
export const en = {
  title: 'Phone connection', network: 'Network', start: 'Connect phone', stop: 'Disconnect phone', retry: 'Retry',
  hint: 'Scan on the same Wi-Fi to use this computer’s existing conversations.',
  internetHint: 'Use this HTTPS address on mobile data or any Wi-Fi. Keep this computer running and online.',
  internetStart: 'Enable remote access', internetStop: 'Disable remote access',
  unencrypted: 'Use trusted Wi-Fi; this connection is not encrypted.',
  encrypted: 'Sign in with your Neurix account to control this computer.',
  empty: 'Connect this computer to Wi-Fi or Ethernet, then retry.',
  failed: 'Could not update the phone connection. Check the network and retry.',
  link: 'Phone connection link', qr: 'Scan to connect your phone', copy: 'Copy link', copied: 'Copied',
  addHome: 'In Safari, choose Share → Add to Home Screen.',
  more: 'More', settings: 'Settings', feedback: 'Feedback', feedbackUnavailable: 'The feedback channel is not available yet.',
  accountTitle: 'Neurix account', signIn: 'Sign in', signOut: 'Sign out', register: 'Create account',
  username: 'Account name', password: 'Password', accountHint: 'Use this account on your phone to control the computer it is bound to.',
  passwordHint: 'Use 12–128 characters. Keep your model API keys in Models.', close: 'Close',
  accountFailed: 'Could not sign in. Check your account name and password, or try again later.',
  accountCreated: 'Signed in', accountLoading: 'Loading account', signInFirst: 'Sign in to Neurix from the More menu first.',
  signOutPhone: 'Sign out of this phone',
}

/** Phone connection dictionary keys. */
export type MobileAccessLocaleKey = keyof typeof en

/** Chinese phone connection dictionary. */
export const zh: Record<MobileAccessLocaleKey, string> = {
  title: '手机连接', network: '网络', start: '连接手机', stop: '断开手机连接', retry: '重试',
  hint: '手机连接同一 Wi-Fi 后扫码，即可接管这台电脑上的对话',
  internetHint: '手机使用流量或任意 Wi-Fi 均可访问此 HTTPS 地址，电脑需保持运行和联网',
  internetStart: '开启远程访问', internetStop: '关闭远程访问',
  unencrypted: '请使用可信 Wi-Fi，此连接未加密',
  encrypted: '使用 Neurix 账号登录后，即可控制这台电脑',
  empty: '请先让电脑连接 Wi-Fi 或以太网，再重试',
  failed: '更新手机连接失败，请检查网络后重试',
  link: '手机连接链接', qr: '扫码连接手机', copy: '复制链接', copied: '已复制',
  addHome: '在 Safari 中选择“分享 → 添加到主屏幕”',
  more: '更多', settings: '设置', feedback: '意见反馈', feedbackUnavailable: '反馈通道暂未开通',
  accountTitle: 'Neurix 账号', signIn: '登录', signOut: '退出登录', register: '创建账号',
  username: '账号', password: '密码', accountHint: '手机登录此账号，即可控制它绑定的这台电脑',
  passwordHint: '密码使用 12–128 个字符，模型 API 密钥仍在“模型”中配置', close: '关闭',
  accountFailed: '登录失败，请检查账号和密码，或稍后重试',
  accountCreated: '已登录', accountLoading: '正在读取账号', signInFirst: '请先从“更多”菜单登录 Neurix 账号',
  signOutPhone: '退出此手机',
}
