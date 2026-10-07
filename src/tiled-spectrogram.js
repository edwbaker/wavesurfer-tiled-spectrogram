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
import { predictedWidth, tileBox, tilesInView, tilesToUnload, visibleTimes } from './geometry.js'
import { normaliseManifest, tileSpan, tileUrl } from './manifest.js'

const DEFAULTS = {
  /** CSS pixels high */
  height: 120,
  /** Tiles to fetch on either side of those in view */
  lookahead: 1,
  /** Tiles to keep at most; those furthest from the view are let go first */
  maxLoaded: 12,
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
   */
  static create(options) {
    return new TiledSpectrogramPlugin(options || {})
  }

  constructor(options) {
    super(Object.assign({}, DEFAULTS, options))
    this.manifest = null
    this.baseUrl = null
    this.container = null
    this.tiles = new Map()
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
    this.tiles.forEach((img, index) => {
      const times = tileSpan(manifest, index)
      const box = tileBox(times[0], times[1], where.duration, where.totalWidth)
      img.style.left = box.left + 'px'
      img.style.width = box.width + 'px'
    })
    tilesToUnload(Array.from(this.tiles.keys()), wanted, this.options.maxLoaded).forEach((index) => this.unloadTile(index))

    this.inView = inView
    this.checkReady()
  }

  loadTile(index) {
    if (this.tiles.has(index) || this.failed.has(index)) return
    const img = document.createElement('img')
    img.alt = ''
    img.draggable = false
    img.decoding = 'async'
    img.setAttribute('part', 'tiled-spectrogram-tile')
    Object.assign(img.style, {
      position: 'absolute',
      top: '0',
      height: '100%',
      maxWidth: 'none',
      display: 'block',
      pointerEvents: 'none',
      userSelect: 'none',
    })
    img.onload = () => {
      if (this.gone) return
      img.dataset.loaded = '1'
      this.emit('tileload', index)
      this.checkReady()
    }
    img.onerror = () => {
      if (this.gone || !this.tiles.has(index)) return
      // Given up on, not retried: a tile that is not there will not appear
      this.failed.add(index)
      this.unloadTile(index)
      this.fail(new Error('Tile ' + index + ' could not be loaded'))
      this.checkReady()
    }
    this.tiles.set(index, img)
    this.container.appendChild(img)
    img.src = tileUrl(this.manifest, index, this.baseUrl)
  }

  unloadTile(index) {
    const img = this.tiles.get(index)
    if (!img) return
    img.onload = null
    img.onerror = null
    img.remove()
    this.tiles.delete(index)
  }

  unloadAll() {
    Array.from(this.tiles.keys()).forEach((index) => this.unloadTile(index))
  }

  /** Says once that the tiles in view have all arrived, or failed */
  checkReady() {
    if (this.readyEmitted || !this.inView || this.inView.length === 0) return
    const done = this.inView.every((index) => {
      const img = this.tiles.get(index)
      return this.failed.has(index) || (img && img.dataset.loaded === '1')
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
