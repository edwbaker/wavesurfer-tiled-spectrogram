import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseManifest, tileSpan, tileUrl } from '../src/manifest.js'

function aManifest(changes) {
  return Object.assign({
    type: 'tiled-spectrogram',
    version: 1,
    duration: 571.9,
    tileDuration: 59.98,
    tileCount: 10,
    tiles: '{index}.jpg',
    frequencyMax: 22050,
  }, changes)
}

test('a good manifest is kept, with what may be left out filled in', () => {
  const m = normaliseManifest(aManifest({}))
  assert.equal(m.tileCount, 10)
  assert.equal(m.frequencyMin, 0)
  assert.equal(m.frequencyScale, 'linear')
  assert.equal(normaliseManifest(aManifest({ tileCount: undefined })).tileCount, 10)
})

test('a minor version is read, a major one this code does not know is not', () => {
  assert.equal(normaliseManifest(aManifest({ version: 1.3 })).version, 1.3)
  assert.throws(() => normaliseManifest(aManifest({ version: 2 })), /version 2 is not supported/)
})

test('a manifest of another kind, or with impossible values, is refused', () => {
  assert.throws(() => normaliseManifest(null), /not an object/)
  assert.throws(() => normaliseManifest(aManifest({ type: 'peaks' })), /type/)
  assert.throws(() => normaliseManifest(aManifest({ duration: 0 })), /duration/)
  assert.throws(() => normaliseManifest(aManifest({ tileDuration: -1 })), /tileDuration/)
  assert.throws(() => normaliseManifest(aManifest({ tileCount: 9 })), /do not cover/)
  assert.throws(() => normaliseManifest(aManifest({ tileCount: 2.5 })), /whole number/)
  assert.throws(() => normaliseManifest(aManifest({ tiles: 'tile.jpg' })), /\{index\}/)
  assert.throws(() => normaliseManifest(aManifest({ tiles: ['a.jpg'] })), /tileCount entries/)
  assert.throws(() => normaliseManifest(aManifest({ frequencyMax: undefined })), /frequencyMax/)
  assert.throws(() => normaliseManifest(aManifest({ frequencyMin: 30000 })), /frequency range/)
})

test('tiles are found beside their manifest', () => {
  const m = normaliseManifest(aManifest({}))
  assert.equal(tileUrl(m, 3, 'https://files.example.org/spectrograms/x/1/index.json'),
    'https://files.example.org/spectrograms/x/1/3.jpg')
  assert.equal(tileUrl(m, 3), '3.jpg')
  const listed = normaliseManifest(aManifest({ tileCount: 10, tiles: Array.from({ length: 10 }, (_, i) => 'img/' + i + '.png') }))
  assert.equal(tileUrl(listed, 2, 'https://h.example/a/index.json'), 'https://h.example/a/img/2.png')
  const twice = normaliseManifest(aManifest({ tiles: '{index}/{index}.jpg' }))
  assert.equal(tileUrl(twice, 4), '4/4.jpg')
})

test('every tile spans tileDuration, the last ending with the recording', () => {
  const m = normaliseManifest(aManifest({}))
  assert.deepEqual(tileSpan(m, 0), [0, 59.98])
  const last = tileSpan(m, 9)
  assert.ok(Math.abs(last[0] - 539.82) < 1e-9)
  assert.equal(last[1], 571.9)
})
