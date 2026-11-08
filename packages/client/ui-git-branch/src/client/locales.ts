/** Localized branch-selector controls and recovery messages. */

/** English copy and translation key set. */
export const en = {
  'branch.switch': 'Switch Git branch: {branch}',
  'branch.detached': 'Detached at {commit}',
  'branch.search': 'Search branches',
  'branch.empty': 'No matching branches',
  'branch.unborn': 'No local branches yet',
  'branch.occupied': 'In another worktree',
  'branch.busy': 'This working tree is busy. Wait for current operations to finish.',
  'branch.shared': 'Switching affects all sessions in this working tree',
  'branch.loadFailed': 'Could not read Git branches. Retry to refresh.',
  'branch.retry': 'Retry',
  'branch.switched': 'Switched to {branch}',
  'branch.stale': 'The branch changed. Open the list again and retry.',
  'branch.rejected': 'Could not switch branches. Check local changes and other worktrees.',
  'branch.unknown': 'The switch could not be verified. Check the current branch and working files.',
  'branch.unavailable': 'Git branches unavailable',
} as const

/** Branch-selector translation keys. */
export type GitBranchKey = keyof typeof en

/** Chinese copy. */
export const zh: Record<GitBranchKey, string> = {
  'branch.switch': '切换 Git 分支：{branch}',
  'branch.detached': '分离状态 {commit}',
  'branch.search': '搜索分支',
  'branch.empty': '没有匹配的分支',
  'branch.unborn': '尚无本地分支',
  'branch.occupied': '已在其他工作树中使用',
  'branch.busy': '此工作树正在执行操作，请稍后切换',
  'branch.shared': '切换会影响此工作树中的所有会话',
  'branch.loadFailed': '无法读取 Git 分支，请重试刷新',
  'branch.retry': '重试',
  'branch.switched': '已切换到 {branch}',
  'branch.stale': '分支已发生变化，请重新打开列表后再试',
  'branch.rejected': '无法切换分支，请检查未提交更改或其他工作树占用',
  'branch.unknown': '无法确认切换结果，请检查当前分支和工作区文件',
  'branch.unavailable': 'Git 分支不可用',
}
