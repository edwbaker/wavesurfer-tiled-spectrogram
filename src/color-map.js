/**
 * Colour maps for tiles whose manifest says "colorMap": "gray", in which grey
 * level g (white quiet, black loud) is loudness 255 - g on a scale from 0
 * (quiet) to 255 (loud). Pure functions, so that they can be tested without a
 * browser.
 */

/**
 * The colour each grey level is shown as: RGBA bytes, four for each of the 256
 * levels, or null where the tiles are to be shown as they are.
 *
 * @param {'gray'|'igray'|Array<number[]>} [colorMap] 'gray' (or nothing): the
 *   tiles as they are; 'igray': inverted, loud white; or 256 [r, g, b, a]
 *   colours, each from 0 to 1, from the quietest level to the loudest, as
 *   wavesurfer.js's Spectrogram plugin takes them
 * @returns {Uint8ClampedArray|null}
 */
export function colorTable(colorMap) {
  if (colorMap == null || colorMap === 'gray') return null
  const table = new Uint8ClampedArray(1024)
  if (colorMap === 'igray') {
    for (let grey = 0; grey < 256; grey++) table.set([255 - grey, 255 - grey, 255 - grey, 255], 4 * grey)
    return table
  }
  if (!Array.isArray(colorMap) || colorMap.length !== 256) {
    throw new Error("colorMap must be 'gray', 'igray' or a list of 256 colours")
  }
  colorMap.forEach((colour, loudness) => {
    const valid = Array.isArray(colour) && colour.length === 4 &&
      colour.every((value) => typeof value === 'number' && value >= 0 && value <= 1)
    if (!valid) throw new Error('colorMap entry ' + loudness + ' is not [r, g, b, a], each from 0 to 1')
    // Rounded as a canvas rounds the Spectrogram plugin's colours
    for (let k = 0; k < 4; k++) table[4 * (255 - loudness) + k] = colour[k] * 255
  })
  return table
}

/**
 * Recolours the RGBA pixels of a grey tile in place: each pixel takes the
 * colour of its grey level, read from its red channel.
 *
 * @param {Uint8ClampedArray} pixels as from a canvas's getImageData()
 * @param {Uint8ClampedArray} table from colorTable()
 */
export function recolor(pixels, table) {
  for (let i = 0; i < pixels.length; i += 4) {
    const at = 4 * pixels[i]
    pixels[i] = table[at]
    pixels[i + 1] = table[at + 1]
    pixels[i + 2] = table[at + 2]
    pixels[i + 3] = table[at + 3]
  }
}
