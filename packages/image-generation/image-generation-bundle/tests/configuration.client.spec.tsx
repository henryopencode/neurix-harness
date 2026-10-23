// @vitest-environment jsdom
/** Staged configuration, write-only credentials, refusals, and lifecycle of the image-generation form. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector, makeTranslate, stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type {} from '../src/client/index.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsDescribeFace, SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { ImageGenerationCard, type ImageGenerationCardProps } from '../src/client/ImageGenerationCard.tsx'
import { ImageGenerationCardController, IMAGE_GENERATION_ENTRY, type ImageGenerationSettings } from '../src/client/image-generation-controller.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

function bench(configured = false) {
  const host = stubConfigForm<ImageGenerationSettings>()
  host.publish({ status: 'ready', writable: true, revision: 3,
    value: { enabled: false, endpoint: 'https://images.test/v1/images/generations', model: '' }, user: {} })
  const mirror = createSnapshotStore<SettingsMirrorSnapshot>({ status: 'ready', error: null, view: {
    writable: true, hasDocument: true,
    namespaces: [{ ns: IMAGE_GENERATION_ENTRY, schema: {}, autoGenerate: true, revision: 3, applies: 'live', value: {},
      secrets: [{ path: ['apiKey'], set: configured }] }],
  } })
  const describe: SettingsDescribeFace = { ...mirror, ensure: () => Promise.resolve(), acceptView: () => {} }
  const controller = new ImageGenerationCardController(host.scope, describe)
  const face = controller.inject()
  const { hooks, ...actions } = face
  const props = { ...actions, view: 'page', t: makeTranslate(en, commonEn),
    useImageGeneration: bindSnapshotSelector(hooks.imageGeneration) } as ImageGenerationCardProps
  return { host, mirror, controller, face, props }
}

describe('image-generation configuration', () => {
  it('hydrates saved MiniMax settings with generation enabled and the key hidden', () => {
    const { host, props, controller } = bench(true)
    host.publish({ value: { provider: 'minimax', enabled: true,
      endpoint: 'https://api.minimax.cn/v1/image_generation', model: 'image-01', size: '1024x1024' } })
    render(<ImageGenerationCard {...props} />)
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByText(/MiniMax/u)).toBeNull()
    expect(screen.getByLabelText(en.enabled)).toHaveProperty('checked', true)
    expect(screen.getByLabelText(en.apiKey)).toHaveProperty('value', '')
    expect(screen.getByRole('combobox', { name: en.aspectRatio })).toHaveProperty('value', '1:1')
    expect(screen.queryByLabelText(en.quality)).toBeNull()
    controller.dispose()
  })

  it.each([
    ['1536x1024', '3:2'], ['1024x1536', '2:3'], ['1024x1008', '1024x1008'], ['16:9', '16:9'], ['', ''],
  ])('displays saved size %s as %s without changing the saved configuration', (size, value) => {
    const { host, props, face, controller } = bench(true)
    host.publish({ value: { provider: 'minimax', enabled: false, size } })
    render(<ImageGenerationCard {...props} />)
    expect(screen.getByRole('combobox', { name: en.aspectRatio })).toHaveProperty('value', value)
    expect(face.hooks.imageGeneration.getSnapshot().dirty).toBe(false)
    controller.dispose()
  })

  it('saves a selected ratio and lets the user clear it without replacing the saved key', async () => {
    const { host, props, face, controller } = bench(true)
    host.publish({ value: { provider: 'minimax', enabled: false, size: '1024x1024' } })
    render(<ImageGenerationCard {...props} t={makeTranslate(zh, commonZh)} />)
    const select = screen.getByRole('combobox', { name: zh.aspectRatio })
    expect(screen.getAllByRole('option')).toHaveLength(9)
    fireEvent.change(select, { target: { value: '9:16' } })
    fireEvent.click(screen.getByRole('button', { name: zh.save }))
    await vi.waitFor(() => { expect(host.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['size'], value: '9:16' }], 3) })
    await vi.waitFor(() => { expect(face.hooks.imageGeneration.getSnapshot().saving).toBe(false) })
    fireEvent.change(select, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: zh.save }))
    await vi.waitFor(() => { expect(host.mutate).toHaveBeenLastCalledWith([{ op: 'unset', path: ['size'] }], 3) })
    expect(face.hooks.imageGeneration.getSnapshot().apiKeyConfigured).toBe(true)
    controller.dispose()
  })
  it('edits custom parameters without provider presets or reset controls', () => {
    const { face, host, props, controller } = bench(true)
    host.publish({ value: { enabled: false }, base: {}, user: {} })
    render(<ImageGenerationCard {...props} />)
    expect(screen.queryByRole('tablist')).toBeNull()
    for (const field of ['endpoint', 'model', 'size', 'quality'] as const) {
      expect(screen.getByLabelText(en[field])).toHaveProperty('value', '')
    }
    fireEvent.change(screen.getByLabelText(en.endpoint), { target: { value: 'https://custom-images.test/generate' } })
    fireEvent.change(screen.getByLabelText(en.model), { target: { value: 'custom-image-model' } })
    fireEvent.change(screen.getByLabelText(en.size), { target: { value: '1536x1024' } })
    expect(face.hooks.imageGeneration.getSnapshot()).toMatchObject({
      endpoint: { text: 'https://custom-images.test/generate' }, model: { text: 'custom-image-model' },
      size: { text: '1536x1024' }, quality: { text: '' }, apiKey: { text: '' }, apiKeyConfigured: true,
    })
    expect(screen.getByLabelText(en.quality)).toBeTruthy()
    expect(screen.queryByText(en.overridden)).toBeNull()
    expect(screen.queryByRole('button', { name: en.reset })).toBeNull()
    controller.dispose()
  })
  it('requires a model and credential before saving an enabled configuration', () => {
    const { face, props, controller } = bench()
    render(<ImageGenerationCard {...props} />)
    fireEvent.click(screen.getByLabelText(en.enabled))
    expect(face.hooks.imageGeneration.getSnapshot()).toMatchObject({ dirty: true, enabled: true, invalid: true })
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText(en.model), { target: { value: 'image-model' } })
    fireEvent.change(screen.getByLabelText(en.apiKey), { target: { value: 'private-key' } })
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', false)
    expect(screen.getByLabelText(en.apiKey)).toHaveProperty('type', 'password')
    controller.dispose()
  })

  it('saves credentials and activation together in one revision-fenced mutation', async () => {
    const { face, host, controller } = bench()
    host.mutate.mockResolvedValue(true)
    face.edit('model', 'image-model')
    face.edit('apiKey', 'private-key')
    face.edit('size', '1024x1024')
    face.edit('enabled', 'true')
    face.save()
    await vi.waitFor(() => { expect(face.hooks.imageGeneration.getSnapshot().saving).toBe(false) })
    expect(host.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['model'], value: 'image-model' },
      { op: 'set', path: ['apiKey'], value: 'private-key' },
      { op: 'set', path: ['size'], value: '1024x1024' },
      { op: 'set', path: ['enabled'], value: true },
    ], 3)
    expect(face.hooks.imageGeneration.getSnapshot().apiKey.text).toBe('')
    controller.dispose()
  })

  it('clears optional custom parameters without submitting the saved credential', async () => {
    const { host, props, face, controller } = bench(true)
    host.publish({
      value: { enabled: true, endpoint: 'https://images.test/v1/images/generations', model: 'image-model', size: '1024x1024', quality: 'high' },
      base: { endpoint: 'https://images.test/v1/images/generations', model: 'image-model' },
      user: { endpoint: 'https://images.test/v1/images/generations', model: 'image-model', size: '1024x1024', quality: 'high' },
    })
    render(<ImageGenerationCard {...props} />)
    expect(screen.getByText(en.apiKeySet)).toBeTruthy()
    for (const field of ['endpoint', 'model', 'size', 'quality'] as const) {
      fireEvent.change(screen.getByLabelText(en[field]), { target: { value: field === 'endpoint' ? 'https://other.test/images/generations' : 'other-value' } })
    }
    expect(face.hooks.imageGeneration.getSnapshot()).toMatchObject({ size: { text: 'other-value' }, quality: { text: 'other-value' } })
    expect(screen.queryByText(en.overridden)).toBeNull()
    expect(screen.queryByRole('button', { name: en.reset })).toBeNull()
    for (const field of ['size', 'quality'] as const) fireEvent.change(screen.getByLabelText(en[field]), { target: { value: '' } })
    expect(face.hooks.imageGeneration.getSnapshot()).toMatchObject({ size: { text: '' }, quality: { text: '' }, apiKey: { text: '' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await vi.waitFor(() => { expect(host.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['endpoint'], value: 'https://other.test/images/generations' },
      { op: 'set', path: ['model'], value: 'other-value' },
      { op: 'unset', path: ['size'] },
      { op: 'unset', path: ['quality'] },
    ], 3) })
    controller.dispose()
  })

  it('locks controls during a save and shows a localized refusal without clearing drafts', async () => {
    const { host, props, controller } = bench()
    const response = Promise.withResolvers<boolean>()
    host.mutate.mockReturnValue(response.promise)
    render(<ImageGenerationCard {...props} />)
    fireEvent.change(screen.getByLabelText(en.model), { target: { value: 'new-model' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(screen.getByRole('button', { name: en.saving })).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(en.model)).toHaveProperty('disabled', true)
    response.resolve(false)
    await vi.waitFor(() => { expect(screen.getByText(en.saveFailed)).toBeTruthy() })
    expect(screen.getByLabelText(en.model)).toHaveProperty('value', 'new-model')
    controller.dispose()
  })

  it('keeps a saved key when left blank, and updates its presence from Host metadata', async () => {
    const { face, host, mirror, controller } = bench(true)
    expect(face.hooks.imageGeneration.getSnapshot()).toMatchObject({ apiKeyConfigured: true, apiKey: { text: '' } })
    face.edit('apiKey', '')
    face.edit('quality', 'high')
    face.save()
    await vi.waitFor(() => { expect(host.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['quality'], value: 'high' },
    ], 3) })
    mirror.set({ status: 'ready', view: undefined, error: null })
    expect(face.hooks.imageGeneration.getSnapshot().apiKeyConfigured).toBe(false)
    controller.dispose()
  })

  it('retains staged values after a refused save and discards them on request', async () => {
    const { face, host, controller } = bench()
    host.mutate.mockResolvedValue(false)
    face.edit('endpoint', 'invalid-endpoint')
    face.save()
    await vi.waitFor(() => { expect(face.hooks.imageGeneration.getSnapshot().failed).toBe(true) })
    expect(face.hooks.imageGeneration.getSnapshot().endpoint.text).toBe('invalid-endpoint')
    face.discard()
    expect(face.hooks.imageGeneration.getSnapshot()).toMatchObject({ dirty: false, failed: false })
    expect(host.listenerCount()).toBe(1)
    controller.dispose()
    expect(host.listenerCount()).toBe(0)
  })

  it('stages resets and refuses unsupported switch values', () => {
    const { host, face, controller } = bench(true)
    host.publish({ value: { enabled: false, quality: 'high' }, base: { quality: 'auto' }, user: { quality: 'high' } })
    face.resetField('quality')
    expect(face.hooks.imageGeneration.getSnapshot().quality).toMatchObject({ text: 'auto', overridden: false })
    face.edit('enabled', 'unsupported')
    expect(face.hooks.imageGeneration.getSnapshot().invalid).toBe(true)
    face.edit('provider', 'unsupported')
    expect(face.hooks.imageGeneration.getSnapshot().provider.invalid).toBe(true)
    controller.dispose()
  })

  it('localizes controls and disables writes on a read-only connection', () => {
    const { host, props, controller } = bench()
    host.publish({ writable: false })
    render(<ImageGenerationCard {...props} t={makeTranslate(zh, commonZh)} />)
    expect(screen.getByLabelText(zh.apiKey)).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(zh.enabled)).toHaveProperty('disabled', true)
    expect(screen.getByText(zh.readOnly)).toBeTruthy()
    controller.dispose()
  })

  it('renders the unavailable state and releases drafts when the form unmounts', () => {
    const { host, props, face, controller } = bench()
    host.publish({ status: 'unavailable' })
    const discard = vi.fn(face.discard)
    const view = render(<ImageGenerationCard {...props} discard={discard} />)
    expect(screen.getByText(en.unavailable)).toBeTruthy()
    expect(screen.queryByLabelText(en.apiKey)).toBeNull()
    view.unmount()
    expect(discard).toHaveBeenCalledOnce()
    controller.dispose()
  })

  it('renders the localized description alone for summary requests', () => {
    const { props, controller } = bench()
    render(<ImageGenerationCard {...props} view="summary" />)
    expect(screen.getByText(en.description)).toBeTruthy()
    expect(screen.queryByLabelText(en.endpoint)).toBeNull()
    controller.dispose()
  })
})
