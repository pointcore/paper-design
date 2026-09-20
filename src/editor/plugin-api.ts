/**
 * Plugin API sandbox (D8).
 *
 * Third-party commands run against a narrow context (engine facade +
 * store + selection snapshot + notify) instead of raw Paper.js scope, so
 * a misbehaving plugin can only fail its own run: errors are caught per
 * invocation and reported to the status bar. Definitions carry no Vue or
 * Paper.js imports, keeping registration unit-testable.
 */
import type { EditorEngine } from './engine'
import type { EditorStore } from './store-types'

/** What a plugin command may touch. */
export interface PluginContext {
  engine: EditorEngine
  store: EditorStore
  /** Selection snapshot taken when the command starts. */
  selectionIds: string[]
  /** Report back to the user (status bar). */
  notify: (message: string) => void
}

/** One plugin-contributed command. */
export interface PluginCommandDef {
  /** Unique id, e.g. `sample:doc-info`. */
  id: string
  /** Display title (shown in the command palette). */
  title: string
  run: (ctx: PluginContext) => void | Promise<void>
}

/** Registry + isolated runner for plugin commands. */
export class PluginApi {
  private readonly commands = new Map<string, PluginCommandDef>()

  /** Register a command; false on duplicate id or invalid definition. */
  register(cmd: PluginCommandDef): boolean {
    if (!cmd || typeof cmd.id !== 'string' || cmd.id.trim() === '') return false
    if (typeof cmd.title !== 'string' || cmd.title.trim() === '') return false
    if (typeof cmd.run !== 'function') return false
    if (this.commands.has(cmd.id)) return false
    this.commands.set(cmd.id, { ...cmd })
    return true
  }

  /** Remove a command; false when unknown. */
  unregister(id: string): boolean {
    return this.commands.delete(id)
  }

  /** Snapshot of registered commands (registration order). */
  getCommands(): PluginCommandDef[] {
    return [...this.commands.values()].map((c) => ({ ...c }))
  }

  /**
   * Run a command with an isolated context. True when the command ran
   * cleanly; false when unknown or when it threw (the error is reported
   * via notify and never propagates to the host).
   */
  async run(engine: EditorEngine, store: EditorStore, id: string): Promise<boolean> {
    const cmd = this.commands.get(id)
    if (!cmd) return false
    const notify = (message: string) => {
      try {
        store.setStatusMessage(message)
      } catch { /* host teardown mid-run: stay silent */ }
    }
    try {
      await cmd.run({ engine, store, selectionIds: [...store.selectedItemIds], notify })
      return true
    } catch {
      notify(`Plugin "${cmd.title}" failed`)
      return false
    }
  }
}

/** Host-wide singleton: panels and the palette share one registry. */
export const pluginApi = new PluginApi()
