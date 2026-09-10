/**
 * Unit tests for text-case helpers — run with `vitest run`.
 */
import { describe, expect, it } from 'vitest'
import { changeCaseText } from './text-case'

describe('changeCaseText', () => {
  it('uppercases runs', () => {
    expect(changeCaseText('Hello World', 'upper')).toBe('HELLO WORLD')
  })

  it('lowercases runs', () => {
    expect(changeCaseText('Hello World', 'lower')).toBe('hello world')
  })

  it('title-cases across separators', () => {
    expect(changeCaseText('hello world', 'title')).toBe('Hello World')
    expect(changeCaseText('SELF-ASSESSMENT/audit', 'title')).toBe('Self-Assessment/Audit')
    expect(changeCaseText('', 'title')).toBe('')
  })
})
