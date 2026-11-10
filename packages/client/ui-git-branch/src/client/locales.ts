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

/** Japanese copy. */
export const ja: Record<GitBranchKey, string> = {
  'branch.switch': 'Git ブランチを切り替え: {branch}',
  'branch.detached': '{commit} でデタッチ',
  'branch.search': 'ブランチを検索',
  'branch.empty': '一致するブランチがありません',
  'branch.unborn': 'ローカルブランチはまだありません',
  'branch.occupied': '別のワークツリーで使用中',
  'branch.busy': 'このワークツリーは処理中です。現在の操作が完了するまでお待ちください。',
  'branch.shared': '切り替えはこのワークツリーのすべてのセッションに影響します',
  'branch.loadFailed': 'Git ブランチを読み込めませんでした。再試行して更新してください。',
  'branch.retry': '再試行',
  'branch.switched': '{branch} に切り替えました',
  'branch.stale': 'ブランチが変更されました。リストを開き直して再試行してください。',
  'branch.rejected': 'ブランチを切り替えられませんでした。ローカルの変更と他のワークツリーを確認してください。',
  'branch.unknown': '切り替えを確認できませんでした。現在のブランチと作業ファイルを確認してください。',
  'branch.unavailable': 'Git ブランチを利用できません',
}

/** Spanish copy. */
export const es: Record<GitBranchKey, string> = {
  'branch.switch': 'Cambiar rama de Git: {branch}',
  'branch.detached': 'HEAD separado en {commit}',
  'branch.search': 'Buscar ramas',
  'branch.empty': 'No hay ramas coincidentes',
  'branch.unborn': 'Aún no hay ramas locales',
  'branch.occupied': 'En otro árbol de trabajo',
  'branch.busy': 'Este árbol de trabajo está ocupado. Espera a que terminen las operaciones actuales.',
  'branch.shared': 'El cambio afecta a todas las sesiones de este árbol de trabajo',
  'branch.loadFailed': 'No se pudieron leer las ramas de Git. Reintenta para actualizar.',
  'branch.retry': 'Reintentar',
  'branch.switched': 'Se cambió a {branch}',
  'branch.stale': 'La rama cambió. Abre la lista de nuevo y reintenta.',
  'branch.rejected': 'No se pudo cambiar de rama. Comprueba los cambios locales y otros árboles de trabajo.',
  'branch.unknown': 'No se pudo verificar el cambio. Comprueba la rama actual y los archivos de trabajo.',
  'branch.unavailable': 'Ramas de Git no disponibles',
}

/** French copy. */
export const fr: Record<GitBranchKey, string> = {
  'branch.switch': 'Changer de branche Git : {branch}',
  'branch.detached': 'HEAD détachée sur {commit}',
  'branch.search': 'Rechercher des branches',
  'branch.empty': 'Aucune branche correspondante',
  'branch.unborn': 'Aucune branche locale pour le moment',
  'branch.occupied': 'Dans un autre arbre de travail',
  'branch.busy': 'Cet arbre de travail est occupé. Attendez la fin des opérations en cours.',
  'branch.shared': 'Le changement affecte toutes les sessions de cet arbre de travail',
  'branch.loadFailed': 'Impossible de lire les branches Git. Réessayez pour actualiser.',
  'branch.retry': 'Réessayer',
  'branch.switched': 'Branche remplacée par {branch}',
  'branch.stale': 'La branche a changé. Rouvrez la liste et réessayez.',
  'branch.rejected': 'Impossible de changer de branche. Vérifiez les modifications locales et les autres arbres de travail.',
  'branch.unknown': 'Impossible de vérifier le changement. Vérifiez la branche actuelle et les fichiers de travail.',
  'branch.unavailable': 'Branches Git indisponibles',
}

/** German copy. */
export const de: Record<GitBranchKey, string> = {
  'branch.switch': 'Git-Branch wechseln: {branch}',
  'branch.detached': 'Losgelöst bei {commit}',
  'branch.search': 'Branches suchen',
  'branch.empty': 'Keine passenden Branches',
  'branch.unborn': 'Noch keine lokalen Branches',
  'branch.occupied': 'In einem anderen Arbeitsbaum',
  'branch.busy': 'Dieser Arbeitsbaum ist beschäftigt. Warte, bis die aktuellen Vorgänge abgeschlossen sind.',
  'branch.shared': 'Der Wechsel betrifft alle Sitzungen in diesem Arbeitsbaum',
  'branch.loadFailed': 'Git-Branches konnten nicht gelesen werden. Versuche es zum Aktualisieren erneut.',
  'branch.retry': 'Erneut versuchen',
  'branch.switched': 'Zu {branch} gewechselt',
  'branch.stale': 'Der Branch wurde geändert. Öffne die Liste erneut und versuche es noch einmal.',
  'branch.rejected': 'Branch konnte nicht gewechselt werden. Prüfe lokale Änderungen und andere Arbeitsbäume.',
  'branch.unknown': 'Der Wechsel konnte nicht bestätigt werden. Prüfe den aktuellen Branch und die Arbeitsdateien.',
  'branch.unavailable': 'Git-Branches nicht verfügbar',
}

/** Russian copy. */
export const ru: Record<GitBranchKey, string> = {
  'branch.switch': 'Переключить ветку Git: {branch}',
  'branch.detached': 'Отсоединённая HEAD на {commit}',
  'branch.search': 'Поиск веток',
  'branch.empty': 'Подходящих веток нет',
  'branch.unborn': 'Локальных веток пока нет',
  'branch.occupied': 'В другом рабочем дереве',
  'branch.busy': 'Это рабочее дерево занято. Дождитесь завершения текущих операций.',
  'branch.shared': 'Переключение затрагивает все сессии в этом рабочем дереве',
  'branch.loadFailed': 'Не удалось прочитать ветки Git. Повторите попытку для обновления.',
  'branch.retry': 'Повторить',
  'branch.switched': 'Ветка изменена на {branch}',
  'branch.stale': 'Ветка изменилась. Откройте список заново и повторите попытку.',
  'branch.rejected': 'Не удалось переключить ветку. Проверьте локальные изменения и другие рабочие деревья.',
  'branch.unknown': 'Не удалось подтвердить переключение. Проверьте текущую ветку и рабочие файлы.',
  'branch.unavailable': 'Ветки Git недоступны',
}

/** Portuguese copy. */
export const pt: Record<GitBranchKey, string> = {
  'branch.switch': 'Trocar de branch Git: {branch}',
  'branch.detached': 'HEAD destacado em {commit}',
  'branch.search': 'Buscar branches',
  'branch.empty': 'Nenhuma branch correspondente',
  'branch.unborn': 'Ainda não há branches locais',
  'branch.occupied': 'Em outra árvore de trabalho',
  'branch.busy': 'Esta árvore de trabalho está ocupada. Aguarde a conclusão das operações atuais.',
  'branch.shared': 'A troca afeta todas as sessões desta árvore de trabalho',
  'branch.loadFailed': 'Não foi possível ler as branches Git. Tente novamente para atualizar.',
  'branch.retry': 'Tentar novamente',
  'branch.switched': 'Branch alterada para {branch}',
  'branch.stale': 'A branch mudou. Abra a lista novamente e tente outra vez.',
  'branch.rejected': 'Não foi possível trocar de branch. Verifique as alterações locais e outras árvores de trabalho.',
  'branch.unknown': 'Não foi possível verificar a troca. Verifique a branch atual e os arquivos de trabalho.',
  'branch.unavailable': 'Branches Git indisponíveis',
}
