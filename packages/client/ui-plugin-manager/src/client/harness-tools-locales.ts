/** Localized labels and notices for Harness tools settings. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    harnessTools: keyof typeof en
  }
}

const en = {
  title: 'Harness tools',
  toggle: 'Allow the agent to use {tool}',
  changing: 'Updating access to {tool}…',
  loadFailed: 'Could not read tool settings.',
  retry: 'Retry',
  unavailable: 'This tool cannot be managed here. Check Plugins for details.',
  unsupported: 'This tool is unavailable on this platform.',
  notActive: 'The agent cannot use this tool yet. Check Plugins for details.',
  stillActive: 'The agent can still use this tool. Check Plugins for details.',
}

const zh = {
  title: 'Harness 工具',
  toggle: '允许 Agent 调用 {tool}',
  changing: '正在更新 {tool} 的调用权限…',
  loadFailed: '无法读取工具设置',
  retry: '重试',
  unavailable: '此处无法管理此工具，请在「插件」中查看详情',
  unsupported: '此工具不支持当前平台',
  notActive: 'Agent 暂时无法调用此工具，请在「插件」中查看详情',
  stillActive: 'Agent 仍可调用此工具，请在「插件」中查看详情',
} satisfies Record<keyof typeof en, string>

const ja = {
  title: 'Harness ツール',
  toggle: 'エージェントに {tool} の使用を許可',
  changing: '{tool} の使用権限を更新中…',
  loadFailed: 'ツール設定を読み込めませんでした。',
  retry: '再試行',
  unavailable: 'ここではこのツールを管理できません。「プラグイン」で詳細を確認してください。',
  unsupported: 'このプラットフォームでは利用できません。',
  notActive: 'エージェントはまだこのツールを使用できません。「プラグイン」で詳細を確認してください。',
  stillActive: 'エージェントはまだこのツールを使用できます。「プラグイン」で詳細を確認してください。',
} satisfies Record<keyof typeof en, string>

const es = {
  title: 'Herramientas de Harness',
  toggle: 'Permitir que el agente use {tool}',
  changing: 'Actualizando el acceso a {tool}…',
  loadFailed: 'No se pudo leer la configuración de las herramientas.',
  retry: 'Reintentar',
  unavailable: 'Esta herramienta no se puede gestionar aquí. Consulta Complementos para más información.',
  unsupported: 'Esta herramienta no está disponible en esta plataforma.',
  notActive: 'El agente aún no puede usar esta herramienta. Consulta Complementos para más información.',
  stillActive: 'El agente todavía puede usar esta herramienta. Consulta Complementos para más información.',
} satisfies Record<keyof typeof en, string>

const fr = {
  title: 'Outils Harness',
  toggle: 'Autoriser l’agent à utiliser {tool}',
  changing: 'Mise à jour de l’accès à {tool}…',
  loadFailed: 'Impossible de lire les paramètres des outils.',
  retry: 'Réessayer',
  unavailable: 'Cet outil ne peut pas être géré ici. Consultez Plugins pour plus de détails.',
  unsupported: 'Cet outil est indisponible sur cette plateforme.',
  notActive: 'L’agent ne peut pas encore utiliser cet outil. Consultez Plugins pour plus de détails.',
  stillActive: 'L’agent peut encore utiliser cet outil. Consultez Plugins pour plus de détails.',
} satisfies Record<keyof typeof en, string>

const de = {
  title: 'Harness-Werkzeuge',
  toggle: 'Dem Agenten die Nutzung von {tool} erlauben',
  changing: 'Zugriff auf {tool} wird aktualisiert…',
  loadFailed: 'Werkzeugeinstellungen konnten nicht gelesen werden.',
  retry: 'Erneut versuchen',
  unavailable: 'Dieses Werkzeug kann hier nicht verwaltet werden. Details findest du unter Plugins.',
  unsupported: 'Dieses Werkzeug ist auf dieser Plattform nicht verfügbar.',
  notActive: 'Der Agent kann dieses Werkzeug noch nicht verwenden. Details findest du unter Plugins.',
  stillActive: 'Der Agent kann dieses Werkzeug weiterhin verwenden. Details findest du unter Plugins.',
} satisfies Record<keyof typeof en, string>

const ru = {
  title: 'Инструменты Harness',
  toggle: 'Разрешить агенту использовать {tool}',
  changing: 'Обновление доступа к {tool}…',
  loadFailed: 'Не удалось загрузить настройки инструментов.',
  retry: 'Повторить',
  unavailable: 'Здесь нельзя управлять этим инструментом. Подробности в разделе «Плагины».',
  unsupported: 'Этот инструмент недоступен на данной платформе.',
  notActive: 'Агент пока не может использовать этот инструмент. Подробности в разделе «Плагины».',
  stillActive: 'Агент всё ещё может использовать этот инструмент. Подробности в разделе «Плагины».',
} satisfies Record<keyof typeof en, string>

const pt = {
  title: 'Ferramentas do Harness',
  toggle: 'Permitir que o agente use {tool}',
  changing: 'A atualizar o acesso a {tool}…',
  loadFailed: 'Não foi possível ler as definições das ferramentas.',
  retry: 'Tentar novamente',
  unavailable: 'Esta ferramenta não pode ser gerida aqui. Consulte Plug-ins para mais informações.',
  unsupported: 'Esta ferramenta não está disponível nesta plataforma.',
  notActive: 'O agente ainda não pode usar esta ferramenta. Consulte Plug-ins para mais informações.',
  stillActive: 'O agente ainda pode usar esta ferramenta. Consulte Plug-ins para mais informações.',
} satisfies Record<keyof typeof en, string>

/** Dictionaries registered for Harness tools. */
export const harnessToolsCopy = { zh, en, ja, es, fr, de, ru, pt }
