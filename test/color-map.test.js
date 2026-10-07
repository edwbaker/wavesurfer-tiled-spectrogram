import { test } from 'node:test'
import assert from 'node:assert/strict'
import { colorTable, recolor } from '../src/color-map.js'

// 256 colours from quiet to loud: red rising, blue falling, half opaque
function aColorMap() {
  return Array.from({ length: 256 }, (_, loudness) => [loudness / 255, 0, 1 - loudness / 255, 0.5])
}

function colorOf(table, grey) {
  return Array.from(table.slice(4 * grey, 4 * grey + 4))
}

test("'gray', or no colour map, leaves the tiles as they are", () => {
  assert.equal(colorTable('gray'), null)
  assert.equal(colorTable(undefined), null)
  assert.equal(colorTable(null), null)
})

test("'igray' inverts the tiles, so that loud is white", () => {
  const table = colorTable('igray')
  assert.deepEqual(colorOf(table, 0), [255, 255, 255, 255])
  assert.deepEqual(colorOf(table, 255), [0, 0, 0, 255])
  assert.deepEqual(colorOf(table, 100), [155, 155, 155, 255])
})

test('a list of colours runs from the quietest level, white in a tile, to the loudest, black', () => {
  const table = colorTable(aColorMap())
  assert.deepEqual(colorOf(table, 255), [0, 0, 255, 128], 'white, the quietest, takes the first colour')
  assert.deepEqual(colorOf(table, 0), [255, 0, 0, 128], 'black, the loudest, takes the last')
  assert.deepEqual(colorOf(table, 155), [100, 0, 155, 128], 'grey 155 is loudness 100')
})

test('a colour map that cannot be used is refused', () => {
  assert.throws(() => colorTable('roseus'), /'gray', 'igray' or a list of 256 colours/)
  assert.throws(() => colorTable(aColorMap().slice(1)), /list of 256 colours/)
  const outOfRange = aColorMap()
  outOfRange[7] = [1.5, 0, 0, 1]
  assert.throws(() => colorTable(outOfRange), /entry 7 is not \[r, g, b, a\]/)
  const threeValues = aColorMap()
  threeValues[9] = [1, 0, 0]
  assert.throws(() => colorTable(threeValues), /entry 9/)
})

test('recolouring gives each pixel the colour of its grey level', () => {
  const table = colorTable(aColorMap())
  // Three grey pixels, as a canvas holds a greyscale JPEG: RGBA, R = G = B
  const pixels = new Uint8ClampedArray([0, 0, 0, 255, 155, 155, 155, 255, 255, 255, 255, 255])
  recolor(pixels, table)
  assert.deepEqual(Array.from(pixels), [255, 0, 0, 128, 100, 0, 155, 128, 0, 0, 255, 128])
})
