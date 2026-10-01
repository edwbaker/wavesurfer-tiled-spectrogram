import { nodeResolve } from '@rollup/plugin-node-resolve'
import terser from '@rollup/plugin-terser'

export default [
  // ESM, for bundlers: wavesurfer.js is the page's own
  {
    input: 'src/tiled-spectrogram.js',
    external: (id) => id.startsWith('wavesurfer.js'),
    output: { file: 'dist/tiled-spectrogram.js', format: 'es' },
  },
  // UMD, for a <script> tag after wavesurfer.js's: it carries its own copy of
  // wavesurfer.js's small BasePlugin, as wavesurfer.js's own plugins do, and
  // attaches itself as WaveSurfer.TiledSpectrogram
  {
    input: 'src/umd.js',
    plugins: [nodeResolve()],
    output: {
      file: 'dist/tiled-spectrogram.min.js',
      format: 'umd',
      name: 'WaveSurfer.TiledSpectrogram',
      extend: true,
      exports: 'default',
      plugins: [terser()],
    },
  },
]
