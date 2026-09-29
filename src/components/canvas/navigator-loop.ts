/**
 * When the navigator's viewport frame loop is allowed to run.
 *
 * The loop re-reads the paper view bounds every frame. Browsers throttle
 * requestAnimationFrame in a background tab, but not uniformly, so a
 * throttled-but-alive loop still wakes the main thread and measures a view
 * nobody is looking at. Keeping the policy in one pure function means it can
 * be asserted without a browser, and the component only has to apply it.
 */

export interface ViewportLoopState {
  /** The navigator panel is folded away; there is nothing to paint. */
  collapsed: boolean
  /** The document is in a background tab. */
  hidden: boolean
}

/** True when the loop should be scheduling frames. */
export function shouldRunViewportLoop(state: ViewportLoopState): boolean {
  return !state.collapsed && !state.hidden
}
