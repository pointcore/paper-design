/**
 * Store type export to avoid circular imports
 */
import type { useEditorStore } from './store'

export type EditorStore = ReturnType<typeof useEditorStore>
