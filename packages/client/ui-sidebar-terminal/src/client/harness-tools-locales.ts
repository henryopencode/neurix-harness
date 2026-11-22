/** Localized copy for the Harness tools settings section. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    harnessTools: keyof typeof en
  }
}

const zh = {
  title: 'Harness 工具',
  refresh: '刷新',
  checking: '正在检测工具…',
  checkFailed: '无法检测工具，请刷新重试',
  empty: '没有配置 Harness 工具',
  chooseSession: '打开一个工作区会话即可启动工具',
  installed: '已安装',
  notDetected: '未检测到',
  start: '启动',
  resume: '续接会话',
  install: '安装指南',
  startTool: '启动 {tool}',
  resumeTool: '续接 {tool} 会话',
  installTool: '{tool} 安装指南',
} satisfies Record<keyof typeof en, string>

const en = {
  title: 'Harness tools',
  refresh: 'Refresh',
  checking: 'Checking tools…',
  checkFailed: 'Could not check tools. Refresh to try again.',
  empty: 'No Harness tools are configured.',
  chooseSession: 'Open a workspace conversation to start a tool.',
  installed: 'Installed',
  notDetected: 'Not detected',
  start: 'Start',
  resume: 'Resume',
  install: 'Install guide',
  startTool: 'Start {tool}',
  resumeTool: 'Resume a {tool} session',
  installTool: '{tool} install guide',
}

const ja = {
  title: 'Harness ツール',
  refresh: '更新',
  checking: 'ツールを確認中…',
  checkFailed: 'ツールを確認できませんでした。更新して再試行してください。',
  empty: 'Harness ツールが設定されていません。',
  chooseSession: 'ツールを起動するにはワークスペースの会話を開いてください。',
  installed: 'インストール済み',
  notDetected: '未検出',
  start: '起動',
  resume: '再開',
  install: 'インストールガイド',
  startTool: '{tool} を起動',
  resumeTool: '{tool} のセッションを再開',
  installTool: '{tool} のインストールガイド',
} satisfies Record<keyof typeof en, string>

const es = {
  title: 'Herramientas de Harness',
  refresh: 'Actualizar',
  checking: 'Comprobando herramientas…',
  checkFailed: 'No se pudieron comprobar las herramientas. Actualiza para volver a intentarlo.',
  empty: 'No hay herramientas de Harness configuradas.',
  chooseSession: 'Abre una conversación del espacio de trabajo para iniciar una herramienta.',
  installed: 'Instalada',
  notDetected: 'No detectada',
  start: 'Iniciar',
  resume: 'Reanudar',
  install: 'Guía de instalación',
  startTool: 'Iniciar {tool}',
  resumeTool: 'Reanudar una sesión de {tool}',
  installTool: 'Guía de instalación de {tool}',
} satisfies Record<keyof typeof en, string>

const fr = {
  title: 'Outils Harness',
  refresh: 'Actualiser',
  checking: 'Vérification des outils…',
  checkFailed: 'Impossible de vérifier les outils. Actualisez pour réessayer.',
  empty: 'Aucun outil Harness n’est configuré.',
  chooseSession: 'Ouvrez une conversation dans un espace de travail pour lancer un outil.',
  installed: 'Installé',
  notDetected: 'Non détecté',
  start: 'Lancer',
  resume: 'Reprendre',
  install: 'Guide d’installation',
  startTool: 'Lancer {tool}',
  resumeTool: 'Reprendre une session {tool}',
  installTool: 'Guide d’installation de {tool}',
} satisfies Record<keyof typeof en, string>

const de = {
  title: 'Harness-Werkzeuge',
  refresh: 'Aktualisieren',
  checking: 'Werkzeuge werden geprüft…',
  checkFailed: 'Werkzeuge konnten nicht geprüft werden. Aktualisiere, um es erneut zu versuchen.',
  empty: 'Es sind keine Harness-Werkzeuge konfiguriert.',
  chooseSession: 'Öffne eine Unterhaltung im Arbeitsbereich, um ein Werkzeug zu starten.',
  installed: 'Installiert',
  notDetected: 'Nicht erkannt',
  start: 'Starten',
  resume: 'Fortsetzen',
  install: 'Installationsanleitung',
  startTool: '{tool} starten',
  resumeTool: 'Eine {tool}-Sitzung fortsetzen',
  installTool: '{tool}: Installationsanleitung',
} satisfies Record<keyof typeof en, string>

const ru = {
  title: 'Инструменты Harness',
  refresh: 'Обновить',
  checking: 'Проверка инструментов…',
  checkFailed: 'Не удалось проверить инструменты. Обновите список и повторите попытку.',
  empty: 'Инструменты Harness не настроены.',
  chooseSession: 'Откройте диалог в рабочей области, чтобы запустить инструмент.',
  installed: 'Установлен',
  notDetected: 'Не найден',
  start: 'Запустить',
  resume: 'Продолжить',
  install: 'Руководство по установке',
  startTool: 'Запустить {tool}',
  resumeTool: 'Продолжить сеанс {tool}',
  installTool: 'Руководство по установке {tool}',
} satisfies Record<keyof typeof en, string>

const pt = {
  title: 'Ferramentas do Harness',
  refresh: 'Atualizar',
  checking: 'A verificar ferramentas…',
  checkFailed: 'Não foi possível verificar as ferramentas. Atualize para tentar novamente.',
  empty: 'Não há ferramentas do Harness configuradas.',
  chooseSession: 'Abra uma conversa no espaço de trabalho para iniciar uma ferramenta.',
  installed: 'Instalada',
  notDetected: 'Não detetada',
  start: 'Iniciar',
  resume: 'Retomar',
  install: 'Guia de instalação',
  startTool: 'Iniciar {tool}',
  resumeTool: 'Retomar uma sessão de {tool}',
  installTool: 'Guia de instalação de {tool}',
} satisfies Record<keyof typeof en, string>

/** Settings dictionaries passed to the locale registry. */
export const harnessToolsCopy = { zh, en, ja, es, fr, de, ru, pt }
