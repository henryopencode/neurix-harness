/** Locale-owned controls and recovery messages for live voice conversations. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Locale namespace used by the two voice entries. */
export const NS = 'voiceChat'

/** Chinese copy and typed key owner. */
export const zh = {
  open: '实时语音', close: '关闭实时语音', start: '开始对话', end: '结束对话',
  prepare: '下载并准备', cancelPrepare: '取消准备', retry: '重新准备',
  recognition: '语音识别', synthesis: '语音合成', ready: '已就绪', unprepared: '需要准备',
  downloading: '下载模型：{completed} / {total} GB', runtime: '准备运行环境…', loading: '加载语音模型…',
  python: '准备独立 Python…', dependencies: '安装语音依赖…',
  selected: '{model} · 模型约 {gb} GB', 'model.mlx-4bit': 'Breeze-TTS-2 · MLX 4-bit', 'model.mlx-8bit': 'Breeze-TTS-2 · MLX 8-bit',
  license: 'Breeze 模型及本地生成结果限研究和非商业用途',
  unsupported: '本地 Breeze 需要至少 12 GB 内存的 Apple Silicon Mac；其他平台暂未接入',
  connecting: '连接语音服务…', preparingRecognition: '准备识别模型…',
  'phase.idle': '说完后自动发送，回复会自动播报', 'phase.requesting': '请允许使用麦克风…',
  'phase.warming': '正在准备本地语音…',
  'phase.listening': '正在聆听', 'phase.recording': '正在听你说', 'phase.transcribing': '识别中…',
  'phase.thinking': '正在回复…', 'phase.speaking': '正在播报，可以开口打断',
  'error.permission': '请在浏览器和系统设置中允许麦克风访问，再开始对话',
  'error.device': '麦克风已中断，请检查输入设备后重新开始',
  'error.unsupported': '当前浏览器不支持实时录音，请使用支持 AudioWorklet 的浏览器',
  'error.playback': '无法播放语音，请检查音频设备后重新开始',
  'error.recognition': '语音识别失败，请检查识别服务后重新开始',
  'error.send': '无法确认文字是否已发送，请检查聊天记录；识别文字已保留',
  'error.synthesis': '语音播报失败，请重新开始；文字回复仍可在聊天中查看',
  'error.connection': '语音服务连接已断开，请恢复连接后重新开始',
  'error.download': '模型下载失败，请检查网络和磁盘空间后重试；已完成的文件会保留',
  'error.runtime': '语音环境准备失败，请重试；已完成的下载会保留',
  'error.assets': '无法准备语音运行文件，请检查磁盘空间和缓存目录权限后重试',
  'error.python': '独立 Python 安装失败，请检查网络、代理和磁盘空间后重试',
  'error.dependencies': '语音依赖安装失败，请检查网络和代理后重试',
  'error.model': '模型下载失败，请检查网络和磁盘空间后重试；已完成的文件会保留',
  'error.loading': '本地语音模型加载失败，请关闭占用内存较多的应用后重试准备',
  'error.tooLong': '回复过长，已停止语音播报，请在聊天中查看文字',
  insert: '插入草稿', transcript: '识别文字',
} as const

/** Keys accepted by the live voice translator. */
export type VoiceChatKey = keyof typeof zh

/** English fallback with the same keys. */
export const en: Record<VoiceChatKey, string> = {
  open: 'Voice chat', close: 'Close voice chat', start: 'Start conversation', end: 'End conversation',
  prepare: 'Download and prepare', cancelPrepare: 'Cancel preparation', retry: 'Prepare again',
  recognition: 'Speech recognition', synthesis: 'Speech synthesis', ready: 'Ready', unprepared: 'Setup required',
  downloading: 'Downloading model: {completed} / {total} GB', runtime: 'Preparing the runtime…', loading: 'Loading the voice model…',
  python: 'Preparing private Python…', dependencies: 'Installing speech dependencies…',
  selected: '{model} · About {gb} GB of model files', 'model.mlx-4bit': 'Breeze-TTS-2 · MLX 4-bit', 'model.mlx-8bit': 'Breeze-TTS-2 · MLX 8-bit',
  license: 'Breeze models and locally generated outputs are for research and non-commercial use',
  unsupported: 'Local Breeze requires an Apple Silicon Mac with at least 12 GB of memory. Other platforms are not connected yet.',
  connecting: 'Connecting to voice services…', preparingRecognition: 'Preparing recognition models…',
  'phase.idle': 'Speech is sent automatically, and replies are read aloud', 'phase.requesting': 'Allow microphone access to continue…',
  'phase.warming': 'Preparing local speech…',
  'phase.listening': 'Listening', 'phase.recording': 'Hearing you', 'phase.transcribing': 'Transcribing…',
  'phase.thinking': 'Preparing a reply…', 'phase.speaking': 'Speaking. Start talking to interrupt.',
  'error.permission': 'Allow microphone access in browser and system settings, then start again.',
  'error.device': 'The microphone disconnected. Check the input device, then start again.',
  'error.unsupported': 'This browser cannot capture live audio. Use a browser with AudioWorklet support.',
  'error.playback': 'Audio playback failed. Check the output device, then start again.',
  'error.recognition': 'Speech recognition failed. Check the recognition service, then start again.',
  'error.send': 'Message delivery could not be confirmed. Check the conversation; the transcript is preserved.',
  'error.synthesis': 'Voice playback failed. Start again; the written reply remains in the conversation.',
  'error.connection': 'The voice service disconnected. Restore the connection, then start again.',
  'error.download': 'Model download failed. Check the network and disk space, then retry. Completed files are retained.',
  'error.runtime': 'Voice setup failed. Retry preparation; completed downloads are retained.',
  'error.assets': 'Cannot prepare voice runtime files. Check disk space and cache directory permissions, then retry.',
  'error.python': 'Private Python installation failed. Check the network, proxy and disk space, then retry.',
  'error.dependencies': 'Speech dependency installation failed. Check the network and proxy, then retry.',
  'error.model': 'Model download failed. Check the network and disk space, then retry. Completed files are retained.',
  'error.loading': 'The local voice model could not load. Close applications using substantial memory, then prepare again.',
  'error.tooLong': 'This reply is too long for voice playback. Read the written response in the conversation.',
  insert: 'Insert into draft', transcript: 'Transcript',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { /** Local live voice controls. */ voiceChat: VoiceChatKey }
}
