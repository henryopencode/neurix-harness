/** `sidebar` namespace dictionaries for shell controls and global panels. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'panels.unpinTooltip': '从左侧栏取消固定',
  'panels.unpin': '从侧边栏取消固定{name}',
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'navigation.home': '首页',
  'panels.label': '全局面板',
  'navigation.label': '导航',
  'panels.more': '更多',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'panels.unpinTooltip': 'Unpin from left sidebar',
  'panels.unpin': 'Unpin {name} from sidebar',
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'navigation.home': 'Home',
  'panels.label': 'Global panels',
  'navigation.label': 'Navigation',
  'panels.more': 'More',
} satisfies Record<SidebarKey, string>

/** Japanese copy, checked against the English keys. */
export const ja = {
  'panels.unpinTooltip': '左サイドバーから固定解除',
  'panels.unpin': '{name}をサイドバーから固定解除',
  'session.new': '新規セッション',
  'session.new.label': '新規セッション',
  'toggle.open': 'サイドバーを開く',
  'toggle.collapse': 'サイドバーを折りたたむ',
  'navigation.home': 'ホーム',
  'panels.label': 'グローバルパネル',
  'navigation.label': 'ナビゲーション',
  'panels.more': 'その他',
} satisfies Record<keyof typeof en, string>

/** Spanish dictionary, checked against the English keys. */
export const es = {
  'panels.unpinTooltip': 'Desanclar de la barra lateral izquierda',
  'panels.unpin': 'Desfijar {name} de la barra lateral',
  'session.new': 'Nueva sesión',
  'session.new.label': 'Nueva sesión',
  'toggle.open': 'Abrir barra lateral',
  'toggle.collapse': 'Contraer barra lateral',
  'navigation.home': 'Inicio',
  'panels.label': 'Paneles globales',
  'navigation.label': 'Navegación',
  'panels.more': 'Más',
} satisfies Record<keyof typeof en, string>

/** French dictionary, checked against the English keys. */
export const fr = {
  'panels.unpinTooltip': "Retirer l'épingle de la barre latérale gauche",
  'panels.unpin': 'Désépingler {name} de la barre latérale',
  'session.new': 'Nouvelle séance',
  'session.new.label': 'Nouvelle séance',
  'toggle.open': 'Ouvrir la barre latérale',
  'toggle.collapse': 'Réduire la barre latérale',
  'navigation.home': 'Accueil',
  'panels.label': 'Panneaux globaux',
  'navigation.label': 'Navigation',
  'panels.more': 'Plus',
} satisfies Record<keyof typeof en, string>

/** German dictionary, checked against the English keys. */
export const de = {
  'panels.unpinTooltip': 'Von der linken Seitenleiste lösen',
  'panels.unpin': '{name} von der Seitenleiste lösen',
  'session.new': 'Neue Sitzung',
  'session.new.label': 'Neue Sitzung',
  'toggle.open': 'Seitenleiste öffnen',
  'toggle.collapse': 'Seitenleiste einklappen',
  'navigation.home': 'Startseite',
  'panels.label': 'Globale Bereiche',
  'navigation.label': 'Navigation',
  'panels.more': 'Mehr',
} satisfies Record<keyof typeof en, string>

/** Russian dictionary, checked against the English keys. */
export const ru = {
  'panels.unpinTooltip': 'Открепить от левой боковой панели',
  'panels.unpin': 'Открепить {name} от боковой панели',
  'session.new': 'Новая сессия',
  'session.new.label': 'Новая сессия',
  'toggle.open': 'Открыть боковую панель',
  'toggle.collapse': 'Свернуть боковую панель',
  'navigation.home': 'Главная',
  'panels.label': 'Глобальные панели',
  'navigation.label': 'Навигация',
  'panels.more': 'Ещё',
} satisfies Record<keyof typeof en, string>

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  'panels.unpinTooltip': 'Soltar da barra lateral esquerda',
  'panels.unpin': 'Desafixar {name} da barra lateral',
  'session.new': 'Nova sessão',
  'session.new.label': 'Nova sessão',
  'toggle.open': 'Abrir barra lateral',
  'toggle.collapse': 'Recolher barra lateral',
  'navigation.home': 'Início',
  'panels.label': 'Painéis globais',
  'navigation.label': 'Navegação',
  'panels.more': 'Mais',
} satisfies Record<keyof typeof en, string>
