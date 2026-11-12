// Page splitting for multi-column / two-page-spread facsimiles.
//
// A single rendered PDF page can hold a physical two-page spread and/or several
// text columns sitting side by side. Feeding that whole image to OCR makes the
// model read *across* the columns and jumble the reading order. To fix it we cut
// the page into ordered regions, OCR each region on its own, and stitch the
// results back together in left-to-right reading order.
//
// Everything here works in NORMALIZED fractions (0..1) of the full page image so
// a saved split survives re-rendering the snapshot at any resolution.

export type PageRegion = {
  id: string
  order: number
  x: number
  y: number
  width: number
  height: number
}

let regionIdCounter = 0
function nextRegionId(): string {
  regionIdCounter += 1
  return `region-${regionIdCounter}`
}

/**
 * Convert a sorted list of vertical cut fractions into ordered, full-height
 * regions spanning the page left to right. `[0.5]` → two side-by-side halves;
 * `[0.25, 0.5, 0.75]` → a two-page spread with two columns per side.
 */
export function cutsToRegions(cuts: number[]): PageRegion[] {
  const bounds = [0, ...cuts.filter((cut) => cut > 0 && cut < 1).sort((a, b) => a - b), 1]
  const regions: PageRegion[] = []
  for (let index = 0; index < bounds.length - 1; index += 1) {
    const x = bounds[index]
    const width = bounds[index + 1] - x
    if (width <= 0.001) continue
    regions.push({ id: nextRegionId(), order: regions.length, x, y: 0, width, height: 1 })
  }
  return regions
}

/**
 * Recover the interior vertical cut fractions from a set of full-height regions.
 * Used by the editor UI, which manipulates cut lines rather than region boxes.
 */
export function regionsToCuts(regions: PageRegion[]): number[] {
  return regions
    .map((region) => region.x)
    .filter((x) => x > 0.001 && x < 0.999)
    .sort((a, b) => a - b)
}

export function regionsAreWholePage(regions: PageRegion[] | undefined | null): boolean {
  if (!regions || regions.length === 0) return true
  return regions.length === 1 && regions[0].width >= 0.999 && regions[0].height >= 0.999
}

async function loadImageElement(imageDataUrl: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.decoding = 'async'
  image.src = imageDataUrl
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Unable to load snapshot image for splitting.'))
  })
  return image
}

function boxBlur1d(values: Float32Array, radius: number): Float32Array {
  if (radius <= 0) return values
  const out = new Float32Array(values.length)
  let sum = 0
  for (let i = 0; i < Math.min(radius, values.length); i += 1) sum += values[i]
  for (let i = 0; i < values.length; i += 1) {
    const add = i + radius
    const remove = i - radius - 1
    if (add < values.length) sum += values[add]
    if (remove >= 0) sum -= values[remove]
    const lo = Math.max(0, i - radius)
    const hi = Math.min(values.length - 1, i + radius)
    out[i] = sum / (hi - lo + 1)
  }
  return out
}

export type DetectColumnOptions = {
  /** Width the page is downscaled to before analysis. */
  sampleWidth?: number
  /** Outer fraction of the page ignored so page margins aren't seen as gutters. */
  marginFraction?: number
  /** Minimum gutter width (fraction of page width) to count as a real column break. */
  minGutterFraction?: number
  /** Luminance below this (0..255) counts as ink. */
  inkLuminance?: number
  /** A column is "text" when its ink coverage exceeds this fraction of the 90th-percentile column. */
  textThresholdRatio?: number
  /** Hard cap on detected columns (regions = columns + 1 is bounded by this). */
  maxColumns?: number
}

/**
 * Detect vertical column/spread gutters via a projection profile: binarize the
 * page, measure ink coverage per pixel column, and treat wide low-ink valleys
 * (away from the page margins) as gutters. Returns the cut fractions at the
 * center of each gutter, most-confident (widest) first-limited to maxColumns-1.
 *
 * This is a best-effort detector; the UI lets the user correct the result, so it
 * favors clean printed text and degrades gracefully on figure-heavy pages.
 */
export async function detectColumnCuts(
  imageDataUrl: string,
  options: DetectColumnOptions = {},
): Promise<number[]> {
  const {
    sampleWidth = 900,
    marginFraction = 0.04,
    minGutterFraction = 0.018,
    inkLuminance = 180,
    textThresholdRatio = 0.16,
    maxColumns = 6,
  } = options

  const image = await loadImageElement(imageDataUrl)
  const naturalWidth = image.naturalWidth || 1
  const naturalHeight = image.naturalHeight || 1
  const scale = naturalWidth > sampleWidth ? sampleWidth / naturalWidth : 1
  const width = Math.max(1, Math.round(naturalWidth * scale))
  const height = Math.max(1, Math.round(naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return []
  context.drawImage(image, 0, 0, width, height)
  const { data } = context.getImageData(0, 0, width, height)

  // Ink coverage per column, normalized to [0,1] over the column height.
  const coverage = new Float32Array(width)
  for (let x = 0; x < width; x += 1) {
    let ink = 0
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * 4
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (lum < inkLuminance) ink += 1
    }
    coverage[x] = ink / height
  }

  const smoothed = boxBlur1d(coverage, Math.max(1, Math.round(width * 0.006)))

  // Reference "text darkness" from the 90th-percentile column so a few very dark
  // figure columns don't set the bar. Gutters are columns well below it.
  const sorted = Array.from(smoothed).sort((a, b) => a - b)
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] || 0
  if (p90 <= 0.001) return [] // effectively blank page
  const textThreshold = p90 * textThresholdRatio

  const marginPx = Math.round(width * marginFraction)
  const minGutterPx = Math.max(2, Math.round(width * minGutterFraction))

  // Find maximal low-ink runs inside the non-margin band.
  const gutters: { center: number; span: number }[] = []
  let runStart = -1
  for (let x = marginPx; x <= width - marginPx; x += 1) {
    const below = x < width - marginPx && smoothed[x] <= textThreshold
    if (below && runStart < 0) {
      runStart = x
    } else if (!below && runStart >= 0) {
      const span = x - runStart
      if (span >= minGutterPx) {
        gutters.push({ center: (runStart + x) / 2 / width, span })
      }
      runStart = -1
    }
  }

  // Prefer the widest (most confident) gutters, then present them in reading order.
  gutters.sort((a, b) => b.span - a.span)
  const kept = gutters.slice(0, Math.max(0, maxColumns - 1))
  return kept.map((gutter) => gutter.center).sort((a, b) => a - b)
}

/**
 * Crop one normalized region out of a full-page snapshot image, returning a JPEG
 * data URL suitable for the vision OCR call.
 */
export async function cropRegionFromImage(
  imageDataUrl: string,
  region: PageRegion,
  options: { maxWidth?: number; quality?: number } = {},
): Promise<string> {
  const { maxWidth = 1400, quality = 0.9 } = options
  const image = await loadImageElement(imageDataUrl)
  const naturalWidth = image.naturalWidth || 1
  const naturalHeight = image.naturalHeight || 1

  const sx = Math.max(0, Math.round(region.x * naturalWidth))
  const sy = Math.max(0, Math.round(region.y * naturalHeight))
  const sw = Math.max(1, Math.min(naturalWidth - sx, Math.round(region.width * naturalWidth)))
  const sh = Math.max(1, Math.min(naturalHeight - sy, Math.round(region.height * naturalHeight)))

  const scale = sw > maxWidth ? maxWidth / sw : 1
  const dw = Math.max(1, Math.round(sw * scale))
  const dh = Math.max(1, Math.round(sh * scale))

  const canvas = document.createElement('canvas')
  canvas.width = dw
  canvas.height = dh
  const context = canvas.getContext('2d')
  if (!context) return imageDataUrl
  context.drawImage(image, sx, sy, sw, sh, 0, 0, dw, dh)
  return canvas.toDataURL('image/jpeg', quality)
}
