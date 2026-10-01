import { test } from 'node:test'
import assert from 'node:assert/strict'
import { predictedWidth, tileBox, tilesInView, tilesToUnload, visibleTimes } from '../src/geometry.js'

test('a recording wider than the view is given its full width', () => {
  assert.equal(predictedWidth(571.9, 344, 711, true), Math.ceil(571.9 * 344))
  assert.equal(predictedWidth(571.9, 344, 711, false), Math.ceil(571.9 * 344))
})

test('a recording narrower than the view fills it, unless told not to', () => {
  //  1.5 s at 344 px/s is 516 px, in a 711 px view
  assert.equal(predictedWidth(1.5, 344, 711, true), 711)
  assert.equal(predictedWidth(1.5, 344, 711, undefined), 711)
  assert.equal(predictedWidth(1.5, 344, 711, false), 516)
})

test('without minPxPerSec a recording fills the view, as wavesurfer.js does', () => {
  assert.equal(predictedWidth(600, 0, 800, true), 800)
  assert.equal(predictedWidth(600, undefined, 800, true), 800)
})

test('neighbouring tiles meet with neither gap nor overlap', () => {
  const duration = 571.9
  const total = 196734
  const T = 59.98
  let right = 0
  for (let i = 0; i * T < duration; i++) {
    const box = tileBox(i * T, Math.min((i + 1) * T, duration), duration, total)
    assert.equal(box.left, right, 'tile ' + i + ' starts where the last ended')
    right = box.left + box.width
  }
  assert.equal(right, total, 'the last tile ends at the end')
})

test('a tile box is empty where there is nothing to lay out against', () => {
  assert.deepEqual(tileBox(0, 60, 0, 1000), { left: 0, width: 0 })
  assert.deepEqual(tileBox(0, 60, 100, 0), { left: 0, width: 0 })
})

test('the time in view follows the scroll, clamped to the recording', () => {
  assert.deepEqual(visibleTimes(0, 700, 7000, 100), [0, 10])
  assert.deepEqual(visibleTimes(3500, 700, 7000, 100), [50, 60])
  assert.deepEqual(visibleTimes(6800, 700, 7000, 100), [97.14285714285714, 100])
  assert.deepEqual(visibleTimes(0, 700, 0, 100), [0, 0])
})

test('the tiles in view are those the span overlaps', () => {
  assert.deepEqual(tilesInView(0, 2, 60, 10, 0), [0])
  assert.deepEqual(tilesInView(59, 61, 60, 10, 0), [0, 1])
  // A span ending on a boundary does not reach the next tile
  assert.deepEqual(tilesInView(0, 60, 60, 10, 0), [0])
  assert.deepEqual(tilesInView(550, 560, 60, 10, 0), [9])
})

test('lookahead adds tiles either side, within the recording', () => {
  assert.deepEqual(tilesInView(0, 2, 60, 10, 1), [0, 1])
  assert.deepEqual(tilesInView(130, 140, 60, 10, 1), [1, 2, 3])
  assert.deepEqual(tilesInView(550, 560, 60, 10, 2), [7, 8, 9])
  assert.deepEqual(tilesInView(0, 2, 60, 0, 1), [])
})

test('tiles furthest from the view are let go first, and none that are wanted', () => {
  assert.deepEqual(tilesToUnload([0, 1, 2, 3, 4], [3, 4], 3), [0, 1])
  // 0 and 9 are as far as each other from the view, so go in either order
  assert.deepEqual(tilesToUnload([0, 1, 2, 8, 9], [4, 5], 3).sort(), [0, 9])
  assert.deepEqual(tilesToUnload([0, 1, 2], [0, 1, 2], 1), [])
  assert.deepEqual(tilesToUnload([0, 1], [5], 12), [])
})
