# Changelog

## 0.1.0 (unreleased)

- First version: the TiledSpectrogram plugin for wavesurfer.js 7.10 and 8.
  - Fetches tiles lazily, and follows scroll and zoom.
  - Hands over to the Spectrogram plugin.
  - Builds as an ES module and a UMD script.
- Manifest format, version 1 ([SPEC.md](SPEC.md)).
- `tools/make-tiles.sh`: makes tiles with ffmpeg, calibrated to match the
  Spectrogram plugin at `gainDB: 50, rangeDB: 80, colorMap: 'gray'`.
