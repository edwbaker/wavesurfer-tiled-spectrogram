/**
 * Geometry for laying spectrogram tiles out along a wavesurfer.js timeline.
 * Pure functions, so that they can be tested without a browser.
 *
 * Written for the browsers wavesurfer.js 7 supports without a transpiler:
 * no class fields, no `??=`, no `.at()`.
 */

/**
 * The width, in CSS pixels, that wavesurfer.js gives its wrapper for a
 * recording of the given duration. This is the rule in its renderer's
 * render(), used to place tiles before the audio has been decoded, when
 * wavesurfer.js does not yet know the duration itself.
 *
 * @param {number} duration seconds
 * @param {number} minPxPerSec wavesurfer.js `minPxPerSec` option
 * @param {number} containerWidth width of wavesurfer.js's scroll container
 * @param {boolean} fillParent wavesurfer.js `fillParent` option
 * @returns {number}
 */
export function predictedWidth(duration, minPxPerSec, containerWidth, fillParent) {
  const scrollWidth = Math.ceil(duration * (minPxPerSec || 0))
  const scrollable = scrollWidth > containerWidth
  return fillParent !== false && !scrollable ? containerWidth : scrollWidth
}

/**
 * Where a tile goes: its left edge and width in pixels along a timeline
 * `totalWidth` pixels wide for a recording of `duration` seconds. Both edges
 * are rounded from times, so that neighbouring tiles meet with neither a gap
 * nor an overlap.
 *
 * @param {number} start seconds
 * @param {number} end seconds
 * @param {number} duration seconds
 * @param {number} totalWidth pixels
 * @returns {{left: number, width: number}}
 */
export function tileBox(start, end, duration, totalWidth) {
  if (!(duration > 0) || !(totalWidth > 0)) return { left: 0, width: 0 }
  const pxPerSec = totalWidth / duration
  const left = Math.round(start * pxPerSec)
  const right = Math.round(end * pxPerSec)
  return { left: left, width: Math.max(0, right - left) }
}

/**
 * The span of time in view, from the scroll position and the width of the
 * view, clamped to the recording.
 *
 * @param {number} scrollLeft pixels
 * @param {number} viewWidth pixels
 * @param {number} totalWidth pixels
 * @param {number} duration seconds
 * @returns {[number, number]} start and end in seconds
 */
export function visibleTimes(scrollLeft, viewWidth, totalWidth, duration) {
  if (!(totalWidth > 0) || !(duration > 0)) return [0, 0]
  const start = Math.max(0, (scrollLeft / totalWidth) * duration)
  const end = Math.min(duration, ((scrollLeft + viewWidth) / totalWidth) * duration)
  return [start, Math.max(start, end)]
}

/**
 * The indices of the tiles that overlap a span of time, in order.
 *
 * @param {number} start seconds
 * @param {number} end seconds
 * @param {number} tileDuration seconds a tile covers
 * @param {number} tileCount how many tiles there are
 * @param {number} [lookahead] tiles to add on either side
 * @returns {number[]}
 */
export function tilesInView(start, end, tileDuration, tileCount, lookahead) {
  if (!(tileCount > 0) || !(tileDuration > 0)) return []
  const extra = Math.max(0, Math.floor(lookahead || 0))
  // A span ending exactly on a tile boundary does not reach the next tile
  const last = Math.max(start, end - 1e-9)
  const first = Math.max(0, Math.floor(start / tileDuration) - extra)
  const final = Math.min(tileCount - 1, Math.floor(last / tileDuration) + extra)
  const indices = []
  for (let i = first; i <= final; i++) indices.push(i)
  return indices
}

/**
 * Which loaded tiles to let go of so that no more than `maxLoaded` stay, never
 * one that is wanted, and those furthest from the wanted ones first.
 *
 * @param {number[]} loaded indices of the tiles loaded
 * @param {number[]} wanted indices of the tiles in or near the view
 * @param {number} maxLoaded
 * @returns {number[]} indices to unload
 */
export function tilesToUnload(loaded, wanted, maxLoaded) {
  const keep = new Set(wanted)
  const spare = loaded.filter(function (i) { return !keep.has(i) })
  const excess = loaded.length - Math.max(maxLoaded, wanted.length)
  if (excess <= 0 || spare.length === 0) return []
  const centre = wanted.length ? (wanted[0] + wanted[wanted.length - 1]) / 2 : 0
  spare.sort(function (a, b) { return Math.abs(b - centre) - Math.abs(a - centre) })
  return spare.slice(0, Math.min(excess, spare.length))
}
