/** Account-free phone connection and application menu copy. @module */

/** English phone connection dictionary. */
export const en = {
  description: 'Connect your phone to this computer’s Agent with a private link or QR code.',
  title: 'Phone connection', network: 'Network', start: 'Enable connection', stop: 'Disable connection',
  hint: 'Scan or open the link on the same Wi-Fi. Keep this computer running.',
  internetHint: 'Scan or open the link from any network. Keep this computer running and online.',
  unencrypted: 'Use trusted Wi-Fi; this connection is not encrypted.',
  empty: 'Connect this computer to Wi-Fi or Ethernet, then reopen this panel.',
  failed: 'Could not update the phone connection. Check the connection and retry.',
  loadFailed: 'Could not load the connection. Close this panel and try again.',
  link: 'Phone connection link', qr: 'Scan to connect your phone', copy: 'Copy link', copied: 'Copied',
  regenerate: 'Update link', linkHint: 'Anyone with this link can control the Agent. It stays valid until updated; updating disconnects all phones.',
  opened: 'Phone connection enabled', closed: 'Phone connection disabled', updated: 'Link updated; previous connections revoked',
  computerRequired: 'Manage the connection link from the computer.', disconnectPhone: 'Disconnect this phone',
  more: 'More', settings: 'Settings', feedback: 'Feedback', feedbackUnavailable: 'The feedback channel is not available yet.', close: 'Close',
}

/** Phone connection dictionary keys. */
export type MobileAccessLocaleKey = keyof typeof en

/** Chinese phone connection dictionary. */
export const zh: Record<MobileAccessLocaleKey, string> = {
  description: '通过专属链接或二维码，从手机连接这台电脑上的 Agent',
  title: '手机连接', network: '网络', start: '开启连接', stop: '关闭连接',
  hint: '手机连接同一 Wi-Fi 后扫码或打开链接，电脑需保持运行',
  internetHint: '扫码或打开链接即可连接，支持流量和任意 Wi-Fi，电脑需保持运行和联网',
  unencrypted: '请使用可信 Wi-Fi，此连接未加密',
  empty: '请先让电脑联网，再重新打开此面板',
  failed: '更新手机连接失败，请检查连接后重试',
  loadFailed: '读取连接失败，请关闭面板后重试',
  link: '手机连接链接', qr: '扫码连接手机', copy: '复制链接', copied: '已复制',
  regenerate: '更新链接', linkHint: '持有链接即可控制 Agent，请妥善保管；链接持续有效，更新后旧链接和所有手机连接失效',
  opened: '已开启手机连接', closed: '已关闭手机连接', updated: '链接已更新，旧连接已撤销',
  computerRequired: '请在电脑上管理连接链接', disconnectPhone: '断开此手机',
  more: '更多', settings: '设置', feedback: '意见反馈', feedbackUnavailable: '反馈通道暂未开通', close: '关闭',
}
