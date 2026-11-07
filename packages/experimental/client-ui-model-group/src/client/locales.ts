/**
 * Locale-owned model-group controls and settings.
 * @module
 */
export const en = {
  title: 'Model groups', description: 'Choose a leader and let your models collaborate in one chat.',
  single: 'Single model', multi: 'Model group', leader: 'Leader', members: 'Models', strengths: 'Strengths',
  defaultMode: 'Default for new chats', maxParallel: 'Parallel model limit',
  noModels: 'Choose models and a leader in this plugin’s settings',
  stop: 'Stop round', stopMember: 'Stop', tasks: 'Shared tasks', idle: 'Idle', running: 'Running',
  save: 'Save', saving: 'Saving…', saveFailed: 'Could not save these settings',
  unavailable: 'Settings are unavailable', readOnly: 'These settings are read-only',
  invalid: 'Check the selected models and leader', loadFailed: 'Could not load the model list', retry: 'Retry',
  mention: 'Send a message to this model', operationFailed: 'Could not complete this action',
  user: 'You', copy: 'Copy', copied: 'Copied', footnotes: 'Footnotes',
  pending: 'Pending', in_progress: 'In progress', completed: 'Completed', deleted: 'Deleted', failed: 'The model request failed without a complete reply. Mention this model to try again later.', mode: 'Conversation mode',
  stopped: 'Stopped',
  assignment: 'Task assignment', assigned: 'Assigned', assignmentFailed: 'Assignment failed',
  taskList: 'Read shared tasks', taskCreate: 'Create task', taskClaim: 'Start task', taskComplete: 'Complete task',
  taskRelease: 'Release task', taskDependencies: 'Update task dependencies', taskUpdate: 'Update shared tasks',
  actionFailed: 'Action failed', input: 'Input', output: 'Result',
  selfAssignment: 'The leader tried to assign its own task. It must answer directly and assign work only to other models.',
  dispatchFailed: 'Could not assign this task. Expand the details to check the cause before retrying.',
  taskFailed: 'The task update failed. Read the shared tasks before retrying.',
  sentTo: 'Sent to', deliveryFailed: 'Delivery failed or unconfirmed:', messageModels: 'Message a model',
} as const
/**
 * Keys shared by every locale.
 */
export type GroupKey = keyof typeof en
/**
 * Chinese model-group copy.
 */
export const zh: Record<GroupKey, string> = {
  title: '模型群', description: '指定 leader，让多个模型在一个会话里协作',
  single: '单模型', multi: '模型群', leader: '组长', members: '模型', strengths: '擅长的任务',
  defaultMode: '新会话默认模式', maxParallel: '模型并行上限',
  noModels: '请在此插件的设置中选择成员模型和 leader',
  stop: '停止本轮', stopMember: '停止', tasks: '公共任务板', idle: '空闲', running: '运行中',
  save: '保存', saving: '保存中…', saveFailed: '未能保存设置',
  unavailable: '设置暂不可用', readOnly: '当前设置为只读',
  invalid: '请检查成员模型和 leader', loadFailed: '未能加载模型列表', retry: '重试',
  mention: '向此模型发送消息', operationFailed: '未能完成此操作',
  user: '你', copy: '复制', copied: '已复制', footnotes: '脚注',
  pending: '待处理', in_progress: '执行中', completed: '已完成', deleted: '已删除', failed: '模型请求失败，未返回完整回复；可稍后 @ 此模型重试', mode: '会话模式',
  stopped: '已停止',
  assignment: '任务分配', assigned: '已分配', assignmentFailed: '分配失败',
  taskList: '查看公共任务', taskCreate: '创建任务', taskClaim: '开始任务', taskComplete: '完成任务',
  taskRelease: '释放任务', taskDependencies: '更新任务依赖', taskUpdate: '更新公共任务',
  actionFailed: '操作失败', input: '输入', output: '结果',
  selfAssignment: '组长尝试把任务分配给自己。组长应直接回答自己的部分，只把其他任务分配给成员',
  dispatchFailed: '未能分配此任务，可展开查看原因后重试',
  taskFailed: '任务更新失败，请先查看公共任务的最新状态再重试',
  sentTo: '已发送给', deliveryFailed: '发送失败或未确认：', messageModels: '发消息给模型',
}
