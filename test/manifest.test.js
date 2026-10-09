import { test } from 'node:test'
import assert from 'node:assert/strict'
import { channelViews, chooseLevel, choosePeaks, normaliseManifest, peaksUrl, tileSpan, tileUrl } from '../src/manifest.js'

// Two levels, listed coarsest first to show they need not be in order: 86 and
// 21.5 columns a second, as make-tiles.sh makes them at 44.1 kHz
function aLevel(samplesPerColumn, changes) {
  const tileDuration = 5168 * samplesPerColumn / 44100
  return Object.assign({
    width: 5168,
    height: 256,
    tileDuration: tileDuration,
    tileCount: Math.ceil(571.9 / tileDuration),
    tiles: samplesPerColumn + '/{index}.jpg',
  }, changes)
}

function aManifest(changes) {
  return Object.assign({
    type: 'tiled-spectrogram',
    version: 1,
    duration: 571.9,
    frequencyMax: 22050,
    levels: [aLevel(2048), aLevel(512)],
  }, changes)
}

function somePeaks() {
  return [{ pointsPerSecond: 21.533203, url: 'peaks-2048.json' }, { pointsPerSecond: 86.132812, url: 'peaks-512.json' }]
}

test('a good manifest is kept, with what may be left out filled in, finest level first', () => {
  const m = normaliseManifest(aManifest({}))
  assert.equal(m.frequencyMin, 0)
  assert.equal(m.frequencyScale, 'linear')
  assert.deepEqual(m.levels.map((level) => level.tiles), ['512/{index}.jpg', '2048/{index}.jpg'])
  assert.ok(Math.abs(m.levels[0].columnsPerSecond - 44100 / 512) < 1e-9)
  assert.equal(m.levels[0].tileCount, 10)
  assert.equal(m.levels[1].tileCount, 3)
  assert.deepEqual(m.peaks, [])

  const counted = normaliseManifest(aManifest({ levels: [aLevel(512, { tileCount: undefined })] }))
  assert.equal(counted.levels[0].tileCount, 10)
  const peaked = normaliseManifest(aManifest({ peaks: somePeaks() }))
  assert.deepEqual(peaked.peaks.map((entry) => entry.url), ['peaks-512.json', 'peaks-2048.json'])
})

test('a minor version is read, a major one this code does not know is not', () => {
  assert.equal(normaliseManifest(aManifest({ version: 1.3 })).version, 1.3)
  assert.throws(() => normaliseManifest(aManifest({ version: 2 })), /version 2 is not supported/)
})

test('a manifest of another kind, or with impossible values, is refused', () => {
  const level = (changes) => aManifest({ levels: [aLevel(512, changes)] })
  assert.throws(() => normaliseManifest(null), /not an object/)
  assert.throws(() => normaliseManifest(aManifest({ type: 'peaks' })), /type/)
  assert.throws(() => normaliseManifest(aManifest({ duration: 0 })), /duration/)
  assert.throws(() => normaliseManifest(aManifest({ levels: [] })), /no levels/)
  assert.throws(() => normaliseManifest(aManifest({ levels: undefined })), /no levels/)
  assert.throws(() => normaliseManifest(aManifest({ levels: [null] })), /level 0 is not an object/)
  assert.throws(() => normaliseManifest(level({ width: 0 })), /level 0 width/)
  assert.throws(() => normaliseManifest(level({ tileDuration: -1 })), /level 0 tileDuration/)
  assert.throws(() => normaliseManifest(level({ tileCount: 9 })), /do not cover/)
  assert.throws(() => normaliseManifest(level({ tileCount: 2.5 })), /whole number/)
  assert.throws(() => normaliseManifest(level({ tiles: 'tile.jpg' })), /\{index\}/)
  assert.throws(() => normaliseManifest(level({ tiles: ['a.jpg'] })), /tileCount entries/)
  assert.throws(() => normaliseManifest(level({ tileCount: 10, tiles: Array(9).fill('a.jpg').concat([null]) })), /other than addresses/)
  assert.throws(() => normaliseManifest(aManifest({ frequencyMax: undefined })), /frequencyMax/)
  assert.throws(() => normaliseManifest(aManifest({ frequencyMin: 30000 })), /frequency range/)
  assert.throws(() => normaliseManifest(aManifest({ peaks: 'peaks.json' })), /peaks must be a list/)
  assert.throws(() => normaliseManifest(aManifest({ peaks: [{ pointsPerSecond: 86 }] })), /peaks 0 has no url/)
  assert.throws(() => normaliseManifest(aManifest({ peaks: [{ url: 'p.json' }] })), /peaks 0 pointsPerSecond/)
})

test('the level shown is the coarsest with a column for every pixel drawn, or else the finest', () => {
  const m = normaliseManifest(aManifest({}))
  const shown = (pixelsPerSecond) => chooseLevel(m, pixelsPerSecond).tiles
  assert.equal(shown(5), '2048/{index}.jpg', 'zoomed out: the coarse level is fine enough')
  assert.equal(shown(21.533203125), '2048/{index}.jpg', 'exactly its columns a second')
  assert.equal(shown(30), '512/{index}.jpg', 'between the two: the finer')
  assert.equal(shown(344), '512/{index}.jpg', 'finer than any: the finest')
  assert.equal(shown(0), '512/{index}.jpg', 'not yet known: the finest')
  assert.equal(shown(NaN), '512/{index}.jpg')
})

test('peaks are chosen as levels are, and there may be none', () => {
  assert.equal(choosePeaks(normaliseManifest(aManifest({})), 86), null)
  const m = normaliseManifest(aManifest({ peaks: somePeaks() }))
  assert.equal(choosePeaks(m, 10).url, 'peaks-2048.json')
  assert.equal(choosePeaks(m, 50).url, 'peaks-512.json')
  assert.equal(choosePeaks(m, 344).url, 'peaks-512.json')
})

test("a level's tiles, and peaks, are found beside their manifest", () => {
  const m = normaliseManifest(aManifest({ peaks: somePeaks() }))
  const base = 'https://files.example.org/spectrograms/x/1/index.json'
  assert.equal(tileUrl(m.levels[0], 3, base), 'https://files.example.org/spectrograms/x/1/512/3.jpg')
  assert.equal(tileUrl(m.levels[1], 2), '2048/2.jpg')
  assert.equal(peaksUrl(m.peaks[0], base), 'https://files.example.org/spectrograms/x/1/peaks-512.json')
  assert.equal(peaksUrl(m.peaks[0]), 'peaks-512.json')
  const listed = normaliseManifest(aManifest({ levels: [aLevel(512, { tiles: Array.from({ length: 10 }, (_, i) => 'img/' + i + '.png') })] }))
  assert.equal(tileUrl(listed.levels[0], 2, 'https://h.example/a/index.json'), 'https://h.example/a/img/2.png')
  const twice = normaliseManifest(aManifest({ levels: [aLevel(512, { tiles: '{index}/{index}.jpg' })] }))
  assert.equal(tileUrl(twice.levels[0], 4), '4/4.jpg')
})

// A stereo recording as make-tiles.sh tiles it: the channels mixed, then each
// on its own in ch0/ and ch1/, ch1's with no peaks
function aStereoManifest(changes) {
  const view = (channel, peaks) => Object.assign({
    channels: [channel],
    levels: [aLevel(2048, { tiles: 'ch' + channel + '/2048/{index}.jpg' }), aLevel(512, { tiles: 'ch' + channel + '/512/{index}.jpg' })],
  }, peaks ? { peaks: [{ pointsPerSecond: 21.533203, url: 'ch' + channel + '/peaks-2048.json' }, { pointsPerSecond: 86.132812, url: 'ch' + channel + '/peaks-512.json' }] } : {})
  return aManifest(Object.assign({ version: 1.1, channelCount: 2, channels: [0, 1], peaks: somePeaks(), views: [view(0, true), view(1, false)] }, changes))
}

test('a manifest of version 1 is one view, of the channel it shows', () => {
  const m = normaliseManifest(aManifest({}))
  assert.equal(m.views.length, 1)
  assert.deepEqual(m.views[0].channels, [0])
  assert.equal(m.views[0].levels, m.levels)
  assert.equal(m.channelCount, 1)
  assert.deepEqual(channelViews(m), [0])

  const right = normaliseManifest(aManifest({ channel: 1 }))
  assert.deepEqual(right.channels, [1])
  assert.equal(right.channelCount, 2)
  assert.deepEqual(channelViews(right), [0])
})

test("a manifest of several channels has their mix as its default view, and each channel's view", () => {
  const m = normaliseManifest(aStereoManifest({}))
  assert.deepEqual(m.views.map((view) => view.channels), [[0, 1], [0], [1]])
  assert.equal(m.channelCount, 2)
  assert.equal(m.views[0].levels, m.levels, 'the default view is the manifest\'s own levels and peaks')
  assert.equal(m.views[0].peaks, m.peaks)
  assert.deepEqual(m.views[2].levels.map((level) => level.tiles), ['ch1/512/{index}.jpg', 'ch1/2048/{index}.jpg'], 'finest first')
  // Levels and peaks are chosen in a view as in the manifest
  assert.equal(chooseLevel(m.views[1], 344).tiles, 'ch0/512/{index}.jpg')
  assert.equal(chooseLevel(m.views[2], 5).tiles, 'ch1/2048/{index}.jpg')
  assert.equal(choosePeaks(m.views[1], 50).url, 'ch0/peaks-512.json')
  assert.equal(choosePeaks(m.views[2], 50), null)
  // Split, each channel's view in channel order
  assert.deepEqual(channelViews(m), [1, 2])
  assert.deepEqual(channelViews(normaliseManifest(aStereoManifest({ views: [m.views[2], m.views[1]].map((view) => ({ channels: view.channels, levels: [aLevel(512)] })) }))), [2, 1])
  // Only the mix: nothing to split
  assert.deepEqual(channelViews(normaliseManifest(aStereoManifest({ views: undefined }))), [])
})

test('a normalised manifest is normalised again unchanged, as a page checking it before the plugin does has it', () => {
  for (const raw of [aManifest({}), aManifest({ channel: 1, peaks: somePeaks() }), aStereoManifest({})]) {
    const once = normaliseManifest(raw)
    const twice = normaliseManifest(once)
    assert.deepEqual(twice, once)
    assert.deepEqual(channelViews(twice), channelViews(once))
  }
  // A view listed of the default's channels is the default
  const listed = normaliseManifest(aStereoManifest({ views: [{ channels: [0, 1], levels: [aLevel(512)] }] }))
  assert.deepEqual(listed.views.map((view) => view.channels), [[0, 1]])
})

test('views, and channels, that cannot be shown are refused', () => {
  assert.throws(() => normaliseManifest(aStereoManifest({ views: 'ch0' })), /views must be a list/)
  assert.throws(() => normaliseManifest(aStereoManifest({ views: [null] })), /view 0 is not an object/)
  assert.throws(() => normaliseManifest(aStereoManifest({ views: [{ levels: [aLevel(512)] }] })), /view 0 channels must list channels/)
  assert.throws(() => normaliseManifest(aStereoManifest({ views: [{ channels: [-1], levels: [aLevel(512)] }] })), /view 0 channels must list channels/)
  assert.throws(() => normaliseManifest(aStereoManifest({ views: [{ channels: [0] }] })), /view 0 has no levels/)
  assert.throws(() => normaliseManifest(aStereoManifest({ views: [{ channels: [0], levels: [aLevel(512, { width: 0 })] }] })), /view 0 level 0 width/)
  assert.throws(() => normaliseManifest(aStereoManifest({ views: [{ channels: [0], levels: [aLevel(512)], peaks: [{}] }] })), /view 0 peaks 0 has no url/)
  assert.throws(() => normaliseManifest(aStereoManifest({ channels: [] })), /channels must list channels/)
  assert.throws(() => normaliseManifest(aStereoManifest({ channelCount: 1 })), /channelCount/)
  assert.throws(() => normaliseManifest(aManifest({ channel: 0.5 })), /channel must be a channel/)
})

test("every tile of a level spans its tileDuration, the last ending with the recording", () => {
  const m = normaliseManifest(aManifest({}))
  const fine = m.levels[0]
  assert.deepEqual(tileSpan(fine, 0, m.duration), [0, fine.tileDuration])
  const last = tileSpan(fine, 9, m.duration)
  assert.ok(Math.abs(last[0] - 9 * fine.tileDuration) < 1e-9)
  assert.equal(last[1], 571.9)
  assert.equal(tileSpan(m.levels[1], 2, m.duration)[1], 571.9)
})
