/**
 * The manifest that describes a tiled spectrogram (see SPEC.md): checking it,
 * choosing between its levels and its peaks, and finding their files. Pure
 * functions, so that they can be tested without a browser.
 */

export const MANIFEST_TYPE = 'tiled-spectrogram'
export const MANIFEST_VERSION = 1

function positive(value, name) {
  const n = Number(value)
  if (!(n > 0) || !isFinite(n)) throw new Error('Manifest ' + name + ' must be a positive number')
  return n
}

// One level checked, with what may be left out filled in, and the columns a
// second it has, by which levels are told apart
function normaliseLevel(level, duration, n) {
  const name = 'level ' + n
  if (!level || typeof level !== 'object') throw new Error('Manifest ' + name + ' is not an object')
  const width = positive(level.width, name + ' width')
  const tileDuration = positive(level.tileDuration, name + ' tileDuration')
  const needed = Math.ceil(duration / tileDuration - 1e-9)
  const tileCount = level.tileCount == null ? needed : Number(level.tileCount)
  if (!(tileCount >= 1) || Math.floor(tileCount) !== tileCount) throw new Error('Manifest ' + name + ' tileCount must be a whole number of at least 1')
  if (tileCount < needed) throw new Error('Manifest ' + name + ' tiles do not cover its duration')

  const tiles = level.tiles
  if (Array.isArray(tiles)) {
    if (tiles.length !== tileCount) throw new Error('Manifest ' + name + ' tiles list does not have tileCount entries')
    if (!tiles.every((address) => typeof address === 'string' && address !== '')) throw new Error('Manifest ' + name + ' tiles list holds something other than addresses')
  } else if (typeof tiles !== 'string' || tiles.indexOf('{index}') < 0) {
    throw new Error('Manifest ' + name + ' tiles must be a list or a template holding {index}')
  }
  return Object.assign({}, level, { width: width, tileDuration: tileDuration, tileCount: tileCount, columnsPerSecond: width / tileDuration })
}

function normalisePeaks(entry, n) {
  const name = 'peaks ' + n
  if (!entry || typeof entry !== 'object') throw new Error('Manifest ' + name + ' is not an object')
  if (typeof entry.url !== 'string' || entry.url === '') throw new Error('Manifest ' + name + ' has no url')
  return Object.assign({}, entry, { pointsPerSecond: positive(entry.pointsPerSecond, name + ' pointsPerSecond') })
}

/**
 * A manifest checked, with the values that may be left out filled in, its
 * levels and its peaks each in order from the finest to the coarsest. Throws an
 * Error saying what is wrong with one that cannot be shown: another type, a
 * major version this code does not know, or missing or impossible values.
 *
 * @param {object} manifest
 * @returns {object}
 */
export function normaliseManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Manifest is not an object')
  if (manifest.type !== MANIFEST_TYPE) throw new Error('Manifest type is not ' + MANIFEST_TYPE)
  const major = Math.floor(Number(manifest.version))
  if (major !== MANIFEST_VERSION) throw new Error('Manifest version ' + manifest.version + ' is not supported')

  const duration = positive(manifest.duration, 'duration')
  if (!Array.isArray(manifest.levels) || manifest.levels.length === 0) throw new Error('Manifest has no levels')
  const levels = manifest.levels.map((level, n) => normaliseLevel(level, duration, n))
  levels.sort((a, b) => b.columnsPerSecond - a.columnsPerSecond)

  let peaks = []
  if (manifest.peaks != null) {
    if (!Array.isArray(manifest.peaks)) throw new Error('Manifest peaks must be a list')
    peaks = manifest.peaks.map(normalisePeaks)
    peaks.sort((a, b) => b.pointsPerSecond - a.pointsPerSecond)
  }

  const frequencyMin = manifest.frequencyMin == null ? 0 : Number(manifest.frequencyMin)
  const frequencyMax = positive(manifest.frequencyMax, 'frequencyMax')
  if (!(frequencyMin >= 0) || !(frequencyMin < frequencyMax)) throw new Error('Manifest frequency range is impossible')

  return Object.assign({}, manifest, {
    duration: duration,
    levels: levels,
    peaks: peaks,
    frequencyMin: frequencyMin,
    frequencyMax: frequencyMax,
    frequencyScale: manifest.frequencyScale || 'linear',
  })
}

// From a list ordered finest first: the coarsest at least as fine as wanted,
// or the finest where none is
function coarsestEnough(list, key, wanted) {
  let best = list[0]
  if (!(wanted > 0)) return best
  for (let i = 0; i < list.length; i++) {
    if (list[i][key] >= wanted * (1 - 1e-9)) best = list[i]
  }
  return best
}

/**
 * The level to show where a player draws `pixelsPerSecond` pixels a second of
 * the recording: the coarsest with at least that many columns a second, so
 * that no column is stretched across pixels of its own, or the finest where
 * none has that many (SPEC.md, Choosing a level).
 *
 * @param {object} manifest normalised manifest
 * @param {number} pixelsPerSecond
 * @returns {object} one of manifest.levels
 */
export function chooseLevel(manifest, pixelsPerSecond) {
  return coarsestEnough(manifest.levels, 'columnsPerSecond', pixelsPerSecond)
}

/**
 * The peaks to draw a waveform from at `pixelsPerSecond` pixels a second,
 * chosen as levels are, or null where the manifest lists none.
 *
 * @param {object} manifest normalised manifest
 * @param {number} pixelsPerSecond
 * @returns {object|null} one of manifest.peaks
 */
export function choosePeaks(manifest, pixelsPerSecond) {
  if (!manifest.peaks || manifest.peaks.length === 0) return null
  return coarsestEnough(manifest.peaks, 'pointsPerSecond', pixelsPerSecond)
}

/**
 * The address of a level's tile, resolved against the address of its manifest,
 * or as it is where there is no base to resolve it against.
 *
 * @param {object} level one of a normalised manifest's levels
 * @param {number} index
 * @param {string} [baseUrl] address of the manifest
 * @returns {string}
 */
export function tileUrl(level, index, baseUrl) {
  const name = Array.isArray(level.tiles)
    ? level.tiles[index]
    : level.tiles.split('{index}').join(String(index))
  return baseUrl ? new URL(name, baseUrl).href : name
}

/**
 * The address of a peaks file, resolved as a tile's is.
 *
 * @param {object} entry one of a normalised manifest's peaks
 * @param {string} [baseUrl] address of the manifest
 * @returns {string}
 */
export function peaksUrl(entry, baseUrl) {
  return baseUrl ? new URL(entry.url, baseUrl).href : entry.url
}

/**
 * The span of the recording a level's tile shows, in seconds. Every tile but
 * the last covers tileDuration; the last ends with the recording.
 *
 * @param {object} level one of a normalised manifest's levels
 * @param {number} index
 * @param {number} duration the recording's, from the manifest
 * @returns {[number, number]}
 */
export function tileSpan(level, index, duration) {
  const start = index * level.tileDuration
  return [start, Math.min(start + level.tileDuration, duration)]
}
