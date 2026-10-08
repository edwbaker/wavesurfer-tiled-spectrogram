/**
 * Tiled spectrogram plugin for wavesurfer.js.
 *
 * Shows a spectrogram that was made in advance as a row of image tiles (see
 * SPEC.md), fetching only the tiles in and next to the view. It needs nothing
 * from the audio, so it can be shown as soon as the page has the tiles' manifest:
 * on its own, as the spectrogram, or as a stand-in until wavesurfer.js's own
 * Spectrogram plugin has decoded the audio and drawn one, when handOver()
 * gives way to it without the layout moving.
 *
 * It runs in the browsers wavesurfer.js 7 runs in without a transpiler, so it
 * has no class fields, no `??=` and no lazy-loading attribute.
 */
import BasePlugin from 'wavesurfer.js/dist/base-plugin.js'
import { colorTable, recolor } from './color-map.js'
import { predictedWidth, tileBox, tilesInView, tilesToUnload, visibleTimes } from './geometry.js'
import { chooseLevel, choosePeaks, normaliseManifest, peaksUrl, tileSpan, tileUrl } from './manifest.js'

// Tiles are kept by the level they are of and their place in it, "level/index",
// the level being its place in the manifest's levels
function tileKey(levelIndex, index) {
  return levelIndex + '/' + index
}
function keyLevel(key) {
  return Number(key.split('/')[0])
}
function keyIndex(key) {
  return Number(key.split('/')[1])
}

const DEFAULTS = {
  /** CSS pixels high */
  height: 120,
  /** Tiles to fetch on either side of those in view */
  lookahead: 1,
  /** Tiles to keep at most; those furthest from the view are let go first */
  maxLoaded: 12,
  /** How grey tiles are coloured: 'gray' (as they are), 'igray' or 256 colours */
  colorMap: 'gray',
}

class TiledSpectrogramPlugin extends BasePlugin {
  /**
   * @param {object} options
   * @param {string} [options.url] address of the manifest
   * @param {object} [options.manifest] the manifest itself, instead of url
   * @param {string} [options.baseUrl] address tiles are resolved against when
   *   the manifest is given itself; the page's by default
   * @param {number} [options.height] CSS pixels high (120)
   * @param {number} [options.lookahead] tiles either side of the view (1)
   * @param {number} [options.maxLoaded] tiles kept at most (12)
   * @param {string|Array<number[]>} [options.colorMap] how grey tiles are
   *   coloured: 'gray' (as they are), 'igray' (inverted, loud white), or 256
   *   [r, g, b, a] colours, each from 0 to 1, from the quietest level to the
   *   loudest, as wavesurfer.js's Spectrogram plugin takes them
   */
  static create(options) {
    return new TiledSpectrogramPlugin(options || {})
  }

  constructor(options) {
    super(Object.assign({}, DEFAULTS, options))
    // Throws here, as the Spectrogram plugin does, for a colorMap it cannot use
    this.colors = colorTable(this.options.colorMap)
    this.colorBlocked = false
    this.manifest = null
    this.baseUrl = null
    this.levelIndex = -1
    this.container = null
    this.tiles = new Map()
    this.sources = new Map()
    this.failed = new Set()
    this.hidden = false
    this.gone = false
    this.handedOver = false
    this.readyEmitted = false
    this.inView = []
    this.layoutTimer = null
    this.aborter = null
  }

  onInit() {
    const ws = this.wavesurfer
    if (!ws) throw new Error('WaveSurfer is not initialised')
    const container = document.createElement('div')
    container.setAttribute('part', 'tiled-spectrogram')
    Object.assign(container.style, {
      position: 'relative',
      width: '100%',
      height: this.options.height + 'px',
      overflow: 'hidden',
      margin: '0',
      padding: '0',
      border: '0',
    })
    this.container = container
    ws.getWrapper().appendChild(container)

    const relayout = () => this.scheduleLayout()
    this.subscriptions.push(
      ws.on('scroll', relayout),
      ws.on('redraw', relayout),
      ws.on('zoom', relayout),
      // wavesurfer.js 8 only; never emitted by 7, where a resize redraws
      ws.on('resize', relayout),
    )
    this.loadManifest()
  }

  /** The manifest, once loaded and checked, or null */
  getManifest() {
    return this.manifest
  }

  /** The frequencies the tiles show, in Hz, once the manifest is loaded */
  getFrequencyRange() {
    return this.manifest ? { min: this.manifest.frequencyMin, max: this.manifest.frequencyMax } : null
  }

  /** The level being shown, one of the manifest's levels, or null before there is one */
  getLevel() {
    return this.manifest && this.levelIndex >= 0 ? this.manifest.levels[this.levelIndex] : null
  }

  show() {
    if (this.gone || !this.container) return
    this.hidden = false
    this.container.style.display = ''
    this.scheduleLayout()
  }

  hide() {
    if (this.gone || !this.container) return
    this.hidden = true
    this.container.style.display = 'none'
  }

  /**
   * Gives way to wavesurfer.js's own Spectrogram plugin when it has drawn its
   * spectrogram. The Spectrogram plugin's element sits below this one and has
   * no height until it draws. When it says it is ready the tiles are lifted
   * out of the flow where they are, so that it moves up into their place
   * without the layout moving, on top of them.
   *
   * It says it is ready before it has painted, and on a long recording
   * painting takes seconds, so the tiles already fetched stay underneath it,
   * showing wherever it has yet to paint. No more are fetched.
   *
   * Register this plugin before the Spectrogram plugin so that it sits above.
   *
   * @param {object} spectrogram a Spectrogram plugin instance
   */
  handOver(spectrogram) {
    if (this.gone || !spectrogram || typeof spectrogram.once !== 'function') return
    this.subscriptions.push(spectrogram.once('ready', () => {
      if (this.gone || !this.container) return
      const top = this.container.offsetTop
      Object.assign(this.container.style, { position: 'absolute', top: top + 'px', left: '0', zIndex: '4' })
      this.handedOver = true
      this.emit('handover')
    }))
  }

  loadManifest() {
    const options = this.options
    if (options.manifest) {
      // Not at once: this runs inside WaveSurfer.create(), and the page has
      // yet to listen for 'load', just as when the manifest is fetched
      Promise.resolve().then(() => {
        if (!this.gone) this.setManifest(options.manifest, options.baseUrl || document.baseURI)
      })
      return
    }
    if (!options.url) {
      this.fail(new Error('Neither url nor manifest was given'))
      return
    }
    const url = new URL(options.url, document.baseURI).href
    this.aborter = typeof AbortController === 'function' ? new AbortController() : null
    fetch(url, this.aborter ? { signal: this.aborter.signal } : undefined)
      .then((response) => {
        if (!response.ok) throw new Error('Manifest could not be fetched: ' + response.status)
        return response.json()
      })
      .then((manifest) => {
        if (!this.gone) this.setManifest(manifest, url)
      })
      .catch((error) => {
        if (!this.gone && error.name !== 'AbortError') this.fail(error)
      })
  }

  setManifest(manifest, baseUrl) {
    try {
      this.manifest = normaliseManifest(manifest)
    } catch (error) {
      this.fail(error)
      return
    }
    this.baseUrl = baseUrl
    if (this.colors && this.manifest.colorMap !== 'gray') {
      console.warn('TiledSpectrogram: colorMap is not applied, as the manifest does not say the tiles are "gray"')
    }
    this.emit('load', this.manifest)
    this.layout()
  }

  fail(error) {
    this.emit('error', error)
  }

  /**
   * Lays the tiles out again soon, once however many scroll events arrive in
   * the meantime. A timer rather than an animation frame, which a page in the
   * background, or being captured for a thumbnail, may never be given.
   */
  scheduleLayout() {
    if (this.layoutTimer || this.gone) return
    this.layoutTimer = setTimeout(() => {
      this.layoutTimer = null
      this.layout()
    }, 30)
  }

  /**
   * Where things are: the length of the timeline in pixels, the duration it
   * stands for, and the stretch of it in view. Before wavesurfer.js has
   * decoded the audio it knows neither, so they are worked out from the
   * manifest as wavesurfer.js will work them out, and only the start is in view.
   */
  measure() {
    const ws = this.wavesurfer
    const wrapper = ws.getWrapper()
    const viewWidth = ws.getWidth()
    const rendered = ws.getDuration() > 0 && wrapper.style.width !== ''
    if (rendered) {
      return { duration: ws.getDuration(), totalWidth: wrapper.offsetWidth, scroll: ws.getScroll(), viewWidth: viewWidth }
    }
    const duration = this.manifest.duration
    const totalWidth = predictedWidth(duration, ws.options.minPxPerSec, viewWidth, ws.options.fillParent)
    return { duration: duration, totalWidth: totalWidth, scroll: 0, viewWidth: viewWidth }
  }

  layout() {
    if (this.gone || this.hidden || !this.manifest || !this.wavesurfer) return
    const manifest = this.manifest
    const where = this.measure()
    // The level for the pixels a second drawn. Once handed over, the tiles are
    // only a backdrop, so they stay of the level they are.
    if (!this.handedOver || this.levelIndex < 0) {
      const chosen = chooseLevel(manifest, where.duration > 0 ? where.totalWidth / where.duration : 0)
      const levelIndex = manifest.levels.indexOf(chosen)
      if (levelIndex !== this.levelIndex) {
        this.levelIndex = levelIndex
        this.emit('level', chosen)
      }
    }
    const level = manifest.levels[this.levelIndex]
    const span = visibleTimes(where.scroll, where.viewWidth, where.totalWidth, where.duration)
    const inView = tilesInView(span[0], span[1], level.tileDuration, level.tileCount, 0)
    const wanted = tilesInView(span[0], span[1], level.tileDuration, level.tileCount, this.options.lookahead)

    // Once handed over, the tiles already fetched are only a backdrop for
    // wherever the Spectrogram plugin has yet to paint, so no more are fetched
    if (!this.handedOver) wanted.forEach((index) => this.loadTile(this.levelIndex, index))
    // Every tile there is, of whichever level, laid out where it belongs
    this.tiles.forEach((tile, key) => {
      const times = tileSpan(manifest.levels[keyLevel(key)], keyIndex(key), manifest.duration)
      const box = tileBox(times[0], times[1], where.duration, where.totalWidth)
      tile.style.left = box.left + 'px'
      tile.style.width = box.width + 'px'
    })
    const loaded = Array.from(this.tiles.keys()).filter((key) => keyLevel(key) === this.levelIndex).map(keyIndex)
    tilesToUnload(loaded, wanted, this.options.maxLoaded).forEach((index) => this.unloadTile(tileKey(this.levelIndex, index)))

    this.inView = inView
    this.dropOtherLevels()
    this.checkReady()
  }

  loadTile(levelIndex, index) {
    const key = tileKey(levelIndex, index)
    if (this.tiles.has(key) || this.failed.has(key)) return
    const url = tileUrl(this.manifest.levels[levelIndex], index, this.baseUrl)
    // Only grey tiles can be recoloured; other images are shown as they are
    if (this.colors && !this.colorBlocked && this.manifest.colorMap === 'gray') this.loadColored(key, url)
    else this.loadAsIs(key, url, false)
  }

  /** A tile's element, an img or a canvas, placed in the container */
  addTile(key, tagName) {
    const tile = document.createElement(tagName)
    tile.setAttribute('part', 'tiled-spectrogram-tile')
    Object.assign(tile.style, {
      position: 'absolute',
      top: '0',
      height: '100%',
      maxWidth: 'none',
      display: 'block',
      pointerEvents: 'none',
      userSelect: 'none',
    })
    this.tiles.set(key, tile)
    this.container.appendChild(tile)
    return tile
  }

  /**
   * A tile shown as it is. afterCors: being tried again without CORS, after
   * its site refused to let it be recoloured.
   */
  loadAsIs(key, url, afterCors) {
    const img = this.addTile(key, 'img')
    img.alt = ''
    img.draggable = false
    img.decoding = 'async'
    img.onload = () => {
      if (afterCors) this.blockColor()
      this.tileLoaded(key, img)
    }
    img.onerror = () => this.tileFailed(key, img)
    img.src = url
  }

  /**
   * A grey tile drawn into a canvas through the colour map. Its pixels have to
   * be read, so a tile from another site is fetched with CORS; if that site
   * does not allow it, the tile is tried again and shown grey.
   */
  loadColored(key, url) {
    const canvas = this.addTile(key, 'canvas')
    const source = new Image()
    const crossSite = new URL(url, document.baseURI).origin !== window.location.origin
    if (crossSite) source.crossOrigin = 'anonymous'
    source.onload = () => {
      if (this.gone || this.tiles.get(key) !== canvas) return
      this.sources.delete(key)
      try {
        canvas.width = source.naturalWidth
        canvas.height = source.naturalHeight
        const context = canvas.getContext('2d')
        context.drawImage(source, 0, 0)
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
        recolor(pixels.data, this.colors)
        context.putImageData(pixels, 0, 0)
      } catch (error) {
        // Its pixels could not be read after all (redirected to another site)
        this.blockColor()
        this.unloadTile(key)
        this.loadAsIs(key, url, false)
        return
      }
      this.tileLoaded(key, canvas)
    }
    source.onerror = () => {
      if (this.gone || this.tiles.get(key) !== canvas) return
      this.sources.delete(key)
      if (!crossSite) {
        this.tileFailed(key, canvas)
        return
      }
      this.unloadTile(key)
      this.loadAsIs(key, url, true)
    }
    this.sources.set(key, source)
    source.src = url
  }

  /** From now on tiles are shown grey, as their pixels cannot be read */
  blockColor() {
    if (this.colorBlocked) return
    this.colorBlocked = true
    console.warn('TiledSpectrogram: the tiles\' site does not allow CORS, so they cannot be recoloured and are shown grey')
  }

  tileLoaded(key, tile) {
    if (this.gone || this.tiles.get(key) !== tile) return
    tile.dataset.loaded = '1'
    this.emit('tileload', keyIndex(key), this.manifest.levels[keyLevel(key)])
    this.dropOtherLevels()
    this.checkReady()
  }

  tileFailed(key, tile) {
    if (this.gone || this.tiles.get(key) !== tile) return
    // Given up on, not retried: a tile that is not there will not appear
    this.failed.add(key)
    this.unloadTile(key)
    this.fail(new Error('Tile ' + keyIndex(key) + ' of level ' + keyLevel(key) + ' could not be loaded'))
    this.dropOtherLevels()
    this.checkReady()
  }

  unloadTile(key) {
    const tile = this.tiles.get(key)
    if (!tile) return
    tile.onload = null
    tile.onerror = null
    tile.remove()
    this.tiles.delete(key)
    const source = this.sources.get(key)
    if (source) {
      source.onload = null
      source.onerror = null
      this.sources.delete(key)
    }
  }

  unloadAll() {
    Array.from(this.tiles.keys()).forEach((key) => this.unloadTile(key))
  }

  /** Whether the tiles in view of the level shown have all arrived, or failed */
  inViewDone() {
    return this.inView.length > 0 && this.inView.every((index) => {
      const key = tileKey(this.levelIndex, index)
      const tile = this.tiles.get(key)
      return this.failed.has(key) || (tile && tile.dataset.loaded === '1')
    })
  }

  /**
   * Lets go of the tiles of other levels once those of the level shown have
   * arrived where they are in view. Until then they stay, beneath it, so that
   * zooming never leaves the spectrogram blank.
   */
  dropOtherLevels() {
    if (!this.inViewDone()) return
    Array.from(this.tiles.keys()).forEach((key) => {
      if (keyLevel(key) !== this.levelIndex) this.unloadTile(key)
    })
  }

  /** Says once that the tiles in view have all arrived, or failed */
  checkReady() {
    if (this.readyEmitted || !this.inViewDone()) return
    this.readyEmitted = true
    this.emit('ready')
  }

  destroy() {
    this.gone = true
    if (this.aborter) this.aborter.abort()
    clearTimeout(this.layoutTimer)
    this.unloadAll()
    if (this.container) this.container.remove()
    this.container = null
    super.destroy()
  }
}

/**
 * Checks a manifest as the plugin will, giving it with what may be left out
 * filled in, or throwing an Error saying what is wrong with it. A page can use
 * this to decide, before making the player, whether it has tiles to show.
 */
TiledSpectrogramPlugin.normaliseManifest = normaliseManifest

/**
 * Which of a normalised manifest's levels, or peaks, suits drawing the given
 * pixels a second (see SPEC.md, Choosing a level), and where peaks are. A page
 * streaming the audio uses these to find the peaks to draw its waveform from.
 */
TiledSpectrogramPlugin.chooseLevel = chooseLevel
TiledSpectrogramPlugin.choosePeaks = choosePeaks
TiledSpectrogramPlugin.peaksUrl = peaksUrl

export default TiledSpectrogramPlugin
export { chooseLevel, choosePeaks, normaliseManifest, peaksUrl, tileSpan, tileUrl } from './manifest.js'
