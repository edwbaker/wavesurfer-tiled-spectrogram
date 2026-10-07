# wavesurfer-tiled-spectrogram

A [wavesurfer.js](https://wavesurfer.xyz) plugin that shows a spectrogram made
in advance, from image tiles. Only the tiles near what is on screen are
fetched.

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
- **Follows the player:** they scroll and zoom with the waveform, under its
  regions and cursor.
- **Simple format:** a manifest plus images ([SPEC.md](SPEC.md)), made by
  [tools/make-tiles.sh](tools/make-tiles.sh) with ffmpeg, or by anything else
  that writes the same format.
- **Small and dependency-free:** about 10 KB minified, and works with
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

- **Levels:** tiles made by `make-tiles.sh` with its defaults look like the
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
the tiles do, and the tiles are better shown alone. To decide before making the
player, fetch the manifest and check it with
`TiledSpectrogram.normaliseManifest(manifest)`, then pass it as the `manifest`
option.

### As the spectrogram, with no audio decoded

Given precomputed waveform peaks as well, wavesurfer.js can stream the audio
instead of downloading and decoding it, and the tiles are the spectrogram:

```js
WaveSurfer.create({ container: '#player', plugins: [tiles] })
  .load('/audio/long.wav', peaks, duration)
```

This is what lets a recording too long, or too high in sample rate, for the
browser to decode be shown and played.

### One recording per plugin

A plugin shows the tiles of one manifest, and does not follow `ws.load()` to
another recording. Make a new player, with a new plugin, for each recording.

### Making tiles

```sh
tools/make-tiles.sh recording.wav out/recording/
```

This writes `out/recording/0.jpg`, `1.jpg`, … and `index.json`.

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
  levels (`--gain-db`, `--range-db`), JPEG quality, and for a folder `--jobs`
  and `--force`.
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
| `tileload` | A tile has arrived; the listener is passed its index. |
| `ready` | The tiles in view have all arrived (or failed). |
| `error` | The manifest or a tile could not be had. A tile is never retried. |
| `handover` | The Spectrogram plugin is ready, and the tiles have moved beneath it. No more are fetched. |

## Methods

`getManifest()`, `getFrequencyRange()` (`{min, max}` in Hz, for drawing an
axis), `show()`, `hide()`, `handOver(spectrogramPlugin)`.

`TiledSpectrogram.normaliseManifest(manifest)` checks a manifest as the plugin
will. It returns the manifest with what may be left out filled in, or throws
an Error saying what is wrong.

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
npm run samples   # the demo's sample recording and tiles (needs ffmpeg)
npm run serve     # the demo at http://localhost:8800/demo/
```

The demo compares the tiles with the Spectrogram plugin (`?mode=tiles`,
`?mode=builtin`, `?mode=preview`), with either wavesurfer.js 7 or 8 (`?ws=8`).

## Licence

MIT. See [LICENSE](LICENSE).
