/**
 * The manifest that describes a tiled spectrogram (see SPEC.md): checking it,
 * and finding its tiles. Pure functions, so that they can be tested without a
 * browser.
 */

export const MANIFEST_TYPE = 'tiled-spectrogram'
export const MANIFEST_VERSION = 1

function positive(value, name) {
  const n = Number(value)
  if (!(n > 0) || !isFinite(n)) throw new Error('Manifest ' + name + ' must be a positive number')
  return n
}

/**
 * A manifest checked, with the values that may be left out filled in. Throws
 * an Error saying what is wrong with one that cannot be shown: another type,
 * a major version this code does not know, or missing or impossible values.
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
  const tileDuration = positive(manifest.tileDuration, 'tileDuration')
  const tileCount = manifest.tileCount == null ? Math.ceil(duration / tileDuration) : Number(manifest.tileCount)
  if (!(tileCount >= 1) || Math.floor(tileCount) !== tileCount) throw new Error('Manifest tileCount must be a whole number of at least 1')
  if (tileCount < Math.ceil(duration / tileDuration - 1e-9)) throw new Error('Manifest tiles do not cover its duration')

  const tiles = manifest.tiles
  if (Array.isArray(tiles)) {
    if (tiles.length !== tileCount) throw new Error('Manifest tiles list does not have tileCount entries')
  } else if (typeof tiles !== 'string' || tiles.indexOf('{index}') < 0) {
    throw new Error('Manifest tiles must be a list or a template holding {index}')
  }

  const frequencyMin = manifest.frequencyMin == null ? 0 : Number(manifest.frequencyMin)
  const frequencyMax = positive(manifest.frequencyMax, 'frequencyMax')
  if (!(frequencyMin >= 0) || !(frequencyMin < frequencyMax)) throw new Error('Manifest frequency range is impossible')

  return Object.assign({}, manifest, {
    duration: duration,
    tileDuration: tileDuration,
    tileCount: tileCount,
    frequencyMin: frequencyMin,
    frequencyMax: frequencyMax,
    frequencyScale: manifest.frequencyScale || 'linear',
  })
}

/**
 * The address of a tile, resolved against the address of its manifest, or as
 * it is where there is no base to resolve it against.
 *
 * @param {object} manifest normalised manifest
 * @param {number} index
 * @param {string} [baseUrl] address of the manifest
 * @returns {string}
 */
export function tileUrl(manifest, index, baseUrl) {
  const name = Array.isArray(manifest.tiles)
    ? manifest.tiles[index]
    : manifest.tiles.split('{index}').join(String(index))
  return baseUrl ? new URL(name, baseUrl).href : name
}

/**
 * The span of the recording a tile shows, in seconds. Every tile but the last
 * covers tileDuration; the last ends with the recording.
 *
 * @param {object} manifest normalised manifest
 * @param {number} index
 * @returns {[number, number]}
 */
export function tileSpan(manifest, index) {
  const start = index * manifest.tileDuration
  return [start, Math.min(start + manifest.tileDuration, manifest.duration)]
}
