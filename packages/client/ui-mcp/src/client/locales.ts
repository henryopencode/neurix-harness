/** Copy owned by the MCP management page. @module */
export const zh = {
  title: 'MCP', add: '添加服务器', edit: '编辑', remove: '移除', reconnect: '重新连接',
  enable: '启用 {name}', search: '搜索服务器或工具', refresh: '刷新', close: '关闭', cancel: '取消', save: '保存',
  empty: '尚未添加 MCP 服务器', noMatches: '没有匹配的服务器', loadFailed: '无法读取 MCP 连接，请重试',
  connecting: '连接中', connected: '已连接', reconnecting: '重连中', disconnected: '已断开', disabled: '已停用', unknown: '状态未知',
  tools: '{count} 个工具', noTools: '此服务器尚未提供工具', name: '服务器名称', transport: '连接方式',
  stdio: '本地命令', http: 'Streamable HTTP', command: '启动命令', args: '启动参数（每行一个）', cwd: '工作目录',
  url: '服务器地址', env: '环境变量（JSON）', headers: '请求头（JSON）', preserveCredentials: '留空保留已有值',
  globalHint: '此配置对本机所有会话生效', addTitle: '添加 MCP 服务器', editTitle: '编辑 MCP 服务器',
  removeTitle: '移除 MCP 服务器', removeDescription: '移除 {name} 的连接配置？',
  invalidCredentials: '请输入键和值均为字符串的 JSON 对象', saved: 'MCP 配置已保存', removed: 'MCP 服务器已移除',
  enabled: 'MCP 服务器已启用', stopped: 'MCP 服务器已停用', restarted: '已重新发起连接',
  failed: '操作失败，请刷新后重试', conflict: '配置已变更，请刷新列表后重试', duplicate: '服务器名称已存在，请换一个名称',
  unknownOutcome: '未能确认操作结果，请刷新列表查看当前配置',
  invalidConfig: '请检查服务器名称、启动命令或 HTTP 地址', reloadFailed: '配置未能应用，已恢复原配置，请检查设置后重试',
  overridden: '部署配置覆盖了此服务器，请先调整部署配置', recoveryRequired: '配置恢复失败，请检查全局配置文件并重启应用',
  readOnly: '当前部署不支持修改配置', expression: '此连接使用动态配置，请在配置文件中编辑',
} satisfies Record<string, string>

/** Locale keys used by the page and persistent notices. */
export type McpLocaleKey = keyof typeof zh

/** English copy; other locales use the application's English fallback. */
export const en: Record<McpLocaleKey, string> = {
  title: 'MCP', add: 'Add server', edit: 'Edit', remove: 'Remove', reconnect: 'Reconnect',
  enable: 'Enable {name}', search: 'Search servers or tools', refresh: 'Refresh', close: 'Close', cancel: 'Cancel', save: 'Save',
  empty: 'No MCP servers added', noMatches: 'No matching servers', loadFailed: 'Could not read MCP connections. Retry.',
  connecting: 'Connecting', connected: 'Connected', reconnecting: 'Reconnecting', disconnected: 'Disconnected', disabled: 'Disabled', unknown: 'Unknown status',
  tools: 'Tools ({count})', noTools: 'This server has not provided any tools', name: 'Server name', transport: 'Transport',
  stdio: 'Local command', http: 'Streamable HTTP', command: 'Command', args: 'Arguments (one per line)', cwd: 'Working directory',
  url: 'Server URL', env: 'Environment variables (JSON)', headers: 'Headers (JSON)', preserveCredentials: 'Leave blank to keep existing values',
  globalHint: 'This configuration applies to all sessions on this machine', addTitle: 'Add MCP server', editTitle: 'Edit MCP server',
  removeTitle: 'Remove MCP server', removeDescription: 'Remove the connection configuration for {name}?',
  invalidCredentials: 'Enter a JSON object whose keys and values are strings', saved: 'MCP configuration saved', removed: 'MCP server removed',
  enabled: 'MCP server enabled', stopped: 'MCP server disabled', restarted: 'Connection restarted',
  failed: 'The operation failed. Refresh and retry.', conflict: 'Configuration changed. Refresh the list and retry.', duplicate: 'This server name is already in use. Choose another.',
  unknownOutcome: 'Could not confirm the result. Refresh the list to check the current configuration.',
  invalidConfig: 'Check the server name, command, or HTTP URL', reloadFailed: 'The configuration could not be applied. The previous configuration was restored. Check the settings and retry.',
  overridden: 'Deployment configuration overrides this server. Update the deployment configuration first.', recoveryRequired: 'Configuration recovery failed. Check the global configuration file and restart the application.',
  readOnly: 'This deployment does not allow configuration changes', expression: 'This connection uses dynamic configuration. Edit it in the configuration file.',
}
