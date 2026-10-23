/** Locale-owned copy for configuring conversation image generation. @module */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Keys rendered by the image-generation form. */
export type ImageGenerationLocaleKey =
  | 'description' | 'enabled'
  | 'statusNeedsSetup' | 'statusDisabled'
  | 'endpoint' | 'endpointHint' | 'model' | 'modelHint' | 'apiKey' | 'apiKeyHint' | 'apiKeySet' | 'apiKeyUnset'
  | 'size' | 'sizeHint' | 'quality' | 'qualityHint'
  | 'aspectRatio' | 'aspectRatioHint' | 'ratioAuto' | 'ratioSquare' | 'ratioLandscape' | 'ratioPortrait'
  | 'ratioLandscapeFourThree' | 'ratioPortraitThreeFour' | 'ratioLandscapeThreeTwo' | 'ratioPortraitTwoThree' | 'ratioUltrawide'
  | 'overridden' | 'reset' | 'invalid' | 'unavailable' | 'readOnly' | 'saveFailed' | 'save' | 'saving'

/** English form copy. */
export const en: Record<ImageGenerationLocaleKey, string> = {
  description: 'Configure an Images API and enable image generation in conversations.',
  enabled: 'Enable image generation in conversations',
  statusNeedsSetup: 'Needs setup',
  statusDisabled: 'Disabled',
  endpoint: 'Images API endpoint',
  endpointHint: 'Complete HTTP(S) generation URL supplied by your provider.',
  model: 'Image model',
  modelHint: 'Use the image model or deployment id supplied by your provider.',
  apiKey: 'API Key',
  apiKeyHint: 'Saved on this Host. Leave blank to keep the saved key.',
  apiKeySet: 'Configured',
  apiKeyUnset: 'Not configured',
  size: 'Default image size',
  sizeHint: 'Optional size such as 1024x1024. A size requested in conversation takes precedence.',
  aspectRatio: 'Default image aspect ratio',
  aspectRatioHint: 'Used when you do not request a ratio in conversation. Unspecified lets the image provider choose.',
  ratioAuto: 'Unspecified',
  ratioSquare: 'Square (1:1)',
  ratioLandscape: 'Landscape (16:9)',
  ratioPortrait: 'Portrait (9:16)',
  ratioLandscapeFourThree: 'Landscape (4:3)',
  ratioPortraitThreeFour: 'Portrait (3:4)',
  ratioLandscapeThreeTwo: 'Landscape (3:2)',
  ratioPortraitTwoThree: 'Portrait (2:3)',
  ratioUltrawide: 'Ultrawide (21:9)',
  quality: 'Image quality',
  qualityHint: 'Optional value supported by your provider. Leave blank to omit this parameter.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  invalid: 'Enter a value supported by your image provider.',
  unavailable: 'Enable this plugin to configure image generation. If it is already enabled, check its components below.',
  readOnly: 'These settings cannot be edited from this connection.',
  saveFailed: 'Could not save. Check the endpoint, image model, and API key, then save again.',
  save: 'Save',
  saving: 'Saving…',
}

/** Simplified Chinese form copy. */
export const zh: Record<ImageGenerationLocaleKey, string> = {
  description: '配置 Images API，开启后即可在对话中生图',
  enabled: '启用对话生图',
  statusNeedsSetup: '待配置',
  statusDisabled: '已停用',
  endpoint: '生图接口地址',
  endpointHint: '填写服务商提供的完整 HTTP(S) 生图接口地址',
  model: '图片模型',
  modelHint: '填写服务商提供的图片模型名称或部署 ID',
  apiKey: 'API Key',
  apiKeyHint: '保存在当前主机，留空会保留已保存的密钥',
  apiKeySet: '已配置',
  apiKeyUnset: '未配置',
  size: '默认图片尺寸',
  sizeHint: '可选，如 1024x1024；对话中明确指定的尺寸优先',
  aspectRatio: '默认图片比例',
  aspectRatioHint: '对话未指定比例时使用；选“不指定”时由生图服务决定',
  ratioAuto: '不指定',
  ratioSquare: '方形（1:1）',
  ratioLandscape: '横图（16:9）',
  ratioPortrait: '竖图（9:16）',
  ratioLandscapeFourThree: '横图（4:3）',
  ratioPortraitThreeFour: '竖图（3:4）',
  ratioLandscapeThreeTwo: '横图（3:2）',
  ratioPortraitTwoThree: '竖图（2:3）',
  ratioUltrawide: '超宽横图（21:9）',
  quality: '图片质量',
  qualityHint: '可选，填写服务支持的值；留空则不指定质量',
  overridden: '已覆盖',
  reset: '恢复默认',
  invalid: '请填写生图服务支持的值',
  unavailable: '启用此插件后即可配置生图；已启用时请检查下方组件的状态',
  readOnly: '当前连接无法修改这些设置',
  saveFailed: '保存失败，请检查接口地址、图片模型和 API Key 后重试',
  save: '保存',
  saving: '保存中…',
}

/**
 * Resolve the shared form's labels from this dictionary.
 * @param t - image-generation locale reader.
 * @returns localized form chrome.
 */
export function formLabels(t: (key: ImageGenerationLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
