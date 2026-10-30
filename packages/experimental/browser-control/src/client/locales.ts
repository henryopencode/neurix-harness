/** Browser-only settings. @module */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** en copy for this control plugin. */
export const en = {
  'description': 'Operate an independent hidden browser on Windows, macOS, and Linux. Watch it in picture-in-picture.',
  'requireInputApproval': 'Ask before each browser action',
  'approvalHint': 'Applies immediately to every conversation. Window listing and observation remain automatic. Without an available approval channel, actions are blocked.',
  'browserChannel': 'Browser',
  'browserHint': 'Install the selected browser on this computer.',
  'chrome': 'Google Chrome',
  'chromium': 'Chromium',
  'msedge': 'Microsoft Edge',
  'screenshots': 'Include screenshots',
  'screenshotsHint': 'Start with screenshots off for text models. Enable them for a model that supports image input.',
  'advancedSettings': 'Advanced settings',
  'operationTimeoutMs': 'Action timeout (ms)',
  'navigationTimeoutMs': 'Startup and navigation timeout (ms)',
  'timeoutHint': 'Positive whole milliseconds. Interrupted input closes the owned browser; slow pages and failed screenshots keep it open.',
  'newSessions': 'Approval changes apply immediately; start a new conversation for other settings.',
  'overridden': 'Overridden',
  'reset': 'Reset to default',
  'invalid': 'Enter a supported value; timeouts must be positive whole milliseconds.',
  'unavailable': 'Enable this plugin to configure it. If it is already enabled, check its components below.',
  'readOnly': 'This connection cannot change these settings.',
  'saveFailed': 'Could not save. Check the values and try again.',
  'save': 'Save',
  'saving': 'Saving…',
}

/** Locale-owned settings and accessibility keys. */
export type BrowserControlLocaleKey = keyof typeof en

/** zh copy for this control plugin. */
export const zh: Record<BrowserControlLocaleKey, string> = {
  'description': '在 Windows、macOS 和 Linux 上操作独立的隐藏浏览器，通过画中画查看页面',
  'requireInputApproval': '每次浏览器操作前确认',
  'approvalHint': '立即应用于所有对话；列出窗口和读取状态仍自动执行。审批通道不可用时，操作会被阻止',
  'browserChannel': '浏览器',
  'browserHint': '请先在这台电脑上安装所选浏览器',
  'chrome': 'Google Chrome',
  'chromium': 'Chromium',
  'msedge': 'Microsoft Edge',
  'screenshots': '附带截图',
  'screenshotsHint': '文本模型请先关闭截图；使用支持图像输入的模型时再开启',
  'advancedSettings': '高级设置',
  'operationTimeoutMs': '操作超时（毫秒）',
  'navigationTimeoutMs': '启动与导航超时（毫秒）',
  'timeoutHint': '填写正整数毫秒；输入操作中断时关闭独立浏览器，网页加载慢或截图失败时保留窗口',
  'newSessions': '审批修改立即生效；其他设置请在保存后新建对话使用',
  'overridden': '已覆盖',
  'reset': '恢复默认',
  'invalid': '请填写支持的值；超时必须为正整数毫秒',
  'unavailable': '启用此插件后即可配置；已启用时请检查下方组件状态',
  'readOnly': '当前连接无法修改设置',
  'saveFailed': '保存失败，请检查设置后重试',
  'save': '保存',
  'saving': '保存中…',
}

/** ja copy for this control plugin. */
export const ja: Record<BrowserControlLocaleKey, string> = {
  'description': 'Windows、macOS、Linux の独立した非表示ブラウザーを操作し、プレビューで確認できます。',
  'requireInputApproval': 'ブラウザー操作ごとに確認',
  'approvalHint': 'すべての会話に即時適用します。ウィンドウ一覧と観察は自動です。承認手段がなければ操作を拒否します。',
  'browserChannel': 'ブラウザー',
  'browserHint': '選んだブラウザーをこのコンピューターにインストールしてください。',
  'chrome': 'Google Chrome',
  'chromium': 'Chromium',
  'msedge': 'Microsoft Edge',
  'screenshots': 'スクリーンショットを含める',
  'screenshotsHint': 'テキストモデルではオフで開始し、画像入力対応モデルで有効にしてください。',
  'advancedSettings': '詳細設定',
  'operationTimeoutMs': '操作タイムアウト (ms)',
  'navigationTimeoutMs': '起動と移動のタイムアウト (ms)',
  'timeoutHint': '正の整数ミリ秒。入力の中断時は専用ブラウザーを閉じます。読み込み遅延や撮影失敗時は保持します。',
  'newSessions': '承認の変更は即時反映されます。その他の設定は保存後に新しい会話で使用してください。',
  'overridden': '上書き済み',
  'reset': '既定値に戻す',
  'invalid': '対応する値を入力してください。タイムアウトは正の整数ミリ秒です。',
  'unavailable': '設定するには有効にしてください。有効なら下のコンポーネントを確認してください。',
  'readOnly': 'この接続から設定を変更できません。',
  'saveFailed': '保存できません。値を確認して再試行してください。',
  'save': '保存',
  'saving': '保存中…',
}

/** es copy for this control plugin. */
export const es: Record<BrowserControlLocaleKey, string> = {
  'description': 'Opera un navegador independiente y oculto en Windows, macOS y Linux. Síguelo en la vista previa.',
  'requireInputApproval': 'Confirmar cada acción del navegador',
  'approvalHint': 'Se aplica al instante a todas las conversaciones. Listar ventanas y observar sigue siendo automático. Sin canal de aprobación se bloquean las acciones.',
  'browserChannel': 'Navegador',
  'browserHint': 'Instala el navegador seleccionado en este ordenador.',
  'chrome': 'Google Chrome',
  'chromium': 'Chromium',
  'msedge': 'Microsoft Edge',
  'screenshots': 'Incluir capturas de pantalla',
  'screenshotsHint': 'Empieza sin capturas para modelos de texto. Actívalas para modelos con entrada de imágenes.',
  'advancedSettings': 'Configuración avanzada',
  'operationTimeoutMs': 'Tiempo límite de operación (ms)',
  'navigationTimeoutMs': 'Tiempo límite de inicio y navegación (ms)',
  'timeoutHint': 'Milisegundos enteros positivos. Una entrada interrumpida cierra el navegador propio; una carga lenta o captura fallida conserva las ventanas.',
  'newSessions': 'Los cambios de aprobación se aplican de inmediato; inicie una conversación nueva para los demás ajustes.',
  'overridden': 'Sobrescrito',
  'reset': 'Restablecer valores predeterminados',
  'invalid': 'Introduce un valor admitido; los tiempos deben ser milisegundos enteros positivos.',
  'unavailable': 'Activa el complemento para configurarlo. Si ya está activo, revisa los componentes abajo.',
  'readOnly': 'Esta conexión no permite cambiar los ajustes.',
  'saveFailed': 'No se pudo guardar. Revisa los valores y reintenta.',
  'save': 'Guardar',
  'saving': 'Guardando…',
}

/** fr copy for this control plugin. */
export const fr: Record<BrowserControlLocaleKey, string> = {
  'description': 'Pilotez un navigateur indépendant et masqué sur Windows, macOS et Linux, visible en aperçu.',
  'requireInputApproval': 'Confirmer chaque action du navigateur',
  'approvalHint': 'S’applique immédiatement à toutes les conversations. Liste et observation restent automatiques. Sans canal d’approbation, les actions sont bloquées.',
  'browserChannel': 'Navigateur',
  'browserHint': 'Installez le navigateur sélectionné sur cet ordinateur.',
  'chrome': 'Google Chrome',
  'chromium': 'Chromium',
  'msedge': 'Microsoft Edge',
  'screenshots': 'Inclure les captures d’écran',
  'screenshotsHint': 'Commencez sans captures pour les modèles textuels. Activez-les pour les modèles acceptant les images.',
  'advancedSettings': 'Paramètres avancés',
  'operationTimeoutMs': 'Délai d’opération (ms)',
  'navigationTimeoutMs': 'Délai de démarrage et navigation (ms)',
  'timeoutHint': 'Millisecondes entières positives. Une saisie interrompue ferme le navigateur dédié ; une page lente ou une capture échouée conserve ses fenêtres.',
  'newSessions': 'Les changements d’approbation sont immédiats ; démarrez une nouvelle conversation pour les autres paramètres.',
  'overridden': 'Remplacé',
  'reset': 'Rétablir les valeurs par défaut',
  'invalid': 'Saisissez une valeur acceptée ; les délais sont des millisecondes entières positives.',
  'unavailable': 'Activez ce module pour le configurer. S’il est actif, vérifiez les composants ci-dessous.',
  'readOnly': 'Cette connexion ne permet pas de modifier ces réglages.',
  'saveFailed': 'Enregistrement impossible. Vérifiez les valeurs et réessayez.',
  'save': 'Enregistrer',
  'saving': 'Enregistrement…',
}

/** de copy for this control plugin. */
export const de: Record<BrowserControlLocaleKey, string> = {
  'description': 'Steuere einen eigenen unsichtbaren Browser unter Windows, macOS und Linux mit Bild-in-Bild-Vorschau.',
  'requireInputApproval': 'Jede Browseraktion bestätigen',
  'approvalHint': 'Gilt sofort für alle Chats. Fensterlisten und Beobachtung bleiben automatisch. Ohne Genehmigungskanal werden Aktionen blockiert.',
  'browserChannel': 'Browser',
  'browserHint': 'Installieren Sie den gewählten Browser auf diesem Computer.',
  'chrome': 'Google Chrome',
  'chromium': 'Chromium',
  'msedge': 'Microsoft Edge',
  'screenshots': 'Screenshots einschließen',
  'screenshotsHint': 'Bei Textmodellen zunächst ausschalten. Für Modelle mit Bildeingabe einschalten.',
  'advancedSettings': 'Erweiterte Einstellungen',
  'operationTimeoutMs': 'Zeitlimit für Aktionen (ms)',
  'navigationTimeoutMs': 'Zeitlimit für Start und Navigation (ms)',
  'timeoutHint': 'Positive ganze Millisekunden. Unterbrochene Eingabe schließt den eigenen Browser; langsame Seiten oder fehlgeschlagene Screenshots behalten Fenster bei.',
  'newSessions': 'Genehmigungsänderungen gelten sofort; beginnen Sie für andere Einstellungen einen neuen Chat.',
  'overridden': 'Überschrieben',
  'reset': 'Standard wiederherstellen',
  'invalid': 'Unterstützten Wert eingeben; Zeitlimits sind positive ganze Millisekunden.',
  'unavailable': 'Zum Konfigurieren aktivieren. Falls aktiv, unten die Komponenten prüfen.',
  'readOnly': 'Diese Verbindung erlaubt keine Änderung der Einstellungen.',
  'saveFailed': 'Speichern fehlgeschlagen. Werte prüfen und erneut versuchen.',
  'save': 'Speichern',
  'saving': 'Wird gespeichert…',
}

/** ru copy for this control plugin. */
export const ru: Record<BrowserControlLocaleKey, string> = {
  'description': 'Управляйте отдельным скрытым браузером в Windows, macOS и Linux с просмотром в мини-окне.',
  'requireInputApproval': 'Подтверждать каждое действие в браузере',
  'approvalHint': 'Применяется сразу ко всем беседам. Список окон и наблюдение автоматические. Без канала одобрения действия блокируются.',
  'browserChannel': 'Браузер',
  'browserHint': 'Установите выбранный браузер на этот компьютер.',
  'chrome': 'Google Chrome',
  'chromium': 'Chromium',
  'msedge': 'Microsoft Edge',
  'screenshots': 'Включать снимки экрана',
  'screenshotsHint': 'Для текстовых моделей начните без снимков. Включите их для моделей с вводом изображений.',
  'advancedSettings': 'Дополнительные настройки',
  'operationTimeoutMs': 'Тайм-аут операции (мс)',
  'navigationTimeoutMs': 'Тайм-аут запуска и переходов (мс)',
  'timeoutHint': 'Положительные целые миллисекунды. Прерванный ввод закрывает отдельный браузер; медленная загрузка или ошибка снимка сохраняет окна.',
  'newSessions': 'Изменения подтверждений действуют сразу; для других настроек начните новую беседу.',
  'overridden': 'Переопределено',
  'reset': 'Восстановить по умолчанию',
  'invalid': 'Введите поддерживаемое значение; тайм-ауты — положительные целые миллисекунды.',
  'unavailable': 'Включите плагин для настройки. Если он включён, проверьте компоненты ниже.',
  'readOnly': 'Это подключение не позволяет менять настройки.',
  'saveFailed': 'Не удалось сохранить. Проверьте значения и повторите попытку.',
  'save': 'Сохранить',
  'saving': 'Сохранение…',
}

/** pt copy for this control plugin. */
export const pt: Record<BrowserControlLocaleKey, string> = {
  'description': 'Controle um navegador independente e oculto no Windows, macOS e Linux com pré-visualização.',
  'requireInputApproval': 'Confirmar cada ação no navegador',
  'approvalHint': 'Aplica-se imediatamente a todas as conversas. Listar janelas e observar continua automático. Sem canal de aprovação, as ações são bloqueadas.',
  'browserChannel': 'Navegador',
  'browserHint': 'Instale o navegador selecionado neste computador.',
  'chrome': 'Google Chrome',
  'chromium': 'Chromium',
  'msedge': 'Microsoft Edge',
  'screenshots': 'Incluir capturas de ecrã',
  'screenshotsHint': 'Comece sem capturas para modelos de texto. Ative-as para modelos com entrada de imagens.',
  'advancedSettings': 'Configurações avançadas',
  'operationTimeoutMs': 'Tempo limite de operação (ms)',
  'navigationTimeoutMs': 'Tempo limite de arranque e navegação (ms)',
  'timeoutHint': 'Milissegundos inteiros positivos. Entrada interrompida fecha o navegador próprio; carregamento lento ou captura falhada conserva as janelas.',
  'newSessions': 'As alterações de aprovação são imediatas; inicie uma nova conversa para as outras configurações.',
  'overridden': 'Substituído',
  'reset': 'Repor predefinições',
  'invalid': 'Introduza um valor suportado; os tempos devem ser milissegundos inteiros positivos.',
  'unavailable': 'Ative o plugin para configurar. Se já estiver ativo, verifique os componentes abaixo.',
  'readOnly': 'Esta ligação não permite alterar as definições.',
  'saveFailed': 'Não foi possível guardar. Verifique os valores e tente novamente.',
  'save': 'Guardar',
  'saving': 'A guardar…',
}

/**
 * Resolve the shared form's action labels.
 * @param t - localized settings reader.
 * @returns localized form actions and availability.
 */
export function formLabels(t: (key: BrowserControlLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
