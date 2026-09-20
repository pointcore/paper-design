import { describe, expect, it } from 'vitest'
import {
  ACTION_OPS,
  MAX_ACTIONS,
  MAX_STEPS_PER_ACTION,
  cleanActions,
  cleanActionStep,
  createNamedAction,
  describeAction,
  describeStep,
  isValidActionStep,
  renameNamedAction,
  runActionSteps,
  type ActionStep,
  type NamedAction,
} from './action-batch'

function action(overrides: Partial<NamedAction> = {}): NamedAction {
  return {
    id: 'act-abc',
    name: 'Line up',
    savedAt: 1700000000000,
    steps: [{ op: 'nudge', params: { dx: 10, dy: 0 } }],
    ...overrides,
  }
}

describe('isValidActionStep', () => {
  it('accepts every supported op with well-formed params', () => {
    const steps: ActionStep[] = [
      { op: 'nudge', params: { dx: 10, dy: -5 } },
      { op: 'align', params: { mode: 'left' } },
      { op: 'distribute', params: { axis: 'horizontal' } },
      { op: 'distributeSpacing', params: { axis: 'vertical' } },
      { op: 'boolean', params: { op: 'unite' } },
    ]
    for (const s of steps) expect(isValidActionStep(s)).toBe(true)
    expect(ACTION_OPS).toHaveLength(5)
  })

  it('rejects unknown ops, bad params and non-objects', () => {
    expect(isValidActionStep(null)).toBe(false)
    expect(isValidActionStep({ op: 'rotate', params: {} })).toBe(false)
    expect(isValidActionStep({ op: 'nudge', params: { dx: 0, dy: 0 } })).toBe(false)
    expect(isValidActionStep({ op: 'nudge', params: { dx: NaN, dy: 1 } })).toBe(false)
    expect(isValidActionStep({ op: 'nudge', params: { dx: 20000, dy: 0 } })).toBe(false)
    expect(isValidActionStep({ op: 'align', params: { mode: 'diagonal' } })).toBe(false)
    expect(isValidActionStep({ op: 'distribute', params: { axis: 'depth' } })).toBe(false)
    expect(isValidActionStep({ op: 'boolean', params: { op: 'trace' } })).toBe(false)
    expect(isValidActionStep({ op: 'align', params: null })).toBe(false)
  })
})

describe('cleanActionStep', () => {
  it('drops stray params', () => {
    const out = cleanActionStep({ op: 'align', params: { mode: 'top', extra: 1 } })
    expect(out).toEqual({ op: 'align', params: { mode: 'top' } })
  })
})

describe('cleanActions', () => {
  it('drops corrupt entries and cleans nested steps', () => {
    const out = cleanActions([
      action({ name: '  Spaced  ' }),
      null,
      { id: 'bad' },
      action({ id: 'empty', steps: [{ op: 'rotate', params: {} } as unknown as ActionStep] }),
      'zzz',
    ])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Spaced')
  })

  it('caps actions and steps per action', () => {
    const manySteps = Array.from({ length: MAX_STEPS_PER_ACTION + 10 }, () => ({
      op: 'nudge' as const,
      params: { dx: 1, dy: 0 },
    }))
    const list = Array.from({ length: MAX_ACTIONS + 5 }, (_, i) =>
      action({ id: `act-${i}`, name: `A${i}`, steps: manySteps }),
    )
    const out = cleanActions(list)
    expect(out).toHaveLength(MAX_ACTIONS)
    expect(out[0].steps).toHaveLength(MAX_STEPS_PER_ACTION)
  })

  it('round-trips through JSON (save/reopen contract)', () => {
    const list = [action(), action({ id: 'act-2', name: 'Second' })]
    expect(cleanActions(JSON.parse(JSON.stringify(list)))).toEqual(list)
  })
})

describe('createNamedAction / renameNamedAction', () => {
  it('builds entries with trimmed names and drops invalid steps', () => {
    const a = createNamedAction(
      '  Line up  ',
      [{ op: 'nudge', params: { dx: 5, dy: 0 } }, { op: 'nope', params: {} }],
      1700000000000,
      'fixed',
    )
    expect(a?.name).toBe('Line up')
    expect(a?.savedAt).toBe(1700000000000)
    expect(a?.id).toBe('act-fixed')
    expect(a?.steps).toHaveLength(1)
  })

  it('returns null when no step survives', () => {
    expect(createNamedAction('Empty', [])).toBeNull()
    expect(createNamedAction('Empty', [{ op: 'rotate', params: {} }])).toBeNull()
  })

  it('renames one entry and ignores unknown ids or blank names', () => {
    const list = [action({ id: 'a', name: 'A' }), action({ id: 'b', name: 'B' })]
    const renamed = renameNamedAction(list, 'a', '  Alpha  ')
    expect(renamed.find((x) => x.id === 'a')?.name).toBe('Alpha')
    expect(renameNamedAction(list, 'missing', 'X')).toBe(list)
    expect(renameNamedAction(list, 'a', '   ')).toBe(list)
  })
})

describe('describeStep / describeAction', () => {
  it('labels steps and summarizes batches', () => {
    expect(describeStep({ op: 'nudge', params: { dx: 10, dy: 0 } })).toBe('Nudge (10, 0)')
    expect(describeStep({ op: 'boolean', params: { op: 'subtract' } })).toBe('Boolean subtract')
    const a = action({
      steps: [
        { op: 'align', params: { mode: 'left' } },
        { op: 'nudge', params: { dx: 1, dy: 0 } },
      ],
    })
    expect(describeAction(a)).toBe('2 steps · Align left +1')
  })
})

describe('runActionSteps', () => {
  const steps: ActionStep[] = [
    { op: 'nudge', params: { dx: 10, dy: 0 } },
    { op: 'align', params: { mode: 'left' } },
    { op: 'boolean', params: { op: 'unite' } },
  ]

  it('runs every step and reports success', () => {
    const seen: string[] = []
    const res = runActionSteps(steps, (s) => {
      seen.push(s.op)
      return true
    })
    expect(res).toEqual({ ran: 3, total: 3, ok: true })
    expect(seen).toEqual(['nudge', 'align', 'boolean'])
  })

  it('stops at the first failure without running later steps', () => {
    const seen: string[] = []
    const res = runActionSteps(steps, (s) => {
      seen.push(s.op)
      return s.op !== 'align'
    })
    expect(res).toEqual({ ran: 1, total: 3, ok: false })
    expect(seen).toEqual(['nudge', 'align'])
  })

  it('treats thrown handlers as failures', () => {
    const res = runActionSteps(steps, () => {
      throw new Error('boom')
    })
    expect(res).toEqual({ ran: 0, total: 3, ok: false })
  })
})
