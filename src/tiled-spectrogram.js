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
import { normaliseManifest, tileSpan, tileUrl } from './manifest.js'

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
    const span = visibleTimes(where.scroll, where.viewWidth, where.totalWidth, where.duration)
    const inView = tilesInView(span[0], span[1], manifest.tileDuration, manifest.tileCount, 0)
    const wanted = tilesInView(span[0], span[1], manifest.tileDuration, manifest.tileCount, this.options.lookahead)

    // Once handed over, the tiles already fetched are only a backdrop for
    // wherever the Spectrogram plugin has yet to paint, so no more are fetched
    if (!this.handedOver) wanted.forEach((index) => this.loadTile(index))
    this.tiles.forEach((tile, index) => {
      const times = tileSpan(manifest, index)
      const box = tileBox(times[0], times[1], where.duration, where.totalWidth)
      tile.style.left = box.left + 'px'
      tile.style.width = box.width + 'px'
    })
    tilesToUnload(Array.from(this.tiles.keys()), wanted, this.options.maxLoaded).forEach((index) => this.unloadTile(index))

    this.inView = inView
    this.checkReady()
  }

  loadTile(index) {
    if (this.tiles.has(index) || this.failed.has(index)) return
    const url = tileUrl(this.manifest, index, this.baseUrl)
    // Only grey tiles can be recoloured; other images are shown as they are
    if (this.colors && !this.colorBlocked && this.manifest.colorMap === 'gray') this.loadColored(index, url)
    else this.loadAsIs(index, url, false)
  }

  /** A tile's element, an img or a canvas, placed in the container */
  addTile(index, tagName) {
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
    this.tiles.set(index, tile)
    this.container.appendChild(tile)
    return tile
  }

  /**
   * A tile shown as it is. afterCors: being tried again without CORS, after
   * its site refused to let it be recoloured.
   */
  loadAsIs(index, url, afterCors) {
    const img = this.addTile(index, 'img')
    img.alt = ''
    img.draggable = false
    img.decoding = 'async'
    img.onload = () => {
      if (afterCors) this.blockColor()
      this.tileLoaded(index, img)
    }
    img.onerror = () => this.tileFailed(index, img)
    img.src = url
  }

  /**
   * A grey tile drawn into a canvas through the colour map. Its pixels have to
   * be read, so a tile from another site is fetched with CORS; if that site
   * does not allow it, the tile is tried again and shown grey.
   */
  loadColored(index, url) {
    const canvas = this.addTile(index, 'canvas')
    const source = new Image()
    const crossSite = new URL(url, document.baseURI).origin !== window.location.origin
    if (crossSite) source.crossOrigin = 'anonymous'
    source.onload = () => {
      if (this.gone || this.tiles.get(index) !== canvas) return
      this.sources.delete(index)
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
        this.unloadTile(index)
        this.loadAsIs(index, url, false)
        return
      }
      this.tileLoaded(index, canvas)
    }
    source.onerror = () => {
      if (this.gone || this.tiles.get(index) !== canvas) return
      this.sources.delete(index)
      if (!crossSite) {
        this.tileFailed(index, canvas)
        return
      }
      this.unloadTile(index)
      this.loadAsIs(index, url, true)
    }
    this.sources.set(index, source)
    source.src = url
  }

  /** From now on tiles are shown grey, as their pixels cannot be read */
  blockColor() {
    if (this.colorBlocked) return
    this.colorBlocked = true
    console.warn('TiledSpectrogram: the tiles\' site does not allow CORS, so they cannot be recoloured and are shown grey')
  }

  tileLoaded(index, tile) {
    if (this.gone || this.tiles.get(index) !== tile) return
    tile.dataset.loaded = '1'
    this.emit('tileload', index)
    this.checkReady()
  }

  tileFailed(index, tile) {
    if (this.gone || this.tiles.get(index) !== tile) return
    // Given up on, not retried: a tile that is not there will not appear
    this.failed.add(index)
    this.unloadTile(index)
    this.fail(new Error('Tile ' + index + ' could not be loaded'))
    this.checkReady()
  }

  unloadTile(index) {
    const tile = this.tiles.get(index)
    if (!tile) return
    tile.onload = null
    tile.onerror = null
    tile.remove()
    this.tiles.delete(index)
    const source = this.sources.get(index)
    if (source) {
      source.onload = null
      source.onerror = null
      this.sources.delete(index)
    }
  }

  unloadAll() {
    Array.from(this.tiles.keys()).forEach((index) => this.unloadTile(index))
  }

  /** Says once that the tiles in view have all arrived, or failed */
  checkReady() {
    if (this.readyEmitted || !this.inView || this.inView.length === 0) return
    const done = this.inView.every((index) => {
      const tile = this.tiles.get(index)
      return this.failed.has(index) || (tile && tile.dataset.loaded === '1')
    })
    if (!done) return
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

export default TiledSpectrogramPlugin
export { normaliseManifest, tileUrl, tileSpan } from './manifest.js'
