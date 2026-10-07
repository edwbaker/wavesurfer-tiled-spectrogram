# Tiled spectrogram, version 1

A spectrogram made in advance and cut into images along time. Each image is a
**tile**: a fixed stretch of the recording, all frequencies. A JSON
**manifest** describes the tiles. A player fetches the manifest, then only the
tiles near what is on screen, so a spectrogram of hours costs no more to show
than one of seconds.

The manifest is `index.json`, normally beside its tiles. It is served as
`application/json`, and tiles as their image type. A set of tiles and its
manifest never change once made. Making them differently (another resolution
or calibration) gives a new set at a new address.

## Manifest

```json
{
  "type": "tiled-spectrogram",
  "version": 1,
  "duration": 571.946667,
  "tileDuration": 60.000362812,
  "tileCount": 10,
  "tiles": "{index}.jpg",
  "mimeType": "image/jpeg",
  "width": 5168,
  "height": 256,
  "pixelsPerSecond": 86.132812,
  "frequencyMin": 0,
  "frequencyMax": 22050,
  "frequencyScale": "linear",
  "sampleRate": 44100,
  "samplesPerColumn": 512,
  "channel": 0,
  "fftSize": 512,
  "window": "hann",
  "colorMap": "gray",
  "dbRange": [-100, -20],
  "renderer": {"name": "ffmpeg showspectrumpic", "scale": "log", "drange": 80, "limit": -18},
  "calibration": "default"
}
```

### Required

| Field | Meaning |
|---|---|
| `type` | Always `"tiled-spectrogram"`. |
| `version` | `1`. A reader refuses a major version it does not know. A minor version (e.g. `1.1`) only adds fields, which a reader may ignore. |
| `duration` | Seconds of audio the tiles cover. |
| `tileDuration` | Seconds each tile covers, exactly. Tile *i* covers `[i × tileDuration, min((i + 1) × tileDuration, duration)]`. The last tile is usually shorter, and its image is correspondingly narrower. |
| `tiles` | Where the tiles are. Either a template, in which `{index}` stands for the tile's number from 0, or a list of `tileCount` addresses. Relative addresses are resolved against the manifest's own address. |
| `frequencyMax` | Hz at the top edge of every tile. |

### Optional

| Field | Meaning |
|---|---|
| `tileCount` | How many tiles there are; `ceil(duration / tileDuration)` if left out. |
| `frequencyMin` | Hz at the bottom edge; 0 if left out. |
| `frequencyScale` | How frequency runs up a tile; only `"linear"` is defined in version 1. |
| `mimeType` | The tiles' image type. |
| `width`, `height` | Pixels of a full tile. A reader stretches tiles to fit, so these are informational. |
| `pixelsPerSecond` | Columns a second (`sampleRate / samplesPerColumn`). Informational. |
| `sampleRate`, `samplesPerColumn`, `channel`, `fftSize`, `window` | How the spectrogram was computed. |
| `colorMap` | `"gray"`: white is quiet, black is loud. |
| `dbRange` | `[quiet, loud]`: the levels shown as the two ends of `colorMap`, in dB measured as wavesurfer.js's Spectrogram plugin measures them, `20 × log10(2 × \|X\| / fftSize)` for each bin of the windowed FFT `X`. The plugin's `gainDB` is `-loud` and its `rangeDB` is `loud - quiet`. |
| `renderer`, `calibration` | What made the tiles, with what settings, under what name, so that sets made differently can be told apart. |

## Tiles

- Each tile is an image of the whole frequency range, from `frequencyMin` at
  the bottom to `frequencyMax` at the top.
- Its left edge is the start of its time span, and its right edge the end.
- Rows are evenly spaced in frequency (`linear`).
- Columns are evenly spaced in time. Each column is the analysis of a window
  starting at the column's own start time; it is not centred.
- Tiles should be in an image format every browser the player supports can
  decode. JPEG is the safe choice; Safari before 14 cannot decode WebP.

## Making tiles

[tools/make-tiles.sh](tools/make-tiles.sh) makes a set with ffmpeg.

- **Colour mapping:** greyscale JPEG, 256 rows (a 512-point FFT) and about 86
  columns a second. Levels are mapped as wavesurfer.js's Spectrogram plugin
  maps them with `colorMap: 'gray'` and its default `gainDB` (20) and
  `rangeDB` (80), or others given as `--gain-db` and `--range-db`. So a set
  looks like that plugin's spectrogram with `scale: 'linear'` at the same
  settings, and can stand in for it.
- **Columns:** every column is a whole number of samples, so that columns
  never drift against the audio.
- **Channel:** only one channel is shown (`channel`, 0 by default), as
  wavesurfer.js's Spectrogram plugin shows only the first.
