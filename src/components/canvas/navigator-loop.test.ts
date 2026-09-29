/**
 * The navigator's viewport frame loop.
 *
 * It re-reads the paper view bounds on every frame, so it must not run when
 * the panel is collapsed or the tab is hidden — a throttled-but-alive rAF
 * still wakes the main thread and measures a view nobody is looking at.
 *
 * The pause policy is pulled into a pure function so it can be asserted
 * without a browser: the component only has to apply it.
 */
import { describe, expect, it } from 'vitest'
import { shouldRunViewportLoop } from './navigator-loop'

describe('shouldRunViewportLoop', () => {
  it('runs when the panel is open and the tab is visible', () => {
    expect(shouldRunViewportLoop({ collapsed: false, hidden: false })).toBe(true)
  })

  it('is suspended while collapsed', () => {
    expect(shouldRunViewportLoop({ collapsed: true, hidden: false })).toBe(false)
  })

  it('is suspended while the tab is hidden, even when open', () => {
    expect(shouldRunViewportLoop({ collapsed: false, hidden: true })).toBe(false)
  })

  it('stays suspended when both conditions hold', () => {
    expect(shouldRunViewportLoop({ collapsed: true, hidden: true })).toBe(false)
  })
})
