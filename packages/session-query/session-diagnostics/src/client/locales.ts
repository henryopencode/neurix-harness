/** Typed copy for the local diagnostics settings section. */
export const en = {
  nav: 'Diagnostics', title: 'Diagnostics and errors', intro: 'Local failure records from your Sessions. No automatic upload; original logs remain unchanged.',
  scope: 'Scope', all: 'All projects', focusedSession: 'Source Session', category: 'Category', allCategories: 'All categories',
  shortcut: 'View error record', focusUnavailable: 'The source event is not in the available index. Refresh history to check missing records; retention limits may omit older occurrences.',
  arguments: 'Arguments', command: 'Command', permission: 'Permission', tool: 'Tool', turn: 'Turn',
  time: 'Time', anytime: 'All time', day: 'Last 24 hours', week: 'Last 7 days', month: 'Last 30 days',
  search: 'Search failures', refresh: 'Refresh index', reload: 'Reload', loading: 'Loading diagnostics…',
  empty: 'No matching errors in the available index.', failed: 'Could not load diagnostics. Reload before exporting or retrying.',
  coverage: 'Sessions inspected: {sessions} · Events inspected: {events}', incomplete: 'Results are incomplete. Unindexed Sessions: {unindexed} · Omitted occurrences: {omitted} · Failed reads: {failed}. Refresh the index to inspect more history.',
  count: 'Occurrences: {count}', last: 'Last seen {time}', select: 'Select group for export', details: 'Error details',
  source: 'Open source Session', event: 'Event #{seq} · Turn {turn}', unknown: 'Cause and recovery have not been verified.',
  export: 'Export report', exportGroup: 'Export this group', exportSelected: 'Export selected ({count})',
  preview: 'Review diagnostic report', privacy: 'Common credentials and home directory names are masked, but arbitrary error text may still contain private information. Review the complete preview before sharing. No full conversations, attachments, raw arguments or successful command output are included.',
  download: 'Download local ZIP', close: 'Close', cancel: 'Cancel', exportFailed: 'Could not create the report. Nothing was uploaded; try again.',
  unavailable: 'Could not open the source Session. It may have been removed or access may have changed.',
  reportTitle: 'Local diagnostic report', reportIncomplete: 'Incomplete index; counts describe retained occurrences only.',
  include: 'Included: Markdown summary and JSON facts with Session/event references.',
} as const
/** Keys supplied by each localized dictionary. */
export type DiagnosticUiKey = keyof typeof en
/** Simplified Chinese diagnostics settings copy. */
export const zh: Record<DiagnosticUiKey, string> = {
  nav: '诊断与错误', title: '诊断与错误', intro: '从会话中整理的本地错误记录，不自动上传，不修改原始日志。',
  scope: '范围', all: '全部项目', focusedSession: '来源会话', category: '类型', allCategories: '全部类型',
  shortcut: '查看错误记录', focusUnavailable: '可用索引中没有该来源事件。可更新历史索引以检查未索引记录；保留上限也可能已省略较早的记录。',
  arguments: '参数错误', command: '命令异常', permission: '权限拒绝', tool: '工具异常', turn: '回合异常',
  time: '时间', anytime: '全部时间', day: '最近 24 小时', week: '最近 7 天', month: '最近 30 天',
  search: '搜索错误', refresh: '更新历史索引', reload: '重新加载', loading: '正在加载诊断记录…',
  empty: '当前可用索引中没有匹配的错误。', failed: '暂时无法加载诊断记录，请重新加载后再导出或重试。',
  coverage: '已检查 {sessions} 个会话 · {events} 个事件', incomplete: '结果尚不完整：{unindexed} 个会话未索引，{omitted} 次记录因上限省略，{failed} 个会话读取失败。可更新索引以检查更多历史记录。',
  count: '发生 {count} 次', last: '最近发生于 {time}', select: '选择要导出的错误组', details: '错误详情',
  source: '打开来源会话', event: '事件 #{seq} · 第 {turn} 回合', unknown: '具体原因与恢复情况尚未验证。',
  export: '导出报告', exportGroup: '导出此组', exportSelected: '导出所选（{count}）',
  preview: '检查诊断报告', privacy: '已遮盖常见凭据和用户主目录名称，但任意错误文本仍可能含有隐私。分享前请检查完整预览。报告不包含完整对话、附件、原始参数或成功命令的输出。',
  download: '下载本地 ZIP', close: '关闭', cancel: '取消', exportFailed: '暂时无法生成报告；没有上传任何内容，请重试。',
  unavailable: '暂时无法打开来源会话，它可能已被移除或访问权限已变化。',
  reportTitle: '本地诊断报告', reportIncomplete: '索引不完整；次数仅表示当前保留的记录。',
  include: '包含 Markdown 摘要及带会话与事件引用的 JSON 事实。',
}
