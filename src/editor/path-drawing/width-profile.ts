/**
 * Width profiles: variable-width strokes as reusable data.
 *
 * Paper.js strokes are uniform, so a variable width can only be drawn by
 * expanding the stroke into a filled outline. The Width tool used to build
 * that outline inline and throw the profile away, which made the width a
 * one-shot destructive step: nothing could be adjusted afterwards and the same
 * shape could not be applied to another path.
 *
 * The profile is therefore the source of truth and the outline is its
 * rendering. A profile is a list of stops (offset along the path, width
 * multiplier), which is exactly what AI stores, and it is kept on the item so
 * the shape can be re-expanded after an edit, plus in a named library so the
 * same shape can be applied to other paths.
 *
 * This module is deliberately free of engine state: it takes a paper scope and
 * a path, so the geometry is unit testable without a canvas.
 */
import type paper from 'paper'

/** One profile stop: normalized offset along the path, width multiplier. */
export interface WidthStop {
  offset: number
  scale: number
}

/** A named, reusable variable-width shape. */
export interface WidthProfile {
  id: string
  name: string
  /** Stroke width the multipliers apply to, in document units. */
  baseWidth: number
  stops: WidthStop[]
}

/** Multiplier bounds, matching what the Width tool drag allows. */
export const MIN_SCALE = 0.05
export const MAX_SCALE = 5

/** A flat profile: the stroke as it was, everywhere. */
export function flatStops(): WidthStop[] {
  return [{ offset: 0, scale: 1 }, { offset: 1, scale: 1 }]
}

/** One number out of untrusted input, or null when it is not a number. */
function finiteOrNull(value: unknown): number | null {
  // `Number(null)`, `Number('')` and `Number([])` are all 0, which would turn
  // missing data into a fully pinched stop.
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Clamp one stop into range, keeping its offset ordered to [0, 1]. */
export function clampStop(stop: WidthStop): WidthStop {
  const scale = finiteOrNull(stop.scale)
  return {
    offset: Math.min(1, Math.max(0, finiteOrNull(stop.offset) ?? 0)),
    // A zero scale is a real value (a fully pinched stop), not a missing one,
    // so it must not fall through to the default the way `|| 1` would.
    scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale ?? 1)),
  }
}

/** Stops sorted by offset, clamped, with any duplicate offset collapsed. */
export function normalizeStops(stops: unknown): WidthStop[] {
  if (!Array.isArray(stops)) return flatStops()
  const clean = stops
    .filter((s): s is WidthStop => !!s && typeof s === 'object')
    // The raw values go to clampStop, not pre-converted numbers: Number(null)
    // is 0, and a missing scale must not read as a fully pinched stop.
    .map((s) => clampStop(s))
    .sort((a, b) => a.offset - b.offset)
  const out: WidthStop[] = []
  for (const stop of clean) {
    // Two stops at the same offset are ambiguous: keep the first, so a profile
    // never renders as a zero-width jump.
    if (out.length && Math.abs(out[out.length - 1].offset - stop.offset) < 1e-6) continue
    out.push(stop)
  }
  // A single stop is a legal profile (a constant width), so only an empty or
  // unusable list falls back to the canonical flat pair.
  return out.length ? out : flatStops()
}

/**
 * Tolerant parse of a stored profile.
 *
 * Profiles arrive from saved documents and imported files, where a field can
 * be missing or a string: a profile that fails to parse would otherwise take
 * the whole item down with it.
 */
export function normalizeProfile(raw: unknown, fallbackId = '', fallbackName = 'Profile'): WidthProfile {
  const src = (raw ?? {}) as Partial<WidthProfile>
  const baseWidth = Number(src.baseWidth)
  return {
    id: typeof src.id === 'string' && src.id ? src.id : fallbackId,
    name: (typeof src.name === 'string' && src.name.trim() ? src.name : fallbackName).slice(0, 40),
    baseWidth: Number.isFinite(baseWidth) && baseWidth > 0 ? baseWidth : 1,
    stops: normalizeStops(src.stops),
  }
}

/** Build a profile from raw stops. */
export function makeProfile(
  id: string,
  name: string,
  baseWidth: number,
  stops: WidthStop[]
): WidthProfile {
  return normalizeProfile({ id, name, baseWidth, stops })
}

/** Piecewise-linear width multiplier at a normalized offset. */
export function scaleAt(profile: WidthProfile, u: number): number {
  const stops = profile.stops
  if (stops.length === 0) return 1
  if (u <= stops[0].offset) return stops[0].scale
  for (let i = 1; i < stops.length; i++) {
    if (u <= stops[i].offset) {
      const a = stops[i - 1]
      const b = stops[i]
      const span = b.offset - a.offset || 1
      const t = (u - a.offset) / span
      return a.scale + (b.scale - a.scale) * t
    }
  }
  return stops[stops.length - 1].scale
}

/** Widest point of the profile, in document units. */
export function profileMaxWidth(profile: WidthProfile): number {
  return profile.baseWidth * Math.max(...profile.stops.map((s) => s.scale), 0)
}

/**
 * Expand a stroked path into a filled variable-width outline.
 *
 * Rails are sampled along the centerline and joined with round caps on open
 * paths; a closed path gets no caps, since there is no end to cap. The result
 * inherits the source's stroke paint, opacity and blend mode, because the
 * stroke it replaces was what carried them.
 */
export function expandVariableWidth(
  scope: typeof paper,
  path: paper.Path,
  profile: WidthProfile
): paper.Path | null {
  const length = path.length
  if (!(length > 0) || !(profile.baseWidth > 0)) return null
  const samples = Math.min(160, Math.max(24, Math.ceil(length / 2)))
  const left: paper.Point[] = []
  const right: paper.Point[] = []
  const radii: number[] = []
  for (let i = 0; i <= samples; i++) {
    const offset = (i / samples) * length
    const pt = path.getPointAt(offset)
    const tangent = path.getTangentAt(offset)
    if (!pt || !tangent || tangent.length < 1e-9) return null
    const normal = new scope.Point(-tangent.y, tangent.x).normalize()
    const r = (profile.baseWidth / 2) * scaleAt(profile, i / samples)
    radii.push(r)
    left.push(pt.add(normal.multiply(r)))
    right.push(pt.subtract(normal.multiply(r)))
  }
  const outline = new scope.Path({ insert: false }) as paper.Path
  if (path.closed) {
    left.forEach((pt) => outline.add(new scope.Segment(pt.clone())))
    for (let i = right.length - 1; i >= 0; i--) {
      outline.add(new scope.Segment(right[i].clone()))
    }
    outline.closed = true
  } else {
    addCap(scope, outline, left[0], right[0], radii[0], false)
    left.forEach((pt) => outline.add(new scope.Segment(pt.clone())))
    addCap(scope, outline, left[left.length - 1], right[right.length - 1], radii[radii.length - 1], true)
    for (let i = right.length - 1; i >= 0; i--) {
      outline.add(new scope.Segment(right[i].clone()))
    }
    outline.closed = true
  }
  const anyPath = path as any
  outline.fillColor = anyPath.strokeColor?.clone?.() ?? anyPath.strokeColor
  outline.strokeColor = null
  outline.opacity = anyPath.opacity ?? 1
  if (anyPath.blendMode !== undefined) outline.blendMode = anyPath.blendMode
  return outline
}

/** Semicircle fan between the rail ends (a round cap). */
function addCap(
  scope: typeof paper,
  outline: paper.Path,
  left: paper.Point,
  right: paper.Point,
  radius: number,
  atEnd: boolean
): void {
  if (!(radius > 0)) return
  const center = left.add(right).multiply(0.5)
  const baseAngle = (Math.atan2(left.y - center.y, left.x - center.x) * 180) / Math.PI
  const steps = 8
  for (let i = 1; i < steps; i++) {
    const sweep = atEnd ? -180 : 180
    const angle = baseAngle + (sweep * i) / steps
    const rad = (angle * Math.PI) / 180
    outline.add(
      new scope.Segment(
        new scope.Point(center.x + Math.cos(rad) * radius, center.y + Math.sin(rad) * radius)
      )
    )
  }
}

/**
 * The built-in library.
 *
 * These are the shapes an artist reaches for first, and shipping them means
 * the feature is usable before anything has been saved: a plain flat stroke
 * has no profile to reuse, so an empty library would leave the panel inert.
 */
export function defaultWidthProfiles(): WidthProfile[] {
  return [
    makeProfile('builtin-flat', 'Flat', 1, flatStops()),
    makeProfile('builtin-taper', 'Taper', 1, [
      { offset: 0, scale: 0.05 },
      { offset: 0.5, scale: 1 },
      { offset: 1, scale: 0.05 },
    ]),
    makeProfile('builtin-spike', 'Spike', 1, [
      { offset: 0, scale: 1 },
      { offset: 0.35, scale: 0.1 },
      { offset: 0.6, scale: 2.4 },
      { offset: 1, scale: 0.1 },
    ]),
    makeProfile('builtin-ribbon', 'Ribbon', 1, [
      { offset: 0, scale: 0.35 },
      { offset: 0.25, scale: 1 },
      { offset: 0.75, scale: 0.7 },
      { offset: 1, scale: 0.15 },
    ]),
  ]
}
