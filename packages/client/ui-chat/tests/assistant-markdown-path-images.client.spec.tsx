// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AttachmentId, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { MarkdownDelegateProvider } from '@deepseek-ai/dsh-client-ui-primitives'
import { AssistantMarkdown, localPathMediaUrl } from '../src/client/chat/AssistantMarkdown.tsx'
import { useDetailedPresentation } from './presentation-fixture.client.ts'
import { useDisclosure } from '../src/client/chat/use-disclosure.ts'
import { useSearchableHidden } from '../src/client/chat/searchable-hidden.ts'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../src/client/contract/slots.ts'
import type { AssistantBlock } from '../src/client/contract/snapshot.ts'
import type { AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const t = ((_key: string) => 'label') as ChatViewSlotProps['t']
const renderMessageImages = (() => null) as ChatNodeOwnerProps['renderMessageImages']

function textBlock(text: string): AssistantBlock {
  return { kind: 'text', text }
}

const BASE = 'http://127.0.0.1:3080/'
const MOUNTED_BASE = 'http://127.0.0.1:3080/tools/dsh/'

const imageLabels = { open: 'Open image', loading: 'Loading', failed: 'Unavailable', dialog: 'Image preview', close: 'Close' }

function historicalImage(reference: AssistantMarkdownProps['generatedImageReferences'], text = '![portrait](attachment)\n\n`![example](attachment)`') {
  return <MarkdownDelegateProvider fileImages={{ resolve: path => `${BASE}api/file?path=${encodeURIComponent(path)}`, labels: imageLabels }}>
    <AssistantMarkdown renderSlot={() => null} useDisclosure={useDisclosure} useGroupAction={useSearchableHidden}
      usePresentation={useDetailedPresentation}
      blocks={[textBlock(text)]}
      streaming={false} renderMessageImages={renderMessageImages} generatedImageReferences={reference} t={t} />
  </MarkdownDelegateProvider>
}

it('resolves four repeated placeholders in source order, including reference-style images', async () => {
  const attachments = Array.from({ length: 4 }, (_, index) => ({
    attachmentId: AttachmentId(`sha256:portrait-${index + 1}`), mediaType: 'image/png' as const, width: 1, height: 1, bytes: 69,
  }))
  const load = vi.fn(async (attachment: ImageAttachmentRef) => `blob:${attachment.attachmentId}`)
  const text = '![first](attachment)\n![second][picture]\n![third](attachment)\n![fourth](attachment)\n\n[picture]: attachment\n\n`![example](attachment)`\n\n```md\n![example](attachment)\n```'
  const view = render(historicalImage({ attachments, load }, text))
  await waitFor(() => {
    expect([...view.container.querySelectorAll('img')].map(image => image.getAttribute('src')))
      .toEqual(attachments.map(attachment => `blob:${attachment.attachmentId}`))
  })
  expect(load).toHaveBeenCalledTimes(4)
})

it('keeps a mismatched placeholder count unresolved instead of displaying an arbitrary image', async () => {
  const attachments = Array.from({ length: 4 }, (_, index) => ({
    attachmentId: AttachmentId(`sha256:portrait-${index + 1}`), mediaType: 'image/png' as const, width: 1, height: 1, bytes: 69,
  }))
  const load = vi.fn(async (attachment: ImageAttachmentRef) => `blob:${attachment.attachmentId}`)
  const view = render(historicalImage({ attachments, load }))
  await act(async () => { await Promise.resolve() })
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe(`${BASE}api/file?path=attachment`)
})

it('keeps the other images visible when one attachment cannot be read', async () => {
  const attachments = Array.from({ length: 4 }, (_, index) => ({
    attachmentId: AttachmentId(`sha256:portrait-${index + 1}`), mediaType: 'image/png' as const, width: 1, height: 1, bytes: 69,
  }))
  const load = vi.fn(async (attachment: ImageAttachmentRef) => {
    if (attachment.attachmentId === attachments[1]?.attachmentId) throw new Error('attachment missing')
    return `blob:${attachment.attachmentId}`
  })
  const view = render(historicalImage({ attachments, load }, attachments.map((_, index) => `![portrait ${index + 1}](attachment)`).join('\n')))
  await waitFor(() => { expect(view.getByAltText('portrait 4').getAttribute('src')).toBe('blob:sha256:portrait-4') })
  expect(view.getByAltText('portrait 1').getAttribute('src')).toBe('blob:sha256:portrait-1')
  expect(view.getByAltText('portrait 3').getAttribute('src')).toBe('blob:sha256:portrait-3')
  fireEvent.error(view.getByAltText('portrait 2'))
  expect(view.getByText('Unavailable · portrait 2')).toBeTruthy()
})

it('loads a historical placeholder from its saved image without interpreting code examples', async () => {
  const attachment = { attachmentId: AttachmentId('sha256:portrait'), mediaType: 'image/png' as const, width: 1, height: 1, bytes: 69 }
  const load = vi.fn(async () => 'blob:historical-image')
  const view = render(historicalImage({ attachments: [attachment], load }))
  await waitFor(() => { expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:historical-image') })
  expect(load).toHaveBeenCalledWith(attachment)
  expect(view.container.querySelectorAll('img')).toHaveLength(1)
  expect(view.container.querySelector('code')?.textContent).toBe('![example](attachment)')
})

it('ignores a late image read after the reference changes', async () => {
  const pending = Promise.withResolvers<string>()
  const attachment = { attachmentId: AttachmentId('sha256:portrait'), mediaType: 'image/png' as const, width: 1, height: 1, bytes: 69 }
  const view = render(historicalImage({ attachments: [attachment], load: () => pending.promise }))
  view.rerender(historicalImage(undefined))
  await act(async () => { pending.resolve('blob:stale-image'); await pending.promise })
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe(`${BASE}api/file?path=attachment`)
})

it('retains the unavailable-image path when the saved image cannot be read', async () => {
  const attachment = { attachmentId: AttachmentId('sha256:portrait'), mediaType: 'image/png' as const, width: 1, height: 1, bytes: 69 }
  const load = vi.fn(async () => { throw new Error('attachment missing') })
  const view = render(historicalImage({ attachments: [attachment], load }))
  await act(async () => { await Promise.resolve() })
  expect(view.container.querySelector('img')?.getAttribute('src')).toBe(`${BASE}api/file?path=attachment`)
})

describe('localPathMediaUrl', () => {
  it('maps an absolute POSIX path to the file route of the document, root or mount', () => {
    const path = encodeURIComponent('/tmp/graph.png')
    for (const [base, root] of [
      [BASE, BASE],
      ['https://127.0.0.1:3080/', 'https://127.0.0.1:3080/'],
      [MOUNTED_BASE, MOUNTED_BASE],
      ['dsh-app://app/', 'dsh-app://app/'],
      ['dsh-app://app/index.html', 'dsh-app://app/'],
      ['http://127.0.0.1:3080/tools/dsh/index.html', MOUNTED_BASE],
    ]) {
      expect(localPathMediaUrl(base!, '/tmp/graph.png')).toBe(`${root!}api/file?path=${path}`)
    }
  })

  it('keeps unsupported application transports inert', () => {
    expect(localPathMediaUrl('about:blank', '/tmp/graph.png')).toBeUndefined()
    expect(localPathMediaUrl('dsh-app://shell/', '/tmp/graph.png')).toBeUndefined()
    expect(localPathMediaUrl('file:///app', '/tmp/graph.png')).toBeUndefined()
    expect(localPathMediaUrl('ws://127.0.0.1:3080/', '/tmp/graph.png')).toBeUndefined()
  })

  it('keeps destinations that cannot be Host-served local files inert', () => {
    expect(localPathMediaUrl(BASE, '')).toBeUndefined()
    expect(localPathMediaUrl(BASE, '//cdn.example.com/x.png')).toBeUndefined()
    expect(localPathMediaUrl(BASE, 'relative.png')).toBeUndefined()
    expect(new URL(localPathMediaUrl(BASE, 'C:\\tmp\\x.png')!).searchParams.get('path')).toBe('C:\\tmp\\x.png')
  })

  it('encodes the full path including spaces', () => {
    expect(localPathMediaUrl(BASE, '/tmp/my graph.png'))
      .toBe(`${BASE}api/file?path=${encodeURIComponent('/tmp/my graph.png')}`)
  })
})

describe('AssistantMarkdown local-path images', () => {
  it.each([BASE, 'dsh-app://app/'])('renders a local image in closing prose through %s', (base) => {
    vi.spyOn(document, 'baseURI', 'get').mockReturnValue(base)
    const { container } = render(
      <AssistantMarkdown renderSlot={() => null} useDisclosure={useDisclosure} useGroupAction={useSearchableHidden}
        usePresentation={useDetailedPresentation}
        blocks={[textBlock('See ![diagram](/tmp/graph.png) for the layout.')]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    const image = container.querySelector('img')
    expect(image?.getAttribute('alt')).toBe('diagram')
    const url = new URL(image?.getAttribute('src') ?? '')
    expect(url.pathname).toBe('/api/file')
    expect(url.protocol).toBe(new URL(base).protocol)
    expect(url.searchParams.get('path')).toBe('/tmp/graph.png')
  })

  it('keeps non-absolute destinations inert', () => {
    const { container } = render(
      <AssistantMarkdown renderSlot={() => null} useDisclosure={useDisclosure} useGroupAction={useSearchableHidden}
        usePresentation={useDetailedPresentation}
        blocks={[textBlock('See ![diagram](relative.png).')]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('diagram')
  })
})

it('decodes Markdown URL escapes once before encoding the file query', () => {
  for (const [authored, path] of [
    ['/work/test%20workspace/图.png', '/work/test workspace/图.png'],
    ['/work/100%25%23.png', '/work/100%#.png'],
    ['/work/literal%2520.png', '/work/literal%20.png'],
  ]) expect(new URL(localPathMediaUrl(BASE, authored!)!).searchParams.get('path')).toBe(path)
  expect(localPathMediaUrl(BASE, '/work/bad%escape.png')).toBeUndefined()
})
