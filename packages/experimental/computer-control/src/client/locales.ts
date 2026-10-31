/** Application-control settings. @module */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** en application settings copy. */
export const en = {
  'advancedSettings': 'Advanced settings',
  'desktopHint': 'Desktop actions activate the target window and use your mouse and keyboard. Stop generating cancels further input.',
  'requireInputApproval': 'Ask before each application action',
  'approvalHint': 'Applies immediately to every conversation. Window listing and observation remain automatic. Without an available approval channel, actions are blocked.',
  'description': 'Operate macOS applications in the foreground, including browser apps, using the system mouse and keyboard.',
  'showOverlay': 'Show agent cursor and key indicators',
  'screenshots': 'Include screenshots',
  'screenshotsHint': 'Start with screenshots off for text models. Enable them for a model that supports image input.',
  'operationTimeoutMs': 'Action timeout (ms)',
  'navigationTimeoutMs': 'Application launch timeout (ms)',
  'nativeTreeTimeoutMs': 'Native accessibility read budget (ms)',
  'nativeTreeTimeoutMsHint': '100–120000 ms; increase for large app interfaces. The action timeout still applies.',
  'timeoutHint': 'Positive whole milliseconds. Canceled input may already have changed the application; observe before continuing.',
  'newSessions': 'Approval changes apply immediately; start a new conversation for other settings.',
  'permissions': 'Grant Accessibility to the app that launches Harness. Screenshots and picture-in-picture also need Screen & System Audio Recording.',
  'overridden': 'Overridden',
  'reset': 'Reset to default',
  'invalid': 'Enter a supported value; timeouts must be positive whole milliseconds.',
  'unavailable': 'Enable this plugin to configure it. If it is already enabled, check its components below.',
  'readOnly': 'This connection cannot change these settings.',
  'saveFailed': 'Could not save. Check the values and try again.',
  'save': 'Save',
  'saving': 'Saving…',
}

/** Localized application settings. */
export type ComputerControlLocaleKey = keyof typeof en

/** zh application settings copy. */
export const zh: Record<ComputerControlLocaleKey, string> = {
  'advancedSettings': '高级设置',
  'desktopHint': '操作时会切到目标窗口并使用系统鼠标和键盘；点击停止生成可停止后续输入',
  'requireInputApproval': '每次应用操作前确认',
  'approvalHint': '立即应用于所有对话；列出窗口和读取状态仍自动执行。审批通道不可用时，操作会被阻止',
  'description': '仅支持 macOS；在前台使用系统鼠标和键盘操作应用，也支持 Chrome、Safari 等浏览器应用',
  'showOverlay': '显示 Agent 独立光标与按键提示',
  'screenshots': '附带截图',
  'screenshotsHint': '文本模型请先关闭截图；使用支持图像输入的模型时再开启',
  'operationTimeoutMs': '操作超时（毫秒）',
  'navigationTimeoutMs': '应用启动超时（毫秒）',
  'nativeTreeTimeoutMs': '原生应用控件读取预算（毫秒）',
  'nativeTreeTimeoutMsHint': '100–120000 毫秒；复杂应用可调高，整体仍受操作超时限制',
  'timeoutHint': '填写正整数毫秒；取消前可能已有输入生效，继续前请先观察应用状态',
  'newSessions': '审批修改立即生效；其他设置请在保存后新建对话使用',
  'permissions': '请为启动 Harness 的应用授予辅助功能权限；截图和画中画还需要屏幕与系统音频录制权限',
  'overridden': '已覆盖',
  'reset': '恢复默认',
  'invalid': '请填写支持的值；超时必须为正整数毫秒',
  'unavailable': '启用此插件后即可配置；已启用时请检查下方组件状态',
  'readOnly': '当前连接无法修改设置',
  'saveFailed': '保存失败，请检查设置后重试',
  'save': '保存',
  'saving': '保存中…',
}

/** ja application settings copy. */
export const ja: Record<ComputerControlLocaleKey, string> = {
  'advancedSettings': '詳細設定',
  'desktopHint': 'デスクトップ操作は対象ウィンドウを前面に出し、システムのマウスとキーボードを使用します。生成を停止すると以降の入力を中止します。',
  'requireInputApproval': 'アプリ操作ごとに確認',
  'approvalHint': 'すべての会話に即時適用します。ウィンドウ一覧と観察は自動です。承認手段がなければ操作を拒否します。',
  'description': 'macOS のアプリをシステムのマウスとキーボードで前面操作します。ブラウザーアプリも対象です。',
  'showOverlay': 'Agent のカーソルとキー表示',
  'screenshots': 'スクリーンショットを含める',
  'screenshotsHint': 'テキストモデルではオフで開始し、画像入力対応モデルで有効にしてください。',
  'operationTimeoutMs': '操作タイムアウト (ms)',
  'navigationTimeoutMs': 'アプリ起動タイムアウト（ms）',
  'nativeTreeTimeoutMs': 'ネイティブ要素の読み取り時間 (ms)',
  'nativeTreeTimeoutMsHint': '100–120000 ms。複雑なアプリでは増やせますが、全体の操作タイムアウトが優先されます。',
  'timeoutHint': '正の整数のミリ秒を指定します。中断前の入力は残る場合があるため、続行前に状態を確認してください。',
  'newSessions': '承認の変更は即時反映されます。その他の設定は保存後に新しい会話で使用してください。',
  'permissions': 'Harness を起動するアプリにアクセシビリティを許可してください。撮影とプレビューには画面収録とシステムオーディオの許可も必要です。',
  'overridden': '上書き済み',
  'reset': '既定値に戻す',
  'invalid': '対応する値を入力してください。タイムアウトは正の整数ミリ秒です。',
  'unavailable': '設定するには有効にしてください。有効なら下のコンポーネントを確認してください。',
  'readOnly': 'この接続から設定を変更できません。',
  'saveFailed': '保存できません。値を確認して再試行してください。',
  'save': '保存',
  'saving': '保存中…',
}

/** es application settings copy. */
export const es: Record<ComputerControlLocaleKey, string> = {
  'advancedSettings': 'Configuración avanzada',
  'desktopHint': 'Las acciones de escritorio activan la ventana de destino y usan el ratón y el teclado del sistema. Detener la generación cancela las entradas posteriores.',
  'requireInputApproval': 'Confirmar cada acción en aplicaciones',
  'approvalHint': 'Se aplica al instante a todas las conversaciones. Listar ventanas y observar sigue siendo automático. Sin canal de aprobación se bloquean las acciones.',
  'description': 'Opera aplicaciones de macOS en primer plano, incluidos navegadores, con el ratón y teclado del sistema.',
  'showOverlay': 'Mostrar cursor del agente e indicadores de teclas',
  'screenshots': 'Incluir capturas de pantalla',
  'screenshotsHint': 'Empieza sin capturas para modelos de texto. Actívalas para modelos con entrada de imágenes.',
  'operationTimeoutMs': 'Tiempo límite de operación (ms)',
  'navigationTimeoutMs': 'Tiempo límite de inicio de aplicaciones (ms)',
  'nativeTreeTimeoutMs': 'Tiempo de lectura de controles nativos (ms)',
  'nativeTreeTimeoutMsHint': '100–120000 ms; puede aumentarse para aplicaciones complejas, respetando el tiempo límite general.',
  'timeoutHint': 'Milisegundos enteros positivos. La entrada cancelada puede haber modificado la aplicación; observa antes de continuar.',
  'newSessions': 'Los cambios de aprobación se aplican de inmediato; inicie una conversación nueva para los demás ajustes.',
  'permissions': 'Concede Accesibilidad a la aplicación que inicia Harness. Las capturas y la vista previa también necesitan grabación de pantalla y audio del sistema.',
  'overridden': 'Sobrescrito',
  'reset': 'Restablecer valores predeterminados',
  'invalid': 'Introduce un valor admitido; los tiempos deben ser milisegundos enteros positivos.',
  'unavailable': 'Activa el complemento para configurarlo. Si ya está activo, revisa los componentes abajo.',
  'readOnly': 'Esta conexión no permite cambiar los ajustes.',
  'saveFailed': 'No se pudo guardar. Revisa los valores y reintenta.',
  'save': 'Guardar',
  'saving': 'Guardando…',
}

/** fr application settings copy. */
export const fr: Record<ComputerControlLocaleKey, string> = {
  'advancedSettings': 'Paramètres avancés',
  'desktopHint': 'Les actions de bureau activent la fenêtre cible et utilisent la souris et le clavier du système. Arrêter la génération annule les saisies suivantes.',
  'requireInputApproval': 'Confirmer chaque action dans une application',
  'approvalHint': 'S’applique immédiatement à toutes les conversations. Liste et observation restent automatiques. Sans canal d’approbation, les actions sont bloquées.',
  'description': 'Pilotez les applications macOS au premier plan, y compris les navigateurs, avec la souris et le clavier système.',
  'showOverlay': 'Afficher le curseur de l’agent et les touches',
  'screenshots': 'Inclure les captures d’écran',
  'screenshotsHint': 'Commencez sans captures pour les modèles textuels. Activez-les pour les modèles acceptant les images.',
  'operationTimeoutMs': 'Délai d’opération (ms)',
  'navigationTimeoutMs': 'Délai de lancement des applications (ms)',
  'nativeTreeTimeoutMs': 'Budget de lecture des contrôles natifs (ms)',
  'nativeTreeTimeoutMsHint': '100–120000 ms ; augmentez pour les applications complexes, dans la limite du délai global.',
  'timeoutHint': 'Millisecondes entières positives. Une saisie annulée peut avoir modifié l’application ; observez avant de continuer.',
  'newSessions': 'Les changements d’approbation sont immédiats ; démarrez une nouvelle conversation pour les autres paramètres.',
  'permissions': 'Autorisez l’accessibilité pour l’application qui lance Harness. Les captures et l’aperçu nécessitent aussi l’enregistrement de l’écran et de l’audio système.',
  'overridden': 'Remplacé',
  'reset': 'Rétablir les valeurs par défaut',
  'invalid': 'Saisissez une valeur acceptée ; les délais sont des millisecondes entières positives.',
  'unavailable': 'Activez ce module pour le configurer. S’il est actif, vérifiez les composants ci-dessous.',
  'readOnly': 'Cette connexion ne permet pas de modifier ces réglages.',
  'saveFailed': 'Enregistrement impossible. Vérifiez les valeurs et réessayez.',
  'save': 'Enregistrer',
  'saving': 'Enregistrement…',
}

/** de application settings copy. */
export const de: Record<ComputerControlLocaleKey, string> = {
  'advancedSettings': 'Erweiterte Einstellungen',
  'desktopHint': 'Desktopaktionen aktivieren das Zielfenster und verwenden Systemmaus und Tastatur. Das Stoppen der Generierung bricht weitere Eingaben ab.',
  'requireInputApproval': 'Jede App-Aktion bestätigen',
  'approvalHint': 'Gilt sofort für alle Chats. Fensterlisten und Beobachtung bleiben automatisch. Ohne Genehmigungskanal werden Aktionen blockiert.',
  'description': 'Bediene macOS-Apps im Vordergrund, auch Browser-Apps, mit Systemmaus und Tastatur.',
  'showOverlay': 'Agent-Zeiger und Tastenanzeigen einblenden',
  'screenshots': 'Screenshots einschließen',
  'screenshotsHint': 'Bei Textmodellen zunächst ausschalten. Für Modelle mit Bildeingabe einschalten.',
  'operationTimeoutMs': 'Zeitlimit für Aktionen (ms)',
  'navigationTimeoutMs': 'App-Startzeitlimit (ms)',
  'nativeTreeTimeoutMs': 'Zeitbudget für native Steuerelemente (ms)',
  'nativeTreeTimeoutMsHint': '100–120000 ms; für komplexe Apps erhöhen, begrenzt durch das gesamte Aktionszeitlimit.',
  'timeoutHint': 'Positive ganze Millisekunden. Abgebrochene Eingaben können die App geändert haben; vor dem Fortfahren prüfen.',
  'newSessions': 'Genehmigungsänderungen gelten sofort; beginnen Sie für andere Einstellungen einen neuen Chat.',
  'permissions': 'Erlaube Bedienungshilfen für die App, die Harness startet. Screenshots und Vorschau benötigen auch Bildschirm- und Systemaudioaufnahme.',
  'overridden': 'Überschrieben',
  'reset': 'Standard wiederherstellen',
  'invalid': 'Unterstützten Wert eingeben; Zeitlimits sind positive ganze Millisekunden.',
  'unavailable': 'Zum Konfigurieren aktivieren. Falls aktiv, unten die Komponenten prüfen.',
  'readOnly': 'Diese Verbindung erlaubt keine Änderung der Einstellungen.',
  'saveFailed': 'Speichern fehlgeschlagen. Werte prüfen und erneut versuchen.',
  'save': 'Speichern',
  'saving': 'Wird gespeichert…',
}

/** ru application settings copy. */
export const ru: Record<ComputerControlLocaleKey, string> = {
  'advancedSettings': 'Дополнительные настройки',
  'desktopHint': 'Действия с приложениями активируют целевое окно и используют системные мышь и клавиатуру. Остановка генерации отменяет последующий ввод.',
  'requireInputApproval': 'Подтверждать каждое действие в приложении',
  'approvalHint': 'Применяется сразу ко всем беседам. Список окон и наблюдение автоматические. Без канала одобрения действия блокируются.',
  'description': 'Управляйте приложениями macOS на переднем плане, включая браузеры, системной мышью и клавиатурой.',
  'showOverlay': 'Показывать курсор агента и нажатия клавиш',
  'screenshots': 'Включать снимки экрана',
  'screenshotsHint': 'Для текстовых моделей начните без снимков. Включите их для моделей с вводом изображений.',
  'operationTimeoutMs': 'Тайм-аут операции (мс)',
  'navigationTimeoutMs': 'Тайм-аут запуска приложения (мс)',
  'nativeTreeTimeoutMs': 'Время чтения нативных элементов (мс)',
  'nativeTreeTimeoutMsHint': '100–120000 мс; увеличьте для сложных приложений, в пределах общего тайм-аута.',
  'timeoutHint': 'Целые положительные миллисекунды. Отменённый ввод мог изменить приложение; проверьте состояние.',
  'newSessions': 'Изменения подтверждений действуют сразу; для других настроек начните новую беседу.',
  'permissions': 'Разрешите Универсальный доступ приложению, запускающему Harness. Снимкам и предпросмотру нужна запись экрана и системного аудио.',
  'overridden': 'Переопределено',
  'reset': 'Восстановить по умолчанию',
  'invalid': 'Введите поддерживаемое значение; тайм-ауты — положительные целые миллисекунды.',
  'unavailable': 'Включите плагин для настройки. Если он включён, проверьте компоненты ниже.',
  'readOnly': 'Это подключение не позволяет менять настройки.',
  'saveFailed': 'Не удалось сохранить. Проверьте значения и повторите попытку.',
  'save': 'Сохранить',
  'saving': 'Сохранение…',
}

/** pt application settings copy. */
export const pt: Record<ComputerControlLocaleKey, string> = {
  'advancedSettings': 'Configurações avançadas',
  'desktopHint': 'As ações de desktop ativam a janela de destino e usam o mouse e o teclado do sistema. Parar a geração cancela as próximas entradas.',
  'requireInputApproval': 'Confirmar cada ação no aplicativo',
  'approvalHint': 'Aplica-se imediatamente a todas as conversas. Listar janelas e observar continua automático. Sem canal de aprovação, as ações são bloqueadas.',
  'description': 'Controle aplicativos do macOS em primeiro plano, incluindo navegadores, com mouse e teclado do sistema.',
  'showOverlay': 'Mostrar cursor do agente e indicadores de teclas',
  'screenshots': 'Incluir capturas de ecrã',
  'screenshotsHint': 'Comece sem capturas para modelos de texto. Ative-as para modelos com entrada de imagens.',
  'operationTimeoutMs': 'Tempo limite de operação (ms)',
  'navigationTimeoutMs': 'Tempo limite de início do aplicativo (ms)',
  'nativeTreeTimeoutMs': 'Tempo de leitura de controlos nativos (ms)',
  'nativeTreeTimeoutMsHint': '100–120000 ms; aumente para aplicações complexas, respeitando o tempo limite geral.',
  'timeoutHint': 'Milissegundos inteiros positivos. A entrada cancelada pode ter alterado o aplicativo; observe antes de continuar.',
  'newSessions': 'As alterações de aprovação são imediatas; inicie uma nova conversa para as outras configurações.',
  'permissions': 'Conceda Acessibilidade ao aplicativo que inicia Harness. Capturas e pré-visualização exigem gravação da tela e áudio do sistema.',
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
 * @param t - localized application settings reader.
 * @returns localized form actions and availability.
 */
export function formLabels(t: (key: ComputerControlLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
