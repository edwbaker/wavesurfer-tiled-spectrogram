# Changelog

## 0.1.0 (unreleased)

- First version: the TiledSpectrogram plugin for wavesurfer.js 7.10 and 8.
  - Fetches tiles lazily, and follows scroll and zoom.
  - Shows the level that suits the zoom, where a manifest has several, keeping
    the tiles of the level before until those of the new one have arrived.
    `getLevel()` and the `level` event say which it shows.
  - Hands over to the Spectrogram plugin, staying beneath it while it paints.
  - `TiledSpectrogram.normaliseManifest()`, to check a manifest before making
    the player, and `chooseLevel()`, `choosePeaks()` and `peaksUrl()`, to
    choose the peaks to stream the audio with.
  - `colorMap`: shows grey tiles in other colours, `'igray'` or any 256, as
    wavesurfer.js's Spectrogram plugin takes them.
  - Builds as an ES module and a UMD script.
- Manifest format, version 1 ([SPEC.md](SPEC.md)): the spectrogram at one or
  more resolutions (levels), and the recording's waveform peaks at one or more.
- `tools/make-tiles.sh`: makes tiles with ffmpeg, calibrated to match the
  Spectrogram plugin with `scale: 'linear', colorMap: 'gray'` at its default
  loudness, or at others given as `--gain-db` and `--range-db`.
  - Makes the finest level at about 86 columns a second (about 344, in tiles
    a quarter as long, above 96 kHz), and coarser ones each four times coarser
    until one tile covers the recording. Each pixel of a coarser level keeps
    the loudest of those it covers, so that short sounds still show.
  - Tiles a whole folder into the same paths, `--jobs` at a time, passing over
    recordings already tiled so that a stopped run can be started again.
  - Writes only into a folder that is empty or holds its own earlier tiles.
  - Writes the recording's waveform peaks beside the tiles, a file for each
    level in the BBC audiowaveform JSON format, listed in the manifest's
    `peaks`, so that a player can stream the audio instead of decoding it.
- The demo can stream the audio with the peaks, show other colours, and zoom
  from one level to the other.
- The demo shows a recording in audioBLAST, looking up its audio and tiles by
  its ID, and loads wavesurfer.js 8.0.2 or 7.10.1 from cdn.audioblast.org. It
  is published to GitHub Pages, with a landing page.
