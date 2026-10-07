# Changelog

## 0.1.0 (unreleased)

- First version: the TiledSpectrogram plugin for wavesurfer.js 7.10 and 8.
  - Fetches tiles lazily, and follows scroll and zoom.
  - Hands over to the Spectrogram plugin, staying beneath it while it paints.
  - `TiledSpectrogram.normaliseManifest()`, to check a manifest before making
    the player.
  - Builds as an ES module and a UMD script.
- Manifest format, version 1 ([SPEC.md](SPEC.md)).
- `tools/make-tiles.sh`: makes tiles with ffmpeg, calibrated to match the
  Spectrogram plugin with `scale: 'linear', colorMap: 'gray'` at its default
  levels, or at others given as `--gain-db` and `--range-db`.
