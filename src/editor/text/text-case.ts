/**
 * Text-case helpers (AI Type > Change Case parity). Pure string ops so they
 * stay unit-testable under plain Node — run with `vitest run`.
 */
export type TextCaseMode = 'upper' | 'lower' | 'title'

/** UPPER / lower / Title Case a text run (locale-insensitive, like AI). */
export function changeCaseText(content: string, mode: TextCaseMode): string {
  if (mode === 'upper') return content.toUpperCase()
  if (mode === 'lower') return content.toLowerCase()
  return content.toLowerCase().replace(/(^|[\s\-_\/\(\[{'"])([a-z])/g, (_, pre: string, ch: string) => pre + ch.toUpperCase())
}
