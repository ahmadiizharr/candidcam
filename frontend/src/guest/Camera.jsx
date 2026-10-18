import { useEffect, useRef, useState } from 'preact/hooks'
import { api } from '../lib/api.js'
import { centerCrop, createRenderer, PRESETS, snapshot, stillRenderer } from '../lib/filters.js'
import { canvasToBlob, composeFrame, ensureFont, formatFrameDate, loadFrameFonts } from '../lib/frame.js'
import { formatDateTime, pad2 } from '../lib/format.js'
import { Icon } from '../ui/icons.jsx'
import { Lightbox } from '../ui/Lightbox.jsx'
import { toast } from '../ui/ui.jsx'

const MAX_OUT = 2000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function uploadPhoto(slug, token, blob, { filter, source, inner }) {
  const form = new FormData()
  form.append('photo', blob, 'photo.jpg')
  form.append('filter', filter)
  form.append('source', source)
  if (inner) form.append('inner', [inner.x, inner.y, inner.w, inner.h].map((v) => v.toFixed(4)).join(','))
  return api(`/api/g/${slug}/photos`, { method: 'POST', form, headers: { 'X-Guest-Token': token } })
}

/** Centre crop for the shot ratio, narrowed further by a digital zoom factor. */
function zoomedCrop(vw, vh, ratio, z) {
  const c = centerCrop(vw, vh, ratio)
  if (z <= 1) return c
  return { x: c.x + (c.w * (1 - 1 / z)) / 2, y: c.y + (c.h * (1 - 1 / z)) / 2, w: c.w / z, h: c.h / z }
}

function useViewport() {
  const read = () => ({ w: window.visualViewport?.width || innerWidth, h: window.visualViewport?.height || innerHeight })
  const [vp, setVp] = useState(read)
  useEffect(() => {
    const on = () => setVp(read())
    addEventListener('resize', on)
    window.visualViewport?.addEventListener('resize', on)
    screen.orientation?.addEventListener?.('change', on)
    return () => {
      removeEventListener('resize', on)
      window.visualViewport?.removeEventListener('resize', on)
      screen.orientation?.removeEventListener?.('change', on)
    }
  }, [])
  return vp
}

/** A film box for each look: its colours come from the filter's own split-tone. */
function stockStyle(id) {
  const p = PRESETS[id] || {}
  const c = (v, k = 1) => `rgb(${(v || [0.5, 0.5, 0.5]).map((x) => Math.round(Math.min(1, x * k) * 255)).join(',')})`
  if (id === 'none') return { background: 'linear-gradient(160deg, #f4f1ea, #b9b4aa)' }
  if (p.saturation === 0) return { background: 'linear-gradient(160deg, #f2f2f2, #2a2a2a)' }
  return { background: `linear-gradient(160deg, ${c(p.high, 1)} 0%, ${c(p.high, 0.82)} 38%, ${c(p.shadow, 0.9)} 100%)` }
}
const isoOf = (i) => [100, 200, 400, 800, 160, 320, 640][i % 7]

/** Odometer-style counter: digits roll when the number changes. */
function Counter({ value }) {
  const digits = pad2(Math.max(0, value)).split('')
  return (
    <span class="odo" aria-label={String(value)}>
      {digits.map((d, i) => (
        <span key={i} class="odo-cell">
          <span class="odo-strip" style={{ transform: `translateY(-${Number(d) * 10}%)` }}>
            {'0123456789'.split('').map((n) => <i key={n}>{n}</i>)}
          </span>
        </span>
      ))}
    </span>
  )
}

/** Shutter with a ring that empties as the roll is used up. */
function Shutter({ left, total, disabled, onPress, label }) {
  const r = 44
  const len = 2 * Math.PI * r
  const frac = total ? Math.max(0, left) / total : 0
  return (
    <button class="shutter2" onClick={onPress} disabled={disabled} aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} class="ring-bg" />
        <circle cx="50" cy="50" r={r} class="ring" style={{ strokeDasharray: len, strokeDashoffset: len * (1 - frac) }} />
      </svg>
      <span class="shutter2-btn" />
    </button>
  )
}

export function Camera({ event, catalog, guest, token, t, onClose, onShot }) {
  const vp = useViewport()
  const landscape = vp.w > vp.h * 1.05
  const base = (() => {
    const r = catalog.aspect_ratios.find((a) => a.id === event.aspect_ratio) || catalog.aspect_ratios[0]
    return r.w / r.h
  })()
  // Hold the phone sideways and the shot turns sideways with it.
  const ratio = landscape ? 1 / base : base
  const filters = catalog.filters.filter((f) => event.filters.includes(f.id))
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const rendererRef = useRef(null)
  const streamRef = useRef(null)
  const live = useRef({ filter: filters[0]?.id || 'none', facing: 'environment', digital: 1, ratio })
  const [facing, setFacing] = useState('environment')
  const [filter, setFilter] = useState(live.current.filter)
  const [stamp, setStamp] = useState(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  const [left, setLeft] = useState(guest.photos_left)
  const [pending, setPending] = useState(0)
  const [last, setLast] = useState(null)
  const [shutterFx, setShutterFx] = useState(0)
  const [cams, setCams] = useState(1)
  const [zoomCaps, setZoomCaps] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [torch, setTorch] = useState(false)
  const [flashOn, setFlashOn] = useState(false)
  const [screenFlash, setScreenFlash] = useState(false)
  const [busy, setBusy] = useState(false)
  const [roll, setRoll] = useState(null)
  const [rollIndex, setRollIndex] = useState(0)
  const touchX = useRef(null)

  live.current.filter = filter
  live.current.facing = facing
  live.current.ratio = ratio

  // Biggest box with the shot ratio. Portrait: controls float over its lower edge.
  // Landscape: controls get their own column on the right.
  const DECK = 132
  const boxW = landscape ? Math.min(vp.w - DECK - 20, (vp.h - 20) * ratio) : Math.min(vp.w - 12, (vp.h - 14) * ratio)
  const boxH = boxW / ratio

  useEffect(() => {
    if (event.frame_style === 'polaroid') {
      loadFrameFonts()
      ensureFont(catalog, event.frame_font)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function start() {
      setReady(false)
      setError(null)
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t.cameraUnavailable)
        return
      }
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1920 } },
        })
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        streamRef.current = stream
        const v = videoRef.current
        v.srcObject = stream
        await v.play().catch(() => {})
        const caps = stream.getVideoTracks()[0]?.getCapabilities?.() || {}
        setZoomCaps(caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null)
        setTorch(!!caps.torch)
        setZoom(1)
        live.current.digital = 1
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
        setCams(devices.filter((d) => d.kind === 'videoinput').length)
      } catch (e) {
        setError(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? t.cameraAccessFailed : t.cameraUnavailable)
      }
    }
    start()
    return () => {
      cancelled = true
    }
  }, [facing])

  useEffect(() => () => streamRef.current?.getTracks().forEach((tr) => tr.stop()), [])

  useEffect(() => {
    let raf = 0
    let first = true
    const v = videoRef.current
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      if (document.hidden || !canvas || !v.videoWidth || v.readyState < 2) return
      if (!rendererRef.current) rendererRef.current = createRenderer({ canvas })
      const r = rendererRef.current
      const L = live.current
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cap = r.kind === 'cpu' ? 480 : 1400
      const box = canvas.getBoundingClientRect()
      let w = box.width * dpr
      let h = box.height * dpr
      const s = Math.min(1, cap / Math.max(w, h))
      w *= s
      h *= s
      r.draw(v, { filter: L.filter, crop: zoomedCrop(v.videoWidth, v.videoHeight, L.ratio, L.digital), mirror: L.facing === 'user', width: w, height: h, seed: (performance.now() % 1000) / 10 })
      if (first) {
        first = false
        setReady(true)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [facing])

  const levels = zoomCaps
    ? [zoomCaps.min <= 0.5 ? 0.5 : null, 1, zoomCaps.max >= 2 ? 2 : null, zoomCaps.max >= 5 ? 5 : zoomCaps.max >= 3 ? 3 : null].filter(Boolean)
    : [1, 2, 3]
  const cycleZoom = async () => {
    const z = levels[(levels.indexOf(zoom) + 1) % levels.length]
    setZoom(z)
    const track = streamRef.current?.getVideoTracks()[0]
    if (zoomCaps && track) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: Math.min(zoomCaps.max, Math.max(zoomCaps.min, z)) }] })
        live.current.digital = 1
        return
      } catch {
        /* digital below */
      }
    }
    live.current.digital = z
  }

  const remaining = left - pending
  const finished = left <= 0 && pending === 0
  const canFlash = facing === 'user' || torch

  async function shoot() {
    const v = videoRef.current
    if (!ready || busy || remaining <= 0 || !v.videoWidth) return
    setBusy(true)
    const track = streamRef.current?.getVideoTracks()[0]
    const useTorch = flashOn && facing === 'environment' && torch
    const useScreen = flashOn && facing === 'user'
    try {
      if (useTorch) {
        await track.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {})
        await sleep(450)
      } else if (useScreen) {
        setScreenFlash(true)
        await sleep(320)
      }
      navigator.vibrate?.(18)
      setShutterFx((n) => n + 1)
      setPending((n) => n + 1)
      const L = live.current
      const chosen = L.filter
      const crop = zoomedCrop(v.videoWidth, v.videoHeight, L.ratio, L.digital)
      const cw = v.videoWidth * crop.w
      const ch = v.videoHeight * crop.h
      const sc = Math.min(1, MAX_OUT / Math.max(cw, ch))
      const r = stillRenderer()
      r.draw(v, { filter: chosen, crop, mirror: L.facing === 'user', width: Math.round(cw * sc), height: Math.round(ch * sc), seed: Math.random() * 100 })
      let shot = snapshot(r)
      if (useTorch) track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {})
      setScreenFlash(false)
      setBusy(false)
      if (event.frame_style === 'polaroid') {
        await ensureFont(catalog, event.frame_font)
        shot = composeFrame(shot, event, catalog)
      }
      setLast({ src: shot.toDataURL('image/jpeg', 0.5), key: Date.now(), wide: shot.width > shot.height })
      const blob = await canvasToBlob(shot, 0.9)
      try {
        const res = await uploadPhoto(event.slug, token, blob, { filter: chosen, source: 'camera', inner: shot.inner })
        setLeft(res.guest.photos_left)
        onShot?.(res.photo, res.guest)
      } catch (e) {
        toast(e.status === 409 ? t.rollFinished : `${t.captureFailed}: ${e.message}`, 'error')
        if (e.status === 409) setLeft(0)
      } finally {
        setPending((n) => n - 1)
      }
    } catch (e) {
      setScreenFlash(false)
      setBusy(false)
      toast(`${t.captureFailed}: ${e.message}`, 'error')
    }
  }

  const openRoll = async () => {
    try {
      const r = await api(`/api/g/${event.slug}/photos?scope=mine`, { headers: { 'X-Guest-Token': token } })
      if (!r.photos.length) return
      setRollIndex(0)
      setRoll(r.photos)
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const pick = (id) => {
    if (id === filter) return
    setFilter(id)
    setStamp({ id, key: Date.now() })
    document.getElementById(`stk-${id}`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'center' })
  }
  const step = (dir) => {
    const i = filters.findIndex((f) => f.id === filter)
    const n = filters[Math.min(filters.length - 1, Math.max(0, i + dir))]
    if (n) pick(n.id)
  }
  useEffect(() => {
    document.getElementById(`stk-${filter}`)?.scrollIntoView({ inline: 'center', block: 'center' })
  }, [landscape])

  const dateLine = formatFrameDate(event.frame_date, event.frame_date_format)
  const stampIndex = stamp ? filters.findIndex((f) => f.id === stamp.id) : -1

  return (
    <div class={`cam2 ${landscape ? 'is-land' : 'is-port'}`} style={{ '--box-w': `${boxW}px`, '--box-h': `${boxH}px` }}>
      <video ref={videoRef} playsInline muted autoPlay class="cam-video" />

      <div
        class="vf2"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - (touchX.current ?? 0)
          if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1)
        }}
      >
        <canvas ref={canvasRef} class="vf2-canvas" />
        <span class="vf2-glass" aria-hidden="true" />
        {!ready && !error && <div class="vf2-wait"><span class="spinner" /></div>}
        {shutterFx > 0 && <div key={shutterFx} class="vf2-shutter" />}
        {stamp && stampIndex >= 0 && (
          <div key={stamp.key} class="stock-stamp" aria-live="polite">
            <b>{filters[stampIndex].name}</b>
            <span>◂ ISO {isoOf(stampIndex)} · {pad2(stampIndex + 1)}/{pad2(filters.length)}</span>
          </div>
        )}
        {error && (
          <div class="vf2-error">
            <Icon name="camera" size={34} stroke={1.4} />
            <p>{error}</p>
            <button class="g-btn" onClick={() => location.reload()}>{t.retry}</button>
          </div>
        )}
        <header class="vf2-top">
          <button class="knob" onClick={onClose} aria-label={t.close}><Icon name="close" size={19} stroke={2} /></button>
          <div class="counter-window">
            <Counter value={remaining} />
            <span class="cw-label">{t.shotsLeft}</span>
          </div>
          {canFlash ? (
            <button class={`knob ${flashOn ? 'lit' : ''}`} onClick={() => setFlashOn(!flashOn)} aria-pressed={flashOn} aria-label={flashOn ? t.flashOn : t.flashOff}>
              <Icon name={flashOn ? 'bolt' : 'boltOff'} size={18} />
            </button>
          ) : (
            <span class="knob ghost" />
          )}
        </header>
        <p class="vf2-caption">{event.name}{dateLine ? ` · ${dateLine}` : ''}</p>
      </div>

      <div class="deck">
        {filters.length > 1 && (
          <div class="stocks" role="listbox" aria-label="Film">
            {filters.map((f, i) => (
              <button key={f.id} id={`stk-${f.id}`} role="option" aria-selected={f.id === filter} class={`stock ${f.id === filter ? 'on' : ''}`} onClick={() => pick(f.id)}>
                <span class="stock-box" style={stockStyle(f.id)}><i>{isoOf(i)}</i></span>
                <span class="stock-name">{f.name}</span>
              </button>
            ))}
          </div>
        )}
        <div class="deck-row">
          <button class={`print ${last ? '' : 'empty'} ${last?.wide ? 'wide' : ''}`} onClick={openRoll} aria-label={t.yourRoll}>
            {last ? <img key={last.key} src={last.src} alt="" /> : <Icon name="image" size={18} />}
            {pending > 0 && <span class="print-pending">{pending}</span>}
          </button>
          <Shutter left={remaining} total={event.max_photos_per_guest} disabled={!ready || busy || remaining <= 0} onPress={shoot} label={t.shutter} />
          <div class="deck-side">
            {!error && <button class="knob small" onClick={cycleZoom} aria-label="Zoom">{zoom}×</button>}
            {cams > 1 && (
              <button class="knob" onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')} aria-label={facing === 'user' ? t.cameraBack : t.cameraFront}>
                <Icon name="flip" size={19} />
              </button>
            )}
          </div>
        </div>
      </div>

      {screenFlash && <div class="screen-flash" />}

      {roll && (
        <Lightbox
          photos={roll}
          index={rollIndex}
          onIndex={setRollIndex}
          onClose={() => setRoll(null)}
          labels={{ close: t.close, prev: t.prev, next: t.next }}
          footer={(p) => (
            <>
              <div class="lb-info"><strong>{t.yourRoll}</strong><span>{formatDateTime(p.created_at, event.language)}</span></div>
              <a class="lb-action primary" href={`/api/g/${event.slug}/photos/${p.id}/download`} download><Icon name="download" size={18} /> {t.download}</a>
            </>
          )}
        />
      )}

      {finished && (
        <div class="cam-done">
          <div class="cam-done-card">
            <span class="cam-done-roll" aria-hidden="true"><Icon name="film" size={30} stroke={1.5} /></span>
            <h2>{t.rollFinished}</h2>
            <p>{t.rollFinishedBody}</p>
            <button class="g-btn" onClick={onClose}>{t.viewGallery}</button>
          </div>
        </div>
      )}
    </div>
  )
}
