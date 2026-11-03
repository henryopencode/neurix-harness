// @vitest-environment jsdom
/** Card configuration status follows accepted settings and bundle activation. */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsMirrorSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { ImageGenerationStatus, type ImageGenerationStatusProps } from '../src/client/ImageGenerationStatus.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

describe('image-generation card status', () => {
  it('hides configured or unavailable status and flags incomplete settings or disabled activation', () => {
    const entry = { ns: 'tool-image-generation', schema: {}, value: { enabled: true, endpoint: 'https://images.example/generate', model: 'image-01' },
      revision: 0, applies: 'live' as const, autoGenerate: true, secrets: [{ path: ['apiKey'], set: true }] }
    const store = createSnapshotStore<SettingsMirrorSnapshot>({ status: 'ready', error: null,
      view: { writable: true, hasDocument: true, namespaces: [entry] } })
    const props = { pkg: { name: '@deepseek-ai/dsh-image-generation-bundle', installed: false, availability: 'installation', official: true, enabled: true, rows: [] },
      t: makeTranslate(en, commonEn), useConfigurations: bindSnapshotSelector(store) } as ImageGenerationStatusProps
    const view = render(<ImageGenerationStatus {...props} />)
    expect(view.container.textContent).toBe('')
    for (const changed of [
      { ...entry, value: { ...entry.value, enabled: false } },
      { ...entry, value: { ...entry.value, endpoint: '' } },
      { ...entry, value: { ...entry.value, model: '' } },
      { ...entry, secrets: [{ path: ['apiKey'], set: false }] },
      { ...entry, value: null },
      { ...entry, value: [] },
    ]) {
      act(() => { store.set({ ...store.getSnapshot(), view: { writable: true, hasDocument: true, namespaces: [changed] } }) })
      expect(screen.getByText(en.statusNeedsSetup)).toBeTruthy()
    }
    act(() => { store.set({ status: 'ready', error: null, view: { writable: true, hasDocument: true, namespaces: [entry] } }) })
    expect(view.container.textContent).toBe('')
    // The settings namespace disappears before the inventory publishes deactivation.
    act(() => { store.set({ status: 'ready', error: null, view: { writable: true, hasDocument: true, namespaces: [] } }) })
    expect(view.container.textContent).toBe('')
    view.rerender(<ImageGenerationStatus {...props} pkg={{ ...props.pkg, enabled: false }} />)
    expect(screen.getByText(en.statusDisabled)).toBeTruthy()
    view.rerender(<ImageGenerationStatus {...props} />)
    act(() => { store.set({ status: 'ready', error: null, view: undefined }) })
    expect(view.container.textContent).toBe('')
    act(() => { store.set({ status: 'loading', error: null, view: undefined }) })
    expect(view.container.textContent).toBe('')
    view.rerender(<ImageGenerationStatus {...props} pkg={{ ...props.pkg, enabled: false }} />)
    expect(screen.getByText(en.statusDisabled)).toBeTruthy()
  })
})
