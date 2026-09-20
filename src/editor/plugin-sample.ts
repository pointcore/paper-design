/**
 * Sample plugin (D8 example): three commands built only on the public
 * PluginContext (engine facade + store + selection + notify). Copy this
 * file as a starting point for real plugins; register via
 * `registerSampleCommands(pluginApi)` (called once from App setup, safe
 * to call again — duplicates are rejected).
 */
import { pluginApi, type PluginApi, type PluginContext } from './plugin-api'

export function registerSampleCommands(api: PluginApi = pluginApi): string[] {
  const added: string[] = []
  const defs: Array<{ id: string; title: string; run: (ctx: PluginContext) => void }> = [
    {
      id: 'sample:doc-info',
      title: 'Document Info',
      run: ({ store, notify }) => {
        notify(
          `${store.artboards.length} board${store.artboards.length === 1 ? '' : 's'} · ` +
          `${store.layers.length} layer${store.layers.length === 1 ? '' : 's'} · ` +
          `${store.selectedItemIds.length} selected`,
        )
      },
    },
    {
      id: 'sample:zoom-selection',
      title: 'Zoom to Selection',
      run: ({ engine, store, notify }) => {
        if (store.hasSelection) engine.zoomToSelection()
        else notify('Nothing selected to zoom to')
      },
    },
    {
      id: 'sample:clear-selection',
      title: 'Clear Selection',
      run: ({ engine }) => {
        engine.clearSelection()
      },
    },
  ]
  for (const def of defs) {
    if (api.register(def)) added.push(def.id)
  }
  return added
}
