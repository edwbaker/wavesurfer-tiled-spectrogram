# Tiled spectrogram, version 1

A spectrogram made in advance and cut into images along time, at one or more
resolutions. Each image is a **tile**: a fixed stretch of the recording, all
frequencies. The tiles at one resolution make a **level**. A JSON **manifest**
describes the levels, and may list the recording's **waveform peaks** at one or
more resolutions too. A player fetches the manifest, chooses the level that
suits how much of the recording is on screen, and fetches only that level's
tiles near what is shown. So a spectrogram of hours costs no more to show than
one of seconds, zoomed in or out.

The manifest is `index.json`, normally beside its tiles. It is served as
`application/json`, tiles as their image type, and peaks as
`application/json`. A set of tiles and its manifest never change once made.
Making them differently (another calibration, or other levels) gives a new set
at a new address.

## Manifest

```json
{
  "type": "tiled-spectrogram",
  "version": 1,
  "duration": 571.946667,
  "sampleRate": 44100,
  "channel": 0,
  "frequencyMin": 0,
  "frequencyMax": 22050,
  "frequencyScale": "linear",
  "window": "hann",
  "colorMap": "gray",
  "dbRange": [-100, -20],
  "levels": [
    {
      "width": 5168,
      "height": 256,
      "tileDuration": 60.000362812,
      "tileCount": 10,
      "tiles": "512/{index}.jpg",
      "mimeType": "image/jpeg",
      "samplesPerColumn": 512,
      "pixelsPerSecond": 86.132812,
      "fftSize": 512
    },
    {
      "width": 5168,
      "height": 256,
      "tileDuration": 240.001451247,
      "tileCount": 3,
      "tiles": "2048/{index}.jpg",
      "mimeType": "image/jpeg",
      "samplesPerColumn": 2048,
      "pixelsPerSecond": 21.533203,
      "fftSize": 512
    }
  ],
  "peaks": [
    {"pointsPerSecond": 86.132812, "samplesPerPixel": 512, "url": "peaks-512.json"},
    {"pointsPerSecond": 21.533203, "samplesPerPixel": 2048, "url": "peaks-2048.json"}
  ],
  "renderer": {"name": "ffmpeg showspectrumpic", "scale": "log", "drange": 80, "limit": -18},
  "calibration": "default"
}
```

### The recording

Fields that hold for every level.

#### Required

| Field | Meaning |
|---|---|
| `type` | Always `"tiled-spectrogram"`. |
| `version` | `1`. A reader refuses a major version it does not know. A minor version (e.g. `1.1`) only adds fields, which a reader may ignore. |
| `duration` | Seconds of audio the tiles cover. Every level covers all of it. |
| `frequencyMax` | Hz at the top edge of every tile, in every level. |
| `levels` | One or more levels (below), in any order. |

#### Optional

| Field | Meaning |
|---|---|
| `frequencyMin` | Hz at the bottom edge of every tile; 0 if left out. |
| `frequencyScale` | How frequency runs up a tile; only `"linear"` is defined in version 1. |
| `sampleRate`, `channel`, `window` | How the spectrogram was computed: the recording's sample rate, the channel shown (from 0), and the FFT window. |
| `colorMap` | `"gray"`: white is quiet, black is loud. Grey level *g* is loudness 255 − *g* on a scale from 0 (quiet) to 255 (loud), so a reader can show such tiles in any colours. Tiles without it are shown as they are. |
| `dbRange` | `[quiet, loud]`: the loudness, in dB, shown as the two ends of `colorMap`, in dB measured as wavesurfer.js's Spectrogram plugin measures them, `20 × log10(2 × \|X\| / fftSize)` for each bin of the windowed FFT `X`. The plugin's `gainDB` is `-loud` and its `rangeDB` is `loud - quiet`. |
| `peaks` | The recording's waveform peaks, at one or more resolutions (below). |
| `renderer`, `calibration` | What made the tiles, with what settings, under what name, so that sets made differently can be told apart. |

### Levels

Each entry of `levels` is the whole spectrogram at one resolution.

#### Required

| Field | Meaning |
|---|---|
| `width` | Pixels across a full tile: its columns. A level has `width / tileDuration` columns a second, which is how a reader tells levels apart. |
| `tileDuration` | Seconds each tile of the level covers, exactly. Tile *i* covers `[i × tileDuration, min((i + 1) × tileDuration, duration)]`. The last tile is usually shorter, and its image is correspondingly narrower. |
| `tiles` | Where the level's tiles are. Either a template, in which `{index}` stands for the tile's number from 0, or a list of `tileCount` addresses. Relative addresses are resolved against the manifest's own address. |

#### Optional

| Field | Meaning |
|---|---|
| `tileCount` | How many tiles the level has; `ceil(duration / tileDuration)` if left out. |
| `height` | Pixels up a full tile: its rows. A reader stretches tiles to the height it shows them at. |
| `mimeType` | The tiles' image type. |
| `samplesPerColumn`, `fftSize` | How the level was computed: the samples each column stands for, and the FFT size. |
| `pixelsPerSecond` | Columns a second (`sampleRate / samplesPerColumn`). Informational: `width / tileDuration` is exact. |

### Peaks

Each entry of `peaks` is a file of the recording's waveform peaks: the lowest
and highest sample of each stretch of it, for the channel the tiles show, in the
[BBC audiowaveform JSON format](https://github.com/bbc/audiowaveform/blob/master/doc/DataFormat.md),
version 2. With them a player can draw the waveform and stream the audio rather
than download and decode it. The file says its own sample rate, resolution and
bits, so the entry only has to say enough to choose between them.

| Field | Meaning |
|---|---|
| `url` | Required. Where the file is, resolved as `tiles` is. |
| `pointsPerSecond` | Required. Points a second, near enough to choose by. |
| `samplesPerPixel` | Optional. Samples each point stands for, as the file says it. |

## Choosing a level

A reader shows one level at a time. Where it draws *p* pixels a second of the
recording, it should show the coarsest level that has at least *p* columns a
second, so that no column is stretched across pixels of its own, or the finest
level where none has that many. *p* may count the screen's own pixels rather
than CSS pixels.

- As the view zooms, a reader may keep the tiles of the level it showed on
  screen until those of the level it now wants have arrived.
- Levels may also differ in `height`. Between levels of the same columns a
  second, a reader may choose the one whose rows best suit the height it shows
  them at.
- Peaks are chosen the same way, by `pointsPerSecond` against the pixels a
  second the waveform is drawn at.

## Tiles

- Each tile is an image of the whole frequency range, from `frequencyMin` at
  the bottom to `frequencyMax` at the top.
- Its left edge is the start of its time span, and its right edge the end.
- Rows are evenly spaced in frequency (`linear`).
- Columns are evenly spaced in time. Each stands for the stretch of the
  recording from its own start time to the next column's: in the finest level,
  normally the analysis of one window starting there, not centred on it. A
  column of a coarser level may combine several such windows (see Making
  tiles).
- Tiles should be in an image format every browser the player supports can
  decode. JPEG is the safe choice; Safari before 14 cannot decode WebP.

## Making tiles

[tools/make-tiles.sh](tools/make-tiles.sh) makes a set with ffmpeg.

- **Colour mapping:** greyscale JPEG, 256 rows (a 512-point FFT). Loudness is
  mapped as wavesurfer.js's Spectrogram plugin maps it with
  `colorMap: 'gray'` and its default `gainDB` (20) and `rangeDB` (80), or
  others given as `--gain-db` and `--range-db`. So a set looks like that
  plugin's spectrogram with `scale: 'linear'` at the same settings, and can
  stand in for it.
- **Columns:** every column is a whole number of samples, so that columns
  never drift against the audio.
- **Levels:** the finest has about 86 columns a second, unless told
  otherwise. Each coarser level has four times fewer, until one tile covers
  the whole recording. Every level's `samplesPerColumn` is a whole multiple of
  the finest's, so that column edges line up from level to level.
- **Coarser levels** are made from the finest: each of their pixels keeps the
  loudest of the pixels it covers in its row, so that a sound shorter than a
  column still shows. Analysing the audio again with a longer step instead
  would skip the audio between windows, and miss short sounds.
- **Peaks:** a file for each level, a point for each of its columns, 16-bit.
- **Channel:** only one channel is shown (`channel`, 0 by default), as
  wavesurfer.js's Spectrogram plugin shows only the first.
