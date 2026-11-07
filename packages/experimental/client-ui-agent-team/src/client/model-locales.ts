/** Candidate-model settings and role-attributed Team controls. */
export const modelEn = {
  title: 'Agent team', models: 'Candidate models', leaderModel: 'Lead model', maxParallel: 'Parallel teammate limit',
  strengths: 'Suitable tasks', unavailable: 'Settings are unavailable', readOnly: 'These settings are read-only',
  saveFailed: 'Could not save these settings', save: 'Save', saving: 'Saving…', loadFailed: 'Could not load the model list', retry: 'Retry',
  invalid: 'Select a Lead model from the candidate models', mention: 'Message', stop: 'Stop',
  failed: 'This teammate did not return a complete reply. Mention it to try again later.', operationFailed: 'Could not complete this action',
  leader: 'Lead', copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes',
  messageTeam: 'Message a teammate or model', running: 'Running',
} as const
/** Locale-owned Team model copy. */
export type ModelKey = keyof typeof modelEn
/** Chinese Team model copy. */
export const modelZh: Record<ModelKey, string> = {
  title: '智能体团队', models: '候选模型', leaderModel: '组长模型', maxParallel: '并行队友上限',
  strengths: '擅长的任务', unavailable: '设置暂不可用', readOnly: '当前设置为只读',
  saveFailed: '未能保存设置', save: '保存', saving: '保存中…', loadFailed: '未能加载模型列表', retry: '重试',
  invalid: '请从候选模型中选择组长模型', mention: '发消息给', stop: '停止',
  failed: '此队友未返回完整回复，可稍后 @ 此队友重试', operationFailed: '未能完成此操作',
  leader: '组长', copy: '复制', copied: '已复制', footnotes: '脚注',
  messageTeam: '发消息给队友或模型', running: '运行中',
}
