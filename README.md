# wavesurfer-tiled-spectrogram

A [wavesurfer.js](https://wavesurfer.xyz) plugin that shows a spectrogram made
in advance, from image tiles. Only the tiles near what is on screen are
fetched. Try it in the
[live demo](https://wavesurfer-tiled-spectrogram.acousti.cloud/demo/).

wavesurfer.js's own Spectrogram plugin has to download and decode the whole
recording, then run an FFT over all of it, before it can draw anything. For a
long recording that takes tens of seconds, and for very long or ultrasonic ones
the browser may not manage it at all. Tiles made beforehand can be shown at
once, whatever the recording's length or sample rate.

- **Stand-in or standalone:** the tiles can stand in for the Spectrogram
  plugin until it has drawn its own, then give way without the layout moving.
  Or they can be the spectrogram on their own, needing no decoded audio at
  all.
- **Lazy loading:** tiles are fetched only as they come into view, and let go
  of when far away, so hours of audio cost no more than seconds.
- **Zooms out:** a manifest can hold the spectrogram at several resolutions.
  Zoomed out, a coarser one is shown, so a whole recording of hours on screen
  takes a tile or two, not hundreds.
- **Follows the player:** they scroll and zoom with the waveform, under its
  regions and cursor.
- **Simple format:** a manifest plus images ([SPEC.md](SPEC.md)), made by
  [tools/make-tiles.sh](tools/make-tiles.sh) with ffmpeg, or by anything else
  that writes the same format.
- **Small and dependency-free:** about 12 KB minified, and works with
  wavesurfer.js 7.10 and 8.

## Installation

```sh
npm install wavesurfer-tiled-spectrogram
```

Or with a script tag, after wavesurfer.js's own:

```html
<script src="https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.min.js"></script>
<script src="https://unpkg.com/wavesurfer-tiled-spectrogram/dist/tiled-spectrogram.min.js"></script>
<!-- WaveSurfer.TiledSpectrogram is now defined -->
```

The ES module imports wavesurfer.js's `BasePlugin`
(`wavesurfer.js/dist/base-plugin.js`). Use it with a bundler, or an import map
in the browser. The script-tag build carries its own copy and needs nothing
but wavesurfer.js.

## Usage

```js
import WaveSurfer from 'wavesurfer.js'
import TiledSpectrogram from 'wavesurfer-tiled-spectrogram'

const tiles = TiledSpectrogram.create({ url: '/spectrograms/rec1/index.json', height: 120 })

const ws = WaveSurfer.create({
  container: '#player',
  url: '/audio/rec1.wav',
  minPxPerSec: 344,
  plugins: [tiles],
})
```

### As a stand-in for the Spectrogram plugin

Register the tiles **before** the Spectrogram plugin, and hand over to it:

```js
import Spectrogram from 'wavesurfer.js/dist/plugins/spectrogram.js'

const tiles = TiledSpectrogram.create({ url: '/spectrograms/rec1/index.json', height: 120 })
const spectrogram = Spectrogram.create({ height: 120, scale: 'linear', colorMap: 'gray' })
WaveSurfer.create({
  container: '#player',
  url: '/audio/rec1.wav',
  sampleRate: 44100, // the recording's own
  plugins: [tiles, spectrogram],
})
tiles.handOver(spectrogram)
```

The Spectrogram plugin has no height until it has drawn. When it is ready, the
tiles are lifted out of the flow where they are and it moves up into their
place, so nothing on the page moves. It then paints over them, which for a long
recording takes some seconds, and until it has they show through wherever it
has yet to paint.

For the two to look the same:

- **Loudness:** tiles made by `make-tiles.sh` with its defaults look like the
  Spectrogram plugin with `scale: 'linear'`, `colorMap: 'gray'`, and its own
  defaults for `fftSamples`, `gainDB` and `rangeDB`. Give `make-tiles.sh` the
  same `--gain-db` and `--range-db` as the plugin if you change them. A
  manifest's `dbRange` says which they were: `gainDB` is `-dbRange[1]`, and
  `rangeDB` is `dbRange[1] - dbRange[0]`.
- **Frequencies:** wavesurfer.js decodes audio at its `sampleRate` option,
  8000 Hz unless it is set, and the Spectrogram plugin shows up to half that.
  Set it to the recording's own rate to show what the tiles show, up to their
  `frequencyMax`.
- **Height:** give both plugins the same `height`.
- **Colours:** give both plugins the same `colorMap` (see [Colours](#colours)).

Where the browser cannot decode the recording at its own rate (very high
sample rates, or hours of audio), the Spectrogram plugin will show less than
the tiles do, and the tiles are better shown alone (see
[Choosing between the two](#choosing-between-the-two)).

### As the spectrogram, with no audio decoded

Given the recording's waveform peaks as well, wavesurfer.js can stream the
audio instead of downloading and decoding it, and the tiles are the
spectrogram. This is what lets a recording too long, or too high in sample
rate, for the browser to decode be shown and played.

`make-tiles.sh` writes the peaks beside the tiles, a file for each level in the
BBC audiowaveform JSON format, and the manifest lists them.
`TiledSpectrogram.choosePeaks()` chooses between them as the plugin chooses
between levels. wavesurfer.js draws the same peaks at every zoom, so choose
them for the most the player will zoom in to:

```js
const manifestUrl = new URL('/spectrograms/long/index.json', location.href)
const manifest = TiledSpectrogram.normaliseManifest(await (await fetch(manifestUrl)).json())
const entry = TiledSpectrogram.choosePeaks(manifest, 344)
const peaks = await (await fetch(TiledSpectrogram.peaksUrl(entry, manifestUrl.href))).json()

const tiles = TiledSpectrogram.create({ manifest, baseUrl: manifestUrl.href })
WaveSurfer.create({ container: '#player', minPxPerSec: 344, plugins: [tiles] })
  .load('/audio/long.wav', [peaks.data.map((v) => v / (peaks.bits === 8 ? 128 : 32768))], manifest.duration)
```

A player that only ever shows the whole recording, such as an overview, needs
much less: an hour at 44.1 kHz shown 1000 pixels wide needs the coarsest
peaks, about 5,000 points rather than the finest's 310,000.

### Choosing between the two

What matters is the rate the browser will decode the recording at: its own
where it is short, less where decoding all of it would take too much memory
(decoded audio takes 4 bytes a sample of each channel). Where that shows all
that the tiles do, they stand in for the Spectrogram plugin; where it does
not, they are the spectrogram:

```js
// decodeRate: the rate wavesurfer.js is to decode this recording at
async function makePlayer(container, audioUrl, manifestUrl, decodeRate) {
  const minPxPerSec = 344
  const base = new URL(manifestUrl, location.href)
  const manifest = TiledSpectrogram.normaliseManifest(await (await fetch(base)).json())
  const tiles = TiledSpectrogram.create({ manifest, baseUrl: base.href })

  if (manifest.frequencyMax <= decodeRate / 2 || manifest.peaks.length === 0) {
    const spectrogram = Spectrogram.create({ scale: 'linear', colorMap: 'gray' })
    const ws = WaveSurfer.create({ container, url: audioUrl, sampleRate: decodeRate, minPxPerSec, plugins: [tiles, spectrogram] })
    tiles.handOver(spectrogram)
    return ws
  }

  const entry = TiledSpectrogram.choosePeaks(manifest, minPxPerSec)
  const peaks = await (await fetch(TiledSpectrogram.peaksUrl(entry, base.href))).json()
  const ws = WaveSurfer.create({ container, minPxPerSec, plugins: [tiles] })
  ws.load(audioUrl, [peaks.data.map((v) => v / (peaks.bits === 8 ? 128 : 32768))], manifest.duration)
  return ws
}
```

A manifest without peaks falls back to decoding here, as the waveform needs
something to be drawn from.

### Levels

A manifest can hold the spectrogram at several resolutions, its levels. The
plugin shows the coarsest level that has a column for every pixel it draws,
or the finest where none has, and changes level as the player zooms. Until the
new level's tiles in view have arrived, those of the level before stay beneath
them, so zooming never leaves a gap. Once handed over to the Spectrogram
plugin, the tiles stay at the level they were.

`make-tiles.sh` makes the finest level at about 86 columns a second, and each
coarser one with four times fewer, until one tile covers the whole recording.
The coarser levels add about a third to the space the tiles take. Above 96 kHz
it starts a level finer, at about 344 columns a second in 15-second tiles, as
a column of 86 a second would there combine several FFT windows: zoomed in,
short ultrasonic pulses then keep their timing.

### One recording per plugin

A plugin shows the tiles of one manifest, and does not follow `ws.load()` to
another recording. Make a new player, with a new plugin, for each recording.

### Making tiles

```sh
tools/make-tiles.sh recording.wav out/recording/
```

This writes `out/recording/index.json`, and each level's tiles in a folder
named by its samples a column: `512/0.jpg`, `512/1.jpg`, …, then `2048/0.jpg`,
… for a recording at 44.1 kHz. Beside them go the recording's waveform peaks, a
file for each level (`peaks-512.json`, …), left out with `--no-peaks`.

Given a folder, it tiles every audio file in it and in the folders within it,
into the same paths under the output folder:

```sh
tools/make-tiles.sh --jobs 4 sounds/ tiles/
```

So `sounds/site1/rec1.wav` is tiled into `tiles/site1/rec1/`, and a page can
find any recording's manifest from the recording's own path. Recordings
already tiled are passed over, so a run that stopped can be started again
(`--force` tiles them again). One that fails stops none of the others; the run
ends by listing them, and exits with an error if there were any.

- Run it with `--help` for its options: tile length, resolution, channel,
  loudness (`--gain-db`, `--range-db`), JPEG quality, `--no-peaks`, and for a
  folder `--jobs` and `--force`.
- It needs bash, ffmpeg and ffprobe. On Windows, run it from Git Bash or WSL.
- It writes only into a folder that is empty or holds tiles it made before,
  which it replaces, so a mistaken output folder is refused, not overwritten.
- While it works it keeps the channel shown as a 32-bit WAV in the temporary
  folder (`TMPDIR`): about 640 MB for an hour at 44.1 kHz.
- Tiles can be made by anything else that writes the format in
  [SPEC.md](SPEC.md). The plugin shows whatever images it is given, so they
  need not be greyscale.

## Options

| Option | Default | |
|---|---|---|
| `url` | | Address of the manifest. |
| `manifest` | | The manifest itself, instead of `url`. |
| `baseUrl` | page address | Where tiles are resolved from when `manifest` is given. |
| `height` | `120` | CSS pixels high. |
| `lookahead` | `1` | Tiles to fetch on either side of those in view. |
| `maxLoaded` | `12` | Tiles kept at most; the furthest from view are let go first. |
| `colorMap` | `'gray'` | How grey tiles are coloured: `'gray'` as they are, `'igray'` inverted, or a list of 256 colours (see [Colours](#colours)). |

## Colours

Tiles whose manifest says `"colorMap": "gray"`, as `make-tiles.sh` makes them,
can be shown in any colours. The `colorMap` option takes them in the same forms
as wavesurfer.js's Spectrogram plugin, so that the two can be given the same:

- `'gray'`: the tiles as they are, white quiet and black loud.
- `'igray'`: inverted, black quiet and white loud.
- A list of 256 `[r, g, b, a]` colours, each from 0 to 1, from the quietest
  level to the loudest.

The Spectrogram plugin's own default, `'roseus'`, is not built in here: to use
other colours, give both plugins the same list.

```js
// From black through red and yellow to white
const heat = Array.from({ length: 256 }, (_, i) => {
  const t = i / 255
  return [Math.min(1, 3 * t), Math.min(1, Math.max(0, 3 * t - 1)), Math.max(0, 3 * t - 2), 1]
})
const tiles = TiledSpectrogram.create({ url: '/spectrograms/rec1/index.json', colorMap: heat })
const spectrogram = Spectrogram.create({ scale: 'linear', colorMap: heat })
```

Each tile is recoloured in the browser, which has to read its pixels. Tiles on
another site than the page's therefore need that site to allow it with CORS
(`Access-Control-Allow-Origin`). Where it does not, they are shown grey, and
the console says why. Tiles that are not grey are always shown as they are.

## Events

| Event | |
|---|---|
| `load` | The manifest has been loaded and checked; the listener is passed it. Always after `WaveSurfer.create()` has returned, even when the manifest is given. |
| `level` | The level to show has been chosen, at first or as the player zooms; the listener is passed it, one of the manifest's `levels`. |
| `tileload` | A tile has arrived; the listener is passed its index and its level. |
| `ready` | The tiles in view have all arrived (or failed). |
| `error` | The manifest or a tile could not be had. A tile is never retried. |
| `handover` | The Spectrogram plugin is ready, and the tiles have moved beneath it. No more are fetched. |

## Methods

`getManifest()`, `getLevel()` (the level shown, one of the manifest's
`levels`), `getFrequencyRange()` (`{min, max}` in Hz, for drawing an axis),
`show()`, `hide()`, `handOver(spectrogramPlugin)`.

A page can use these before it makes the player:

- `TiledSpectrogram.normaliseManifest(manifest)` checks a manifest as the
  plugin will. It returns the manifest with what may be left out filled in,
  its `levels` and `peaks` each in order from the finest, and each level given
  its `columnsPerSecond`. Or it throws an Error saying what is wrong.
- `TiledSpectrogram.chooseLevel(manifest, pixelsPerSecond)` and
  `TiledSpectrogram.choosePeaks(manifest, pixelsPerSecond)` give the level, or
  the peaks, for drawing that many pixels a second of the recording.
  `choosePeaks` gives null where the manifest lists none.
- `TiledSpectrogram.peaksUrl(entry, baseUrl)` gives the address of one of the
  manifest's `peaks`, resolved against the manifest's own.

The ES module also exports them by name, with `tileUrl()` and `tileSpan()`.

## Styling

The tiles are inside wavesurfer.js's shadow DOM. Style them with
`::part(tiled-spectrogram)` and `::part(tiled-spectrogram-tile)`. Each tile is
an `img`, or a `canvas` where it has been recoloured.

Before the audio is decoded, wavesurfer.js's Timeline plugin has no height.
Reserving it keeps the tiles from moving down when it fills:

```css
#player ::part(timeline-wrapper) { min-height: 20px; }
```

## Browser support

The same browsers as wavesurfer.js 7, without a transpiler: Chrome and Edge
80+, Firefox 74+, Safari 13.1+. CI checks the builds are ES2020.

## Development

```sh
npm install
npm test          # node --test
npm run build     # dist/: the ES module and the minified UMD build
npm run check     # ES2020 check of dist/
npm run samples   # a test signal and its tiles, for the demo (needs ffmpeg)
npm run serve     # the demo at http://localhost:8800/demo/
```

The demo shows a recording in audioBLAST, given as its source and ID
(`?recording=bio.acousti.ca/10015`), whose audio, tiles and sample rate it looks
up with audioBLAST's API: any recording there with tiles will do. Given none
(`?recording=`), it shows the audio and tiles given instead, by default the test
signal from `npm run samples`. It compares the tiles with the Spectrogram plugin
(`?mode=tiles`, `?mode=builtin`, `?mode=preview`), streams the audio with the
peaks (`?mode=stream`), and takes other colours (`?colorMap=igray`,
`?colorMap=heat`), with wavesurfer.js 8 or 7 (`?ws=7`) from cdn.audioblast.org.
It zooms from 1 to 1000 pixels a second (`?zoom=10` starts at the coarser of the
recording's two levels).

Each push to main publishes the demo to
<https://wavesurfer-tiled-spectrogram.acousti.cloud/> with GitHub Pages
([pages.yml](.github/workflows/pages.yml)), beside the landing page in `site/`.

## Licence

MIT. See [LICENSE](LICENSE).
