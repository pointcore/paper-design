/**
 * Action batch record/replay (D7, v1).
 *
 * A batch is a named list of selection-scoped document ops (align, nudge,
 * distribute, boolean) that runs back against whatever is selected, so one
 * recorded pass can be replayed on another selection or artboard.
 *
 * This file is the pure data layer (no Vue / Paper.js / storage): step
 * validation, list hygiene, descriptions and the engine-agnostic runner.
 * ActionsPanel owns capture (v1 records only ops run from its own section;
 * palette/menu ops are not intercepted yet), persistence (localStorage,
 * best effort) and the engine binding for `runOne`.
 */

import type { AlignMode, BooleanOperation, DistributeAxis } from './types'

/** Ops replayable against the current selection (all JSON-serializable). */
export type ActionOp = 'nudge' | 'align' | 'distribute' | 'distributeSpacing' | 'boolean'

/** One recorded document op with its parameters. */
export interface ActionStep {
  op: ActionOp
  params: Record<string, number | string | boolean>
}

/** One saved batch. */
export interface NamedAction {
  id: string
  name: string
  /** Wall-clock ms when the batch was saved. */
  savedAt: number
  steps: ActionStep[]
}

/** Hard cap on kept batches (UI shows the truncation). */
export const MAX_ACTIONS = 20

/** Hard cap on steps per batch (keeps replay predictable). */
export const MAX_STEPS_PER_ACTION = 50

/** Batch names are short labels; longer input is trimmed. */
export const MAX_ACTION_NAME_LEN = 40

export const ACTION_OPS: ActionOp[] = ['nudge', 'align', 'distribute', 'distributeSpacing', 'boolean']

const ALIGN_MODES: AlignMode[] = ['left', 'centerX', 'right', 'top', 'centerY', 'bottom']
const DISTRIBUTE_AXES: DistributeAxis[] = ['horizontal', 'vertical']
const BOOLEAN_OPS: BooleanOperation[] = ['unite', 'subtract', 'intersect', 'exclude']

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** True when a value is a runnable step (unknown ops/params rejected). */
export function isValidActionStep(step: unknown): step is ActionStep {
  if (!step || typeof step !== 'object') return false
  const { op, params } = step as { op?: unknown; params?: unknown }
  if (typeof op !== 'string' || !ACTION_OPS.includes(op as ActionOp)) return false
  if (!params || typeof params !== 'object' || Array.isArray(params)) return false
  const p = params as Record<string, unknown>
  switch (op as ActionOp) {
    case 'nudge': {
      if (!isFiniteNumber(p.dx) || !isFiniteNumber(p.dy)) return false
      if (Math.abs(p.dx) > 10000 || Math.abs(p.dy) > 10000) return false
      if (p.dx === 0 && p.dy === 0) return false
      return true
    }
    case 'align':
      return typeof p.mode === 'string' && (ALIGN_MODES as string[]).includes(p.mode)
    case 'distribute':
    case 'distributeSpacing':
      return typeof p.axis === 'string' && (DISTRIBUTE_AXES as string[]).includes(p.axis)
    case 'boolean':
      return typeof p.op === 'string' && (BOOLEAN_OPS as string[]).includes(p.op)
    default:
      return false
  }
}

/** Normalize a valid step (drops stray params so stored batches stay small). */
export function cleanActionStep(step: ActionStep): ActionStep {
  switch (step.op) {
    case 'nudge':
      return { op: step.op, params: { dx: step.params.dx, dy: step.params.dy } }
    case 'align':
      return { op: step.op, params: { mode: step.params.mode } }
    case 'distribute':
    case 'distributeSpacing':
      return { op: step.op, params: { axis: step.params.axis } }
    case 'boolean':
      return { op: step.op, params: { op: step.params.op } }
  }
}

/** True when a value is a usable batch entry. */
export function isValidNamedAction(v: Partial<NamedAction>): v is NamedAction {
  if (!v || typeof v !== 'object') return false
  if (typeof v.id !== 'string' || v.id.length === 0 || v.id.length > 120) return false
  if (typeof v.name !== 'string' || v.name.trim().length === 0) return false
  if (typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt) || v.savedAt <= 0) return false
  if (!Array.isArray(v.steps) || v.steps.length === 0 || v.steps.length > MAX_STEPS_PER_ACTION) return false
  return v.steps.every(isValidActionStep)
}

/**
 * Sanitize a loaded list (storage may be corrupt or from an older shape).
 * Keeps insertion order (newest first by convention), trims names, drops
 * invalid entries/steps and caps both dimensions.
 */
export function cleanActions(list: unknown): NamedAction[] {
  if (!Array.isArray(list)) return []
  const out: NamedAction[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const v = raw as Partial<NamedAction>
    if (typeof v.id !== 'string' || !v.id) continue
    if (typeof v.name !== 'string' || !v.name.trim()) continue
    if (typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt) || v.savedAt <= 0) continue
    if (!Array.isArray(v.steps)) continue
    const steps = v.steps.filter(isValidActionStep).map(cleanActionStep).slice(0, MAX_STEPS_PER_ACTION)
    if (steps.length === 0) continue
    out.push({
      id: v.id.slice(0, 120),
      name: v.name.trim().slice(0, MAX_ACTION_NAME_LEN),
      savedAt: v.savedAt,
      steps,
    })
    if (out.length >= MAX_ACTIONS) break
  }
  return out
}

/** Build a batch entry from recorded steps (invalid steps are dropped). */
export function createNamedAction(
  name: string,
  steps: unknown[],
  now: number = Date.now(),
  id?: string,
): NamedAction | null {
  const clean = (name || '').trim().slice(0, MAX_ACTION_NAME_LEN) || 'Action'
  const valid = (Array.isArray(steps) ? steps : [])
    .filter(isValidActionStep)
    .map(cleanActionStep)
    .slice(0, MAX_STEPS_PER_ACTION)
  if (valid.length === 0) return null
  const stamp = Number.isFinite(now) && now > 0 ? Math.floor(now) : Date.now()
  const suffix = (id || `${stamp.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`).slice(0, 120)
  return { id: `act-${suffix}`, name: clean, savedAt: stamp, steps: valid }
}

/**
 * Rename one entry (returns a new list). Blank names and unknown ids
 * leave the list unchanged.
 */
export function renameNamedAction(list: NamedAction[], id: string, newName: string): NamedAction[] {
  const clean = (newName || '').trim().slice(0, MAX_ACTION_NAME_LEN)
  if (!clean) return list
  let touched = false
  const out = list.map((a) => {
    if (a.id !== id) return a
    touched = true
    return a.name === clean ? a : { ...a, name: clean }
  })
  return touched ? out : list
}

/** Short label for one step, e.g. `Align left` or `Nudge (10, 0)`. */
export function describeStep(step: ActionStep): string {
  switch (step.op) {
    case 'nudge':
      return `Nudge (${step.params.dx}, ${step.params.dy})`
    case 'align':
      return `Align ${step.params.mode}`
    case 'distribute':
      return `Distribute ${step.params.axis}`
    case 'distributeSpacing':
      return `Distribute spacing ${step.params.axis}`
    case 'boolean':
      return `Boolean ${step.params.op}`
  }
}

/** One-line label, e.g. `4 steps · Nudge (10, 0) +3`. */
export function describeAction(a: NamedAction): string {
  const head = a.steps.length > 0 ? describeStep(a.steps[0]) : 'Empty'
  const rest = a.steps.length > 1 ? ` +${a.steps.length - 1}` : ''
  return `${a.steps.length} step${a.steps.length === 1 ? '' : 's'} · ${head}${rest}`
}

export interface ActionRunResult {
  /** Steps executed before stopping (equals steps.length on success). */
  ran: number
  /** Total steps attempted. */
  total: number
  /** True when every step reported success. */
  ok: boolean
}

/**
 * Execute steps in order against a caller-supplied `runOne` (the component
 * binds this to engine methods). Stops at the first failure so a replay
 * never half-applies a later destructive op after an earlier miss; pure
 * and unit-testable with stub handlers.
 */
export function runActionSteps(
  steps: ActionStep[],
  runOne: (step: ActionStep, index: number) => boolean,
): ActionRunResult {
  const total = steps.length
  let ran = 0
  for (let i = 0; i < total; i++) {
    let ok = false
    try {
      ok = runOne(steps[i], i) === true
    } catch {
      ok = false
    }
    if (!ok) return { ran, total, ok: false }
    ran++
  }
  return { ran, total, ok: true }
}
