/** Input discovery never keeps permission-check capture or adopts a late grant. */
import { afterEach, expect, it, vi } from 'vitest'
import { discoverVoiceInputs } from '../src/client/devices.ts'

afterEach(() => { vi.unstubAllGlobals() })

function device(id: string, kind: MediaDeviceKind = 'audioinput'): MediaDeviceInfo {
  return { deviceId: id, groupId: 'inputs', label: id, kind, toJSON: () => ({}) }
}

function fixture() {
  const stop = vi.fn()
  const track: Pick<MediaStreamTrack, 'stop'> = { stop }
  const stream: Pick<MediaStream, 'getTracks'> = { getTracks: () => [track as MediaStreamTrack] }
  const media = { getUserMedia: vi.fn(async () => stream as MediaStream),
    enumerateDevices: vi.fn(async () => [device('default'), device('usb'), device('camera', 'videoinput')]) }
  vi.stubGlobal('navigator', { mediaDevices: media })
  return { media, stream: stream as MediaStream, stop }
}

it('lists inputs without recording, omitting cameras and the duplicate system default', async () => {
  const b = fixture()
  expect(await discoverVoiceInputs(false, '', new AbortController().signal)).toEqual([{ id: 'usb', label: 'usb' }])
  expect(b.media.getUserMedia).not.toHaveBeenCalled()
})

it('checks the selected microphone and stops every check track before returning', async () => {
  const b = fixture()
  await discoverVoiceInputs(true, 'usb', new AbortController().signal)
  expect(b.media.getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: { deviceId: { exact: 'usb' } }, video: false })
  expect(b.stop).toHaveBeenCalledOnce()
})

it('releases a permission grant received after cancellation and publishes no device roster', async () => {
  const b = fixture(), grant = Promise.withResolvers<MediaStream>(), owner = new AbortController()
  b.media.getUserMedia.mockReturnValue(grant.promise)
  const pending = discoverVoiceInputs(true, '', owner.signal)
  const rejected = expect(pending).rejects.toThrow('page closed')
  owner.abort(new Error('page closed')); grant.resolve(b.stream)
  await rejected
  expect(b.stop).toHaveBeenCalledOnce()
  expect(b.media.enumerateDevices).not.toHaveBeenCalled()
})

it('reports denied microphone permission without replacing the selected device', async () => {
  const b = fixture()
  b.media.getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
  await expect(discoverVoiceInputs(true, 'usb', new AbortController().signal)).rejects.toMatchObject({ kind: 'permission' })
})
