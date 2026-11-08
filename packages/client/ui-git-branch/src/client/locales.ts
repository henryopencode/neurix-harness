/** Locale-owned branch metadata and retry copy. */
const en = {
  branch: 'Git branch: {name}', detached: 'Detached · {commit}',
  failed: 'Could not read the Git branch', retry: 'Retry Git',
} as const
/** Localized branch badge keys. */
export type GitBranchKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Current Git branch and detached HEAD copy. */
    'git-branch': GitBranchKey
  }
}

/** Complete dictionaries for every supported locale. */
export const dictionaries: Record<'en' | 'zh' | 'ja' | 'es' | 'fr' | 'de' | 'ru' | 'pt', Record<GitBranchKey, string>> = {
  en,
  zh: { branch: 'Git 分支：{name}', detached: '分离 HEAD · {commit}', failed: '无法读取 Git 分支', retry: '重试 Git' },
  ja: { branch: 'Git ブランチ: {name}', detached: '分離 HEAD · {commit}', failed: 'Git ブランチを読み取れませんでした', retry: 'Git を再試行' },
  es: { branch: 'Rama de Git: {name}', detached: 'HEAD separado · {commit}', failed: 'No se pudo leer la rama de Git', retry: 'Reintentar Git' },
  fr: { branch: 'Branche Git : {name}', detached: 'HEAD détachée · {commit}', failed: 'Impossible de lire la branche Git', retry: 'Réessayer Git' },
  de: { branch: 'Git-Branch: {name}', detached: 'Losgelöster HEAD · {commit}', failed: 'Git-Branch konnte nicht gelesen werden', retry: 'Git erneut laden' },
  ru: { branch: 'Ветка Git: {name}', detached: 'Отсоединённый HEAD · {commit}', failed: 'Не удалось прочитать ветку Git', retry: 'Повторить Git' },
  pt: { branch: 'Branch do Git: {name}', detached: 'HEAD separado · {commit}', failed: 'Não foi possível ler o branch do Git', retry: 'Tentar Git novamente' },
}
