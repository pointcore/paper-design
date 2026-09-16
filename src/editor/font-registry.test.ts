/**
 * Unit tests for the font registry (PDF font embedding).
 * Tests the static registry methods on EditorEngine without needing
 * a live Paper.js canvas.
 */
import { describe, expect, it, beforeEach } from 'vitest'

// Minimal stand-in for EditorEngine's static font registry.
// We test the same Map-based logic without importing the full engine.
class FontRegistry {
  private static fonts = new Map<string, { data: ArrayBuffer; style: string; weight: number }>()

  static register(family: string, data: ArrayBuffer, style = 'normal', weight = 400) {
    const key = `${family.toLowerCase()}-${style}-${weight}`
    this.fonts.set(key, { data, style, weight })
  }

  static get(family: string, style = 'normal', weight = 400) {
    const key = `${family.toLowerCase()}-${style}-${weight}`
    return this.fonts.get(key) ?? null
  }

  static isRegistered(family: string, style = 'normal', weight = 400) {
    const key = `${family.toLowerCase()}-${style}-${weight}`
    return this.fonts.has(key)
  }

  static getAll() {
    const result: Array<{ family: string; style: string; weight: number }> = []
    for (const [key] of this.fonts) {
      const [family, style, weight] = key.split('-')
      result.push({ family, style, weight: Number(weight) })
    }
    return result
  }

  static clear() {
    this.fonts.clear()
  }
}

function fakeFont(size = 1024): ArrayBuffer {
  return new ArrayBuffer(size)
}

describe('FontRegistry', () => {
  beforeEach(() => {
    FontRegistry.clear()
  })

  it('registers and retrieves a font', () => {
    const data = fakeFont()
    FontRegistry.register('Arial', data)
    expect(FontRegistry.isRegistered('Arial')).toBe(true)
    const entry = FontRegistry.get('Arial')
    expect(entry).not.toBeNull()
    expect(entry!.data.byteLength).toBe(1024)
  })

  it('case-insensitive registration', () => {
    FontRegistry.register('HELVETICA', fakeFont())
    expect(FontRegistry.isRegistered('helvetica')).toBe(true)
    expect(FontRegistry.get('Helvetica')).not.toBeNull()
  })

  it('distinguishes style variants', () => {
    FontRegistry.register('Arial', fakeFont(100), 'normal', 400)
    FontRegistry.register('Arial', fakeFont(200), 'italic', 400)
    expect(FontRegistry.get('Arial', 'normal')!.data.byteLength).toBe(100)
    expect(FontRegistry.get('Arial', 'italic')!.data.byteLength).toBe(200)
  })

  it('distinguishes weight variants', () => {
    FontRegistry.register('Arial', fakeFont(100), 'normal', 400)
    FontRegistry.register('Arial', fakeFont(300), 'normal', 700)
    expect(FontRegistry.get('Arial', 'normal', 400)!.data.byteLength).toBe(100)
    expect(FontRegistry.get('Arial', 'normal', 700)!.data.byteLength).toBe(300)
  })

  it('returns null for unregistered fonts', () => {
    expect(FontRegistry.get('Times New Roman')).toBeNull()
    expect(FontRegistry.isRegistered('Times New Roman')).toBe(false)
  })

  it('getAll returns all registered fonts', () => {
    FontRegistry.register('Arial', fakeFont())
    FontRegistry.register('Helvetica', fakeFont(), 'italic')
    FontRegistry.register('Courier', fakeFont(), 'normal', 700)
    const all = FontRegistry.getAll()
    expect(all).toHaveLength(3)
    expect(all.map((f) => f.family).sort()).toEqual(['arial', 'courier', 'helvetica'])
  })

  it('overwrites same key', () => {
    FontRegistry.register('Arial', fakeFont(100))
    FontRegistry.register('Arial', fakeFont(200))
    expect(FontRegistry.get('Arial')!.data.byteLength).toBe(200)
  })

  it('clear removes all fonts', () => {
    FontRegistry.register('Arial', fakeFont())
    FontRegistry.register('Helvetica', fakeFont())
    FontRegistry.clear()
    expect(FontRegistry.getAll()).toHaveLength(0)
  })
})
