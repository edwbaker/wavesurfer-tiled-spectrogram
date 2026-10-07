# Changelog

## 0.1.0 (unreleased)

- First version: the TiledSpectrogram plugin for wavesurfer.js 7.10 and 8.
  - Fetches tiles lazily, and follows scroll and zoom.
  - Hands over to the Spectrogram plugin, staying beneath it while it paints.
  - `TiledSpectrogram.normaliseManifest()`, to check a manifest before making
    the player.
  - `colorMap`: shows grey tiles in other colours, `'igray'` or any 256, as
    wavesurfer.js's Spectrogram plugin takes them.
  - Builds as an ES module and a UMD script.
- Manifest format, version 1 ([SPEC.md](SPEC.md)).
- `tools/make-tiles.sh`: makes tiles with ffmpeg, calibrated to match the
  Spectrogram plugin with `scale: 'linear', colorMap: 'gray'` at its default
  levels, or at others given as `--gain-db` and `--range-db`.
  - Tiles a whole folder into the same paths, `--jobs` at a time, passing over
    recordings already tiled so that a stopped run can be started again.
  - Writes only into a folder that is empty or holds its own earlier tiles.
  - Writes the recording's waveform peaks beside the tiles, as `peaks.json`
    in the BBC audiowaveform JSON format, named by the manifest's `peaks`, so
    that a player can stream the audio instead of decoding it.
- The demo can stream the audio with the peaks, and show other colours.
