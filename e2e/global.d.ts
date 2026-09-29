/**
 * Dev-only e2e hooks exposed by CanvasHost.vue. They exist so the acceptance
 * specs can drive the real engine and store instead of guessing at DOM state.
 *
 * Typed structurally rather than by importing EditorEngine: pulling `src/**`
 * into the e2e program would typecheck the whole editor under this config's
 * compiler options, which are not the app's (see tsconfig.app.json). The
 * specs reach into the engine loosely anyway — the hooks only exist under a
 * dev server — so a structural shape is both honest and self-contained.
 */

type AnyRecord = Record<string, any>

declare global {
  interface Window {
    __engine__: AnyRecord
    __store__: AnyRecord
  }
}

export {}
