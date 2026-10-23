/** Computer-control form and testing instructions. @module */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** English copy for the settings and test instructions. */
export const en = {
  requireInputApproval: 'Ask before each computer action',
  approvalHint: 'Applies immediately to every conversation. Window listing and observation remain automatic. Without an available approval channel, actions are blocked.',
  previewPermissionRequired: 'Grant Accessibility and Screen Recording to the app running Harness, then retry',
  previewTimeout: 'Capture timed out. Retry preview',
  previewTooLarge: 'Image exceeds the preview limit. Close the preview to continue without it',
  previewTitle: 'Computer preview', previewShow: 'Show computer preview', previewHide: 'Hide computer preview', previewClose: 'Close preview',
  previewEnlarge: 'Enlarge', previewRestore: 'Restore', previewCollapse: 'Collapse', previewExpand: 'Expand',
  previewDrag: 'Move computer preview', previewImage: 'Live preview of the agent’s target window',
  previewUnavailable: 'Preview unavailable', previewRetry: 'Retry preview', previewIdle: 'Background preview', previewType: 'Typing', previewClick: 'Clicking',
  previewScrollDown: 'Scrolling down', previewScrollUp: 'Scrolling up',
  previewScrollLeft: 'Scrolling left', previewScrollRight: 'Scrolling right',
  previewMove: 'Moving cursor', previewKey: 'Pressing keys', previewRead: 'Observing', previewOther: 'Operating',
  description: 'Operate browser tabs and macOS applications from conversations.',
  inputMode: 'Input mode', foreground: 'Foreground system input', background: 'Browser background only',
  inputModeHint: 'Background mode operates browser tabs only. Desktop applications require selecting Foreground system input and saving; this activates the target and uses your system mouse and keyboard. Stop generating stops further input.',
  showOverlay: 'Show agent cursor and key indicators',
  scrollDurationMs: 'Browser scroll duration (ms)', scrollDurationMsHint: '0–5000 ms; zero scrolls immediately.',
  cursorMoveDurationMs: 'Mouse movement duration (ms)', typingDelayMs: 'Character delay (ms)', overlayIdleMs: 'Indicator display time (ms)',
  cursorMoveDurationMsHint: '0–5000 ms; zero moves the pointer immediately.', typingDelayMsHint: '0–200 ms between characters.', overlayIdleMsHint: '100–60000 ms after the last action.',
  browserChannel: 'Browser', browserHint: 'Install the selected browser on this computer.',
  chrome: 'Google Chrome', chromium: 'Chromium', msedge: 'Microsoft Edge',
  headless: 'Hide browser windows', screenshots: 'Include screenshots',
  screenshotsHint: 'Start with screenshots off for text models. Enable them for a model that supports image input.',
  operationTimeoutMs: 'Action timeout (ms)', navigationTimeoutMs: 'Startup and navigation timeout (ms)',
  nativeTreeTimeoutMs: 'Native accessibility read budget (ms)',
  nativeTreeTimeoutMsHint: '100–120000 ms; increase for large app interfaces. The action timeout still applies.',
  timeoutHint: 'Positive whole milliseconds. Interrupted input closes the owned browser; slow pages and failed screenshots keep it open.',
  newSessions: 'Input mode and approval changes apply to the next action in existing conversations. Other runtime defaults apply on first use; open tabs stay available.',
  permissions: 'For macOS apps, grant Accessibility to the app that launches Harness. Native screenshots also need Screen & System Audio Recording. Browser screenshots do not need that grant.',
  testing: 'Test computer control',
  testIntro: 'Save settings and start a new conversation. Browser background supports the browser test; select Foreground system input before testing desktop applications. Expand the process details to inspect computer calls and returned state.',
  testInspectTitle: '1. Inspect permissions and windows',
  testInspect: 'Use computer to list windows and report desktop permissions. Do not click, type, open, or close anything.',
  testBrowserTitle: '2. Test the browser',
  testBrowser: 'Use computer to open https://example.com in a new browser, read its page title and heading, then open a second tab to the same page. Verify both tabs, and close only the second tab. Keep the first open.',
  testNativeTitle: '3. Test a macOS app',
  testNativeHint: 'Select Foreground system input and save. Open TextEdit, create a new blank document, then send:',
  testNative: 'Use computer to find my new blank TextEdit document. Read its state, enter “Harness computer control works”, and read the document again to verify the text. Do not save, overwrite files, or close other windows.',
  testNoModel: 'These conversation tests require a working model account. A quota or balance error comes from the model service; it does not test computer control.',
  overridden: 'Overridden', reset: 'Reset to default', invalid: 'Enter a supported value; timeouts must be positive whole milliseconds.',
  unavailable: 'Enable this plugin to configure it. If it is already enabled, check its components below.',
  readOnly: 'This connection cannot change these settings.', saveFailed: 'Could not save. Check the values and try again.',
  save: 'Save', saving: 'Saving…', statusText: 'Text mode', statusImages: 'Screenshots on',
}

/** Dictionary keys accepted by the computer-control page. */
export type ComputerControlLocaleKey = keyof typeof en

/** Simplified Chinese copy for the settings and test instructions. */
export const zh: Record<ComputerControlLocaleKey, string> = {
  requireInputApproval: '每次电脑操作前确认',
  approvalHint: '立即应用于所有对话；列出窗口和读取状态仍自动执行。审批通道不可用时，操作会被阻止',
  previewPermissionRequired: '请为启动 Harness 的应用授予辅助功能和屏幕录制权限，然后重试',
  previewTimeout: '截图超时，请重试预览',
  previewTooLarge: '图片超过预览限制，可关闭画中画继续操作',
  previewTitle: '电脑画中画', previewShow: '显示电脑画中画', previewHide: '隐藏电脑画中画', previewClose: '关闭画中画',
  previewEnlarge: '放大', previewRestore: '还原', previewCollapse: '收起', previewExpand: '展开',
  previewDrag: '拖动画中画', previewImage: 'Agent 当前操作窗口的实时预览',
  previewUnavailable: '预览暂不可用', previewRetry: '重试预览', previewIdle: '后台预览', previewType: '正在输入', previewClick: '正在点击',
  previewScrollDown: '向下滚动', previewScrollUp: '向上滚动',
  previewScrollLeft: '向左滚动', previewScrollRight: '向右滚动',
  previewMove: '移动光标', previewKey: '按下按键', previewRead: '正在观察', previewOther: '正在操作',
  description: '在对话中连续操作浏览器标签页与 macOS 应用',
  inputMode: '操作模式', foreground: '前台系统操作', background: '网页后台',
  inputModeHint: '网页后台仅操作浏览器。桌面应用需选择“前台系统操作”并保存，届时会激活目标窗口并使用系统鼠标和键盘；点击停止生成可停止后续输入',
  showOverlay: '显示 Agent 独立光标与按键提示',
  scrollDurationMs: '网页滚动时长（毫秒）', scrollDurationMsHint: '0–5000 毫秒；设为 0 时立即滚动',
  cursorMoveDurationMs: '鼠标移动时长（毫秒）', typingDelayMs: '逐字输入间隔（毫秒）', overlayIdleMs: '操作提示停留时间（毫秒）',
  cursorMoveDurationMsHint: '0–5000 毫秒；设为 0 时鼠标直接到达目标', typingDelayMsHint: '每个字符之间间隔 0–200 毫秒', overlayIdleMsHint: '最后一次操作后保留 100–60000 毫秒',
  browserChannel: '浏览器', browserHint: '请先在这台电脑上安装所选浏览器',
  chrome: 'Google Chrome', chromium: 'Chromium', msedge: 'Microsoft Edge',
  headless: '隐藏浏览器窗口', screenshots: '附带截图',
  screenshotsHint: '文本模型请先关闭截图；使用支持图像输入的模型时再开启',
  operationTimeoutMs: '操作超时（毫秒）', navigationTimeoutMs: '启动与导航超时（毫秒）',
  nativeTreeTimeoutMs: '原生应用控件读取预算（毫秒）',
  nativeTreeTimeoutMsHint: '100–120000 毫秒；复杂应用可调高，整体仍受操作超时限制',
  timeoutHint: '填写正整数毫秒；输入操作中断时关闭独立浏览器，网页加载慢或截图失败时保留窗口',
  newSessions: '操作模式和输入审批的修改对已有对话的下一次操作生效；其他运行设置在首次使用时读取，已打开的标签页保留',
  permissions: '操作 macOS 应用前，请为启动 Harness 的应用授予辅助功能权限；原生截图还需要屏幕与系统音频录制权限，浏览器截图不需要此权限',
  testing: '测试电脑控制',
  testIntro: '保存设置后新建对话。网页后台可运行浏览器测试；测试桌面应用前请先选择前台系统操作。展开过程详情可检查 computer 调用和返回的状态',
  testInspectTitle: '1. 检查权限和窗口',
  testInspect: '请使用 computer 列出当前窗口并报告桌面权限，不要点击、输入、打开或关闭任何内容。',
  testBrowserTitle: '2. 测试浏览器',
  testBrowser: '请使用 computer 在独立浏览器打开 https://example.com，读取网页标题和主标题，再在第二个标签页打开同一网页。确认两个标签页都存在后，只关闭第二个，保留第一个。',
  testNativeTitle: '3. 测试 macOS 应用',
  testNativeHint: '先选择“前台系统操作”并保存，再打开“文本编辑”，新建空白文稿后发送：',
  testNative: '请使用 computer 找到我刚新建的空白“文本编辑”文稿，先读取状态，再输入“Harness 电脑控制测试成功”，最后重新读取并核对文本。不要保存、覆盖文件或关闭其他窗口。',
  testNoModel: '对话测试需要可用的模型账号；若提示额度或余额不足，是模型服务返回的错误，此时尚未测试到电脑控制',
  overridden: '已覆盖', reset: '恢复默认', invalid: '请填写支持的值；超时必须为正整数毫秒',
  unavailable: '启用此插件后即可配置；已启用时请检查下方组件状态',
  readOnly: '当前连接无法修改设置', saveFailed: '保存失败，请检查设置后重试',
  save: '保存', saving: '保存中…', statusText: '结构模式', statusImages: '已开启截图',
}

/**
 * Resolve the shared form's action labels.
 * @param t - localized computer-control reader.
 * @returns localized form chrome.
 */
export function formLabels(t: (key: ComputerControlLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
