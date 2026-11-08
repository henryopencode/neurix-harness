/** Locale-owned canvas, task inspector, and accessibility copy. */
export const CANVAS_NS = 'workflowCanvas'

/** Chinese keys define the canvas namespace. */
export const zh = {
  'view.title': '工作流',
  'view.empty': '还没有任务计划',
  'view.emptyHint': '复杂任务生成计划后，会在这里显示步骤和执行进度',
  'view.history': '选择任务计划',
  'view.older': '加载更早的任务',
  'graph.plan': '任务计划',
  'graph.turn': '任务 {turn}',
  'graph.progress': '已完成 {done} / {total} 项',
  'canvas.label': '任务工作流画布',
  'canvas.canvas': '画布',
  'canvas.list': '列表',
  'canvas.mode': '工作流显示方式',
  'canvas.zoomIn': '放大',
  'canvas.zoomOut': '缩小',
  'canvas.fit': '适应画布',
  'canvas.current': '定位进行中',
  'canvas.phases': '任务阶段',
  'canvas.expandPhase': '展开 {phase}，{status}', 'canvas.phaseCount': '{phase} · {count}',
  'view.loadFailed': '较早任务加载失败',
  'task.untitled': '未命名任务', 'phase.empty': '未命名阶段', 'task.open': '查看 {name}，{status}',
  'task.missing': '此任务已不在当前加载的计划中',
  'task.details': '任务详情',
  'task.description': '工作内容与输入',
  'task.expectedOutput': '完成标准',
  'task.dependencies': '前置任务',
  'task.blocked': '等待原因',
  'task.result': '结果与验证',
  'task.artifacts': '产物',
  'task.session': '打开执行会话',
  'task.removed': '已移出计划',
  'task.recorded': '已有执行记录',
  'task.planned': '计划状态',
  'status.pending': '待开始',
  'status.waiting': '等待前置任务',
  'status.blocked': '受阻',
  'status.running': '进行中',
  'status.completed': '已完成',
  'status.failed': '失败',
  'status.cancelled': '已取消',
  'status.interrupted': '已中断',
  'status.removed': '已移出计划',
}

/** Typed canvas translation keys. */
export type CanvasKey = keyof typeof zh

/** English canvas copy. */
export const en: Record<CanvasKey, string> = {
  'view.title': 'Workflow', 'view.empty': 'No task plan yet',
  'view.emptyHint': 'Steps and execution progress appear here when a complex task has a plan',
  'view.history': 'Select task plan', 'view.older': 'Load earlier tasks',
  'graph.plan': 'Task plan', 'graph.turn': 'Task {turn}', 'graph.progress': '{done} / {total} completed',
  'canvas.label': 'Task workflow canvas', 'canvas.canvas': 'Canvas', 'canvas.list': 'List',
  'canvas.mode': 'Workflow display', 'canvas.zoomIn': 'Zoom in', 'canvas.zoomOut': 'Zoom out',
  'canvas.fit': 'Fit canvas', 'canvas.current': 'Locate running tasks', 'canvas.phases': 'Task phases',
  'canvas.expandPhase': 'Expand {phase}, {status}', 'canvas.phaseCount': '{phase} · {count}', 'view.loadFailed': 'Could not load earlier tasks', 'task.untitled': 'Unnamed task', 'phase.empty': 'Unnamed phase', 'task.open': 'Inspect {name}, {status}', 'task.missing': 'This task is outside the currently loaded plan',
  'task.details': 'Task details', 'task.description': 'Work and inputs', 'task.expectedOutput': 'Completion criteria',
  'task.dependencies': 'Prerequisites', 'task.blocked': 'Waiting for', 'task.result': 'Results and verification',
  'task.artifacts': 'Deliverables', 'task.session': 'Open execution session', 'task.removed': 'Removed from plan',
  'task.recorded': 'Execution recorded', 'task.planned': 'Planned status',
  'status.pending': 'Not started', 'status.waiting': 'Waiting for prerequisites', 'status.blocked': 'Blocked',
  'status.running': 'Running', 'status.completed': 'Completed', 'status.failed': 'Failed',
  'status.cancelled': 'Cancelled', 'status.interrupted': 'Interrupted', 'status.removed': 'Removed from plan',
}

/** Japanese canvas copy. */
export const ja: Record<CanvasKey, string> = {
  'view.title': 'ワークフロー', 'view.empty': 'タスク計画はまだありません',
  'view.emptyHint': '複雑なタスクの計画ができると、手順と進捗がここに表示されます',
  'view.history': 'タスク計画を選択', 'view.older': '以前のタスクを読み込む',
  'graph.plan': 'タスク計画', 'graph.turn': 'タスク {turn}', 'graph.progress': '{done} / {total} 件完了',
  'canvas.label': 'タスクのワークフロー図', 'canvas.canvas': 'キャンバス', 'canvas.list': '一覧',
  'canvas.mode': 'ワークフロー表示', 'canvas.zoomIn': '拡大', 'canvas.zoomOut': '縮小',
  'canvas.fit': '全体を表示', 'canvas.current': '実行中のタスクへ', 'canvas.phases': 'タスクの段階',
  'canvas.expandPhase': '{phase}を展開、{status}', 'canvas.phaseCount': '{phase} · {count}', 'view.loadFailed': '以前のタスクを読み込めませんでした', 'task.untitled': '名前のないタスク', 'phase.empty': '名前のないフェーズ', 'task.open': '{name}を表示、{status}', 'task.missing': 'このタスクは読み込まれた計画にありません',
  'task.details': 'タスク詳細', 'task.description': '作業と入力', 'task.expectedOutput': '完了条件',
  'task.dependencies': '前提タスク', 'task.blocked': '待機理由', 'task.result': '結果と検証',
  'task.artifacts': '成果物', 'task.session': '実行セッションを開く', 'task.removed': '計画から削除済み',
  'task.recorded': '実行記録あり', 'task.planned': '計画の状態',
  'status.pending': '未着手', 'status.waiting': '前提タスクを待機', 'status.blocked': 'ブロック中',
  'status.running': '実行中', 'status.completed': '完了', 'status.failed': '失敗',
  'status.cancelled': 'キャンセル済み', 'status.interrupted': '中断', 'status.removed': '計画から削除済み',
}

/** Spanish canvas copy. */
export const es: Record<CanvasKey, string> = {
  'view.title': 'Flujo de trabajo', 'view.empty': 'Aún no hay un plan',
  'view.emptyHint': 'Los pasos y el progreso aparecen aquí cuando una tarea compleja tiene un plan',
  'view.history': 'Seleccionar plan', 'view.older': 'Cargar tareas anteriores',
  'graph.plan': 'Plan de tareas', 'graph.turn': 'Tarea {turn}', 'graph.progress': '{done} / {total} completadas',
  'canvas.label': 'Diagrama del flujo de tareas', 'canvas.canvas': 'Diagrama', 'canvas.list': 'Lista',
  'canvas.mode': 'Vista del flujo', 'canvas.zoomIn': 'Acercar', 'canvas.zoomOut': 'Alejar',
  'canvas.fit': 'Ajustar diagrama', 'canvas.current': 'Localizar tareas activas', 'canvas.phases': 'Fases',
  'canvas.expandPhase': 'Expandir {phase}, {status}', 'canvas.phaseCount': '{phase} · {count}', 'view.loadFailed': 'No se pudieron cargar las tareas anteriores', 'task.untitled': 'Tarea sin nombre', 'phase.empty': 'Fase sin nombre', 'task.open': 'Ver {name}, {status}', 'task.missing': 'La tarea no está en el plan cargado',
  'task.details': 'Detalles de la tarea', 'task.description': 'Trabajo y entradas', 'task.expectedOutput': 'Criterios de finalización',
  'task.dependencies': 'Requisitos previos', 'task.blocked': 'Motivo de espera', 'task.result': 'Resultados y verificación',
  'task.artifacts': 'Entregables', 'task.session': 'Abrir sesión de ejecución', 'task.removed': 'Retirada del plan',
  'task.recorded': 'Ejecución registrada', 'task.planned': 'Estado planificado',
  'status.pending': 'Sin iniciar', 'status.waiting': 'Esperando requisitos', 'status.blocked': 'Bloqueada',
  'status.running': 'En curso', 'status.completed': 'Completada', 'status.failed': 'Fallida',
  'status.cancelled': 'Cancelada', 'status.interrupted': 'Interrumpida', 'status.removed': 'Retirada del plan',
}

/** French canvas copy. */
export const fr: Record<CanvasKey, string> = {
  'view.title': 'Flux de travail', 'view.empty': 'Aucun plan pour le moment',
  'view.emptyHint': 'Les étapes et la progression apparaissent ici quand une tâche complexe dispose d’un plan',
  'view.history': 'Choisir un plan', 'view.older': 'Charger les tâches précédentes',
  'graph.plan': 'Plan des tâches', 'graph.turn': 'Tâche {turn}', 'graph.progress': '{done} / {total} terminées',
  'canvas.label': 'Diagramme du flux des tâches', 'canvas.canvas': 'Diagramme', 'canvas.list': 'Liste',
  'canvas.mode': 'Affichage du flux', 'canvas.zoomIn': 'Agrandir', 'canvas.zoomOut': 'Réduire',
  'canvas.fit': 'Ajuster le diagramme', 'canvas.current': 'Localiser les tâches actives', 'canvas.phases': 'Phases',
  'canvas.expandPhase': 'Développer {phase}, {status}', 'canvas.phaseCount': '{phase} · {count}', 'view.loadFailed': 'Impossible de charger les tâches précédentes', 'task.untitled': 'Tâche sans nom', 'phase.empty': 'Phase sans nom', 'task.open': 'Voir {name}, {status}', 'task.missing': 'Cette tâche ne figure pas dans le plan chargé',
  'task.details': 'Détails de la tâche', 'task.description': 'Travail et entrées', 'task.expectedOutput': 'Critères de fin',
  'task.dependencies': 'Prérequis', 'task.blocked': 'Motif d’attente', 'task.result': 'Résultats et vérification',
  'task.artifacts': 'Livrables', 'task.session': 'Ouvrir la session d’exécution', 'task.removed': 'Retirée du plan',
  'task.recorded': 'Exécution enregistrée', 'task.planned': 'État prévu',
  'status.pending': 'Non démarrée', 'status.waiting': 'En attente des prérequis', 'status.blocked': 'Bloquée',
  'status.running': 'En cours', 'status.completed': 'Terminée', 'status.failed': 'Échec',
  'status.cancelled': 'Annulée', 'status.interrupted': 'Interrompue', 'status.removed': 'Retirée du plan',
}

/** German canvas copy. */
export const de: Record<CanvasKey, string> = {
  'view.title': 'Arbeitsablauf', 'view.empty': 'Noch kein Aufgabenplan',
  'view.emptyHint': 'Schritte und Fortschritt erscheinen hier, sobald eine komplexe Aufgabe einen Plan hat',
  'view.history': 'Aufgabenplan wählen', 'view.older': 'Frühere Aufgaben laden',
  'graph.plan': 'Aufgabenplan', 'graph.turn': 'Aufgabe {turn}', 'graph.progress': '{done} / {total} abgeschlossen',
  'canvas.label': 'Diagramm des Arbeitsablaufs', 'canvas.canvas': 'Diagramm', 'canvas.list': 'Liste',
  'canvas.mode': 'Ablaufansicht', 'canvas.zoomIn': 'Vergrößern', 'canvas.zoomOut': 'Verkleinern',
  'canvas.fit': 'Diagramm einpassen', 'canvas.current': 'Laufende Aufgaben finden', 'canvas.phases': 'Phasen',
  'canvas.expandPhase': '{phase} aufklappen, {status}', 'canvas.phaseCount': '{phase} · {count}', 'view.loadFailed': 'Frühere Aufgaben konnten nicht geladen werden', 'task.untitled': 'Unbenannte Aufgabe', 'phase.empty': 'Unbenannte Phase', 'task.open': '{name} ansehen, {status}', 'task.missing': 'Diese Aufgabe ist nicht im geladenen Plan',
  'task.details': 'Aufgabendetails', 'task.description': 'Arbeit und Eingaben', 'task.expectedOutput': 'Abschlusskriterien',
  'task.dependencies': 'Voraussetzungen', 'task.blocked': 'Wartegrund', 'task.result': 'Ergebnisse und Prüfung',
  'task.artifacts': 'Ergebnisse', 'task.session': 'Ausführungssitzung öffnen', 'task.removed': 'Aus Plan entfernt',
  'task.recorded': 'Ausführung aufgezeichnet', 'task.planned': 'Geplanter Status',
  'status.pending': 'Nicht begonnen', 'status.waiting': 'Wartet auf Voraussetzungen', 'status.blocked': 'Blockiert',
  'status.running': 'Läuft', 'status.completed': 'Abgeschlossen', 'status.failed': 'Fehlgeschlagen',
  'status.cancelled': 'Abgebrochen', 'status.interrupted': 'Unterbrochen', 'status.removed': 'Aus Plan entfernt',
}

/** Russian canvas copy. */
export const ru: Record<CanvasKey, string> = {
  'view.title': 'Рабочий процесс', 'view.empty': 'Плана задач пока нет',
  'view.emptyHint': 'Этапы и ход выполнения появятся здесь, когда у сложной задачи будет план',
  'view.history': 'Выбрать план', 'view.older': 'Загрузить предыдущие задачи',
  'graph.plan': 'План задач', 'graph.turn': 'Задача {turn}', 'graph.progress': 'Завершено {done} / {total}',
  'canvas.label': 'Схема рабочего процесса', 'canvas.canvas': 'Схема', 'canvas.list': 'Список',
  'canvas.mode': 'Вид рабочего процесса', 'canvas.zoomIn': 'Приблизить', 'canvas.zoomOut': 'Отдалить',
  'canvas.fit': 'Вместить схему', 'canvas.current': 'Найти активные задачи', 'canvas.phases': 'Этапы',
  'canvas.expandPhase': 'Развернуть {phase}, {status}', 'canvas.phaseCount': '{phase} · {count}', 'view.loadFailed': 'Не удалось загрузить предыдущие задачи', 'task.untitled': 'Задача без названия', 'phase.empty': 'Этап без названия', 'task.open': 'Открыть {name}, {status}', 'task.missing': 'Этой задачи нет в загруженном плане',
  'task.details': 'Сведения о задаче', 'task.description': 'Работа и входные данные', 'task.expectedOutput': 'Критерии завершения',
  'task.dependencies': 'Предшествующие задачи', 'task.blocked': 'Причина ожидания', 'task.result': 'Результаты и проверка',
  'task.artifacts': 'Материалы', 'task.session': 'Открыть сеанс выполнения', 'task.removed': 'Удалена из плана',
  'task.recorded': 'Выполнение записано', 'task.planned': 'Состояние по плану',
  'status.pending': 'Не начата', 'status.waiting': 'Ожидание предыдущих задач', 'status.blocked': 'Заблокирована',
  'status.running': 'Выполняется', 'status.completed': 'Завершена', 'status.failed': 'Ошибка',
  'status.cancelled': 'Отменена', 'status.interrupted': 'Прервана', 'status.removed': 'Удалена из плана',
}

/** Portuguese canvas copy. */
export const pt: Record<CanvasKey, string> = {
  'view.title': 'Fluxo de trabalho', 'view.empty': 'Ainda não há plano de tarefas',
  'view.emptyHint': 'Os passos e o progresso aparecem aqui quando uma tarefa complexa tem um plano',
  'view.history': 'Selecionar plano', 'view.older': 'Carregar tarefas anteriores',
  'graph.plan': 'Plano de tarefas', 'graph.turn': 'Tarefa {turn}', 'graph.progress': '{done} / {total} concluídas',
  'canvas.label': 'Diagrama do fluxo de tarefas', 'canvas.canvas': 'Diagrama', 'canvas.list': 'Lista',
  'canvas.mode': 'Visualização do fluxo', 'canvas.zoomIn': 'Ampliar', 'canvas.zoomOut': 'Reduzir',
  'canvas.fit': 'Ajustar diagrama', 'canvas.current': 'Localizar tarefas ativas', 'canvas.phases': 'Fases',
  'canvas.expandPhase': 'Expandir {phase}, {status}', 'canvas.phaseCount': '{phase} · {count}', 'view.loadFailed': 'Não foi possível carregar as tarefas anteriores', 'task.untitled': 'Tarefa sem nome', 'phase.empty': 'Fase sem nome', 'task.open': 'Ver {name}, {status}', 'task.missing': 'Esta tarefa não está no plano carregado',
  'task.details': 'Detalhes da tarefa', 'task.description': 'Trabalho e entradas', 'task.expectedOutput': 'Critérios de conclusão',
  'task.dependencies': 'Pré-requisitos', 'task.blocked': 'Motivo da espera', 'task.result': 'Resultados e verificação',
  'task.artifacts': 'Entregáveis', 'task.session': 'Abrir sessão de execução', 'task.removed': 'Removida do plano',
  'task.recorded': 'Execução registrada', 'task.planned': 'Estado planejado',
  'status.pending': 'Não iniciada', 'status.waiting': 'Aguardando pré-requisitos', 'status.blocked': 'Bloqueada',
  'status.running': 'Em andamento', 'status.completed': 'Concluída', 'status.failed': 'Falhou',
  'status.cancelled': 'Cancelada', 'status.interrupted': 'Interrompida', 'status.removed': 'Removida do plano',
}
