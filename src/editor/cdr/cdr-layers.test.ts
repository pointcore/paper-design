// @vitest-environment node
/**
 * Regression tests for CDR layer structure import (page > gobj > layr).
 *
 * Production X4 files carry the layer stack under each page's `gobj` list;
 * before the fix every object landed flat on one layer and layer names were
 * lost. These tests lock the split: named layers in paint order (bottom
 * first), per-layer standalone SVGs, guides layers excluded with a warning,
 * unnamed layers kept empty-named for the engine to name, and master pages
 * still skipped.
 */
import { describe, it, expect } from 'vitest'
import { parseCdrBytes } from './cdr-to-svg'
import {
  buildLayeredLegacyCdr,
  buildMinimalLegacyCdr,
} from './cdr-legacy-test-fixture'

describe('legacy CDR layer structure (gobj > layr)', () => {
  it('splits a page into named layers in paint order', async () => {
    const doc = await parseCdrBytes(
      buildLayeredLegacyCdr({
        outlineId: 9,
        layers: [
          { name: '图层 1', kind: 0, color: [255, 0, 0] },
          { name: 'Notes', kind: 0, color: [0, 0, 255] },
        ],
      }),
    )
    const layers = doc.pages[0].layers
    expect(layers).toHaveLength(2)
    // Paint order: the file's second layer renders first (bottom).
    expect(layers![0].name).toBe('Notes')
    expect(layers![1].name).toBe('图层 1')
    expect(layers![0].kind).toBe(0)
    // Each layer SVG carries only its own artwork.
    expect(layers![0].svg).toContain('fill="#0000ff"')
    expect(layers![0].svg).not.toContain('#ff0000')
    expect(layers![1].svg).toContain('fill="#ff0000"')
    expect(layers![1].svg).not.toContain('#0000ff')
    // The combined page SVG still carries both.
    expect(doc.pages[0].svg).toContain('#ff0000')
    expect(doc.pages[0].svg).toContain('#0000ff')
  })

  it('excludes guides layers from the split and warns', async () => {
    const doc = await parseCdrBytes(
      buildLayeredLegacyCdr({
        outlineId: 9,
        layers: [
          { name: '导线', kind: 12, color: [0, 0, 0] },
          { name: '图层 1', kind: 0, color: [255, 0, 0] },
        ],
      }),
    )
    const layers = doc.pages[0].layers
    expect(layers).toHaveLength(1)
    expect(layers![0].name).toBe('图层 1')
    expect(doc.warnings.some((w) => w.startsWith('Guide lines not imported'))).toBe(true)
  })

  it('keeps unnamed layers empty-named for the engine to name', async () => {
    const doc = await parseCdrBytes(
      buildLayeredLegacyCdr({
        outlineId: 9,
        layers: [{ name: '', kind: 0, color: [0, 255, 0] }],
      }),
    )
    const layers = doc.pages[0].layers
    expect(layers).toHaveLength(1)
    expect(layers![0].name).toBe('')
    expect(layers![0].svg).toContain('data-cdr-object="1"')
  })

  it('still skips master pages entirely', async () => {
    await expect(
      parseCdrBytes(
        buildLayeredLegacyCdr({
          outlineId: 9,
          master: true,
          layers: [{ name: '图层 1', kind: 0, color: [255, 0, 0] }],
        }),
      ),
    ).rejects.toThrow('No convertible pages found')
  })

  it('leaves layerless files without a layers field', async () => {
    const doc = await parseCdrBytes(
      buildMinimalLegacyCdr({
        fillId: 7,
        outlineId: 9,
        fillColorRecord: new Uint8Array(12),
      }),
    )
    expect(doc.pages[0].layers).toBeUndefined()
  })
})
