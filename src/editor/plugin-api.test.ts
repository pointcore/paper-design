import { describe, expect, it, vi } from 'vitest'
import { PluginApi } from './plugin-api'
import { registerSampleCommands } from './plugin-sample'

function fakeStore(selection: string[] = []) {
  return {
    selectedItemIds: [...selection],
    hasSelection: selection.length > 0,
    setStatusMessage: vi.fn(),
  } as never
}

describe('PluginApi.register', () => {
  it('accepts well-formed commands', () => {
    const api = new PluginApi()
    expect(api.register({ id: 'a:b', title: 'Do B', run: () => undefined })).toBe(true)
    expect(api.getCommands().map((c) => c.id)).toEqual(['a:b'])
  })

  it('rejects duplicates and invalid definitions', () => {
    const api = new PluginApi()
    const good = { id: 'a:b', title: 'Do B', run: () => undefined }
    expect(api.register(good)).toBe(true)
    expect(api.register(good)).toBe(false)
    expect(api.register({ id: '', title: 'x', run: () => undefined })).toBe(false)
    expect(api.register({ id: 'c:d', title: '  ', run: () => undefined })).toBe(false)
    expect(api.register({ id: 'e:f', title: 'x', run: undefined as never })).toBe(false)
  })

  it('unregisters by id', () => {
    const api = new PluginApi()
    api.register({ id: 'a:b', title: 'Do B', run: () => undefined })
    expect(api.unregister('a:b')).toBe(true)
    expect(api.unregister('a:b')).toBe(false)
    expect(api.getCommands()).toHaveLength(0)
  })
})

describe('PluginApi.run', () => {
  it('runs with a selection snapshot and notifies', async () => {
    const api = new PluginApi()
    let seen: string[] = []
    api.register({
      id: 't:run',
      title: 'Run',
      run: ({ selectionIds, notify }) => {
        seen = selectionIds
        notify('hello')
      },
    })
    const store = fakeStore(['x'])
    expect(await api.run({} as never, store, 't:run')).toBe(true)
    expect(seen).toEqual(['x'])
    expect((store as unknown as { setStatusMessage: ReturnType<typeof vi.fn> }).setStatusMessage)
      .toHaveBeenCalledWith('hello')
  })

  it('returns false for unknown commands', async () => {
    const api = new PluginApi()
    expect(await api.run({} as never, fakeStore(), 'nope')).toBe(false)
  })

  it('isolates plugin errors from the host', async () => {
    const api = new PluginApi()
    api.register({
      id: 't:boom',
      title: 'Boom',
      run: () => {
        throw new Error('boom')
      },
    })
    const store = fakeStore()
    await expect(api.run({} as never, store, 't:boom')).resolves.toBe(false)
    expect((store as unknown as { setStatusMessage: ReturnType<typeof vi.fn> }).setStatusMessage)
      .toHaveBeenCalledWith('Plugin "Boom" failed')
  })
})

describe('registerSampleCommands', () => {
  it('registers three demo commands and stays idempotent', () => {
    const api = new PluginApi()
    expect(registerSampleCommands(api)).toHaveLength(3)
    expect(registerSampleCommands(api)).toHaveLength(0)
    expect(api.getCommands().map((c) => c.id)).toEqual([
      'sample:doc-info',
      'sample:zoom-selection',
      'sample:clear-selection',
    ])
  })

  it('doc-info reports through notify', async () => {
    const api = new PluginApi()
    registerSampleCommands(api)
    const store = {
      selectedItemIds: [],
      hasSelection: false,
      artboards: [{}, {}],
      layers: [{}],
      setStatusMessage: vi.fn(),
    } as never
    expect(await api.run({} as never, store, 'sample:doc-info')).toBe(true)
    expect((store as unknown as { setStatusMessage: ReturnType<typeof vi.fn> }).setStatusMessage)
      .toHaveBeenCalledWith('2 boards · 1 layer · 0 selected')
  })
})
