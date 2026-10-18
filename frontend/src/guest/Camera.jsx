import { useEffect, useRef, useState } from 'preact/hooks'
import { api } from '../lib/api.js'
import { centerCrop, createRenderer, loadImage, renderThumbs, snapshot, stillRenderer } from '../lib/filters.js'
import { canvasToBlob, composeFrame, ensureFont, loadFrameFonts } from '../lib/frame.js'
import { formatDateTime } from '../lib/format.js'
import { Icon } from '../ui/icons.jsx'
import { Lightbox } from '../ui/Lightbox.jsx'
import { toast } from '../ui/ui.jsx'

const MAX_OUT = 2000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function uploadPhoto(slug, token, blob, { filter, source }) {
  const form = new FormData()
  form.append('photo', blob, 'photo.jpg')
  form.append('filter', filter)
  form.append('source', source)
  return api(`/api/g/${slug}/photos`, { method: 'POST', form, headers: { 'X-Guest-Token': token } })
}

/** Centre crop for the event ratio, narrowed further by a digital zoom factor. */
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
    return () => {
      removeEventListener('resize', on)
      window.visualViewport?.removeEventListener('resize', on)
    }
  }, [])
  return vp
}

/** Film-canister counter: one dot per shot on the roll, the number is what's left. */
function RollDial({ left, total }) {
  const n = Math.min(total, 36)
  const dots = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    return { x: 30 + Math.cos(a) * 24, y: 30 + Math.sin(a) * 24, on: i < Math.round((left / total) * n) }
  })
  return (
    <span class="roll-dial" aria-hidden="true">
      <svg viewBox="0 0 60 60">
        {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={n > 24 ? 1.5 : 1.9} class={d.on ? 'on' : ''} />)}
      </svg>
      <b>{Math.max(0, left)}</b>
    </span>
  )
}

export function Camera({ event, catalog, guest, token, t, onClose, onShot }) {
  const ratio = (() => {
    const r = catalog.aspect_ratios.find((a) => a.id === event.aspect_ratio) || catalog.aspect_ratios[0]
    return r.w / r.h
  })()
  const filters = catalog.filters.filter((f) => event.filters.includes(f.id))
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const rendererRef = useRef(null)
  const streamRef = useRef(null)
  const live = useRef({ filter: filters[0]?.id || 'none', facing: 'environment', zoom: 1, digital: 1 })
  const [facing, setFacing] = useState('environment')
  const [filter, setFilter] = useState(live.current.filter)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  const [thumbs, setThumbs] = useState({})
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
  const vp = useViewport()

  live.current.filter = filter
  live.current.facing = facing

  // Biggest box with the event ratio; the controls float over its lower edge when it's tall.
  const boxW = Math.min(vp.w - 12, (vp.h - 14) * ratio)
  const boxH = boxW / ratio

  useEffect(() => {
    if (event.frame_style === 'polaroid') {
      loadFrameFonts()
      ensureFont(catalog, event.frame_font)
    }
    // Round filter swatches from the sample photo: same look on every phone, no camera cost.
    loadImage('/static/sample.jpg')
      .then((img) => setThumbs(renderThumbs(img, filters.map((f) => f.id), { ratio: 1, size: 120 })))
      .catch(() => {})
  }, [])

  // (Re)start the camera whenever the facing mode changes.
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
        live.current.zoom = 1
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

  // Render loop: video -> filter -> viewfinder canvas, sized to the box on screen.
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
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cap = r.kind === 'cpu' ? 480 : 1400
      const box = canvas.getBoundingClientRect()
      const h = Math.min(box.height * dpr, cap)
      const w = h * ratio
      const L = live.current
      r.draw(v, { filter: L.filter, crop: zoomedCrop(v.videoWidth, v.videoHeight, ratio, L.digital), mirror: L.facing === 'user', width: w, height: h, seed: (performance.now() % 1000) / 10 })
      if (first) {
        first = false
        setReady(true)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [facing])

  // Zoom levels: native when the camera exposes zoom, otherwise a digital crop up to 3x.
  const levels = zoomCaps
    ? [zoomCaps.min <= 0.5 ? 0.5 : null, 1, zoomCaps.max >= 2 ? 2 : null, zoomCaps.max >= 5 ? 5 : zoomCaps.max >= 3 ? 3 : null].filter(Boolean)
    : [1, 2, 3]
  const applyZoom = async (z) => {
    if (facing !== 'environment' && cams > 1) {
      setFacing('environment')
      return
    }
    setZoom(z)
    live.current.zoom = z
    const track = streamRef.current?.getVideoTracks()[0]
    if (zoomCaps && track) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: Math.min(zoomCaps.max, Math.max(zoomCaps.min, z)) }] })
        live.current.digital = 1
        return
      } catch {
        /* fall back to digital */
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
      const chosen = live.current.filter
      const crop = zoomedCrop(v.videoWidth, v.videoHeight, ratio, live.current.digital)
      const cw = v.videoWidth * crop.w
      const ch = v.videoHeight * crop.h
      const s = Math.min(1, MAX_OUT / Math.max(cw, ch))
      const r = stillRenderer()
      r.draw(v, { filter: chosen, crop, mirror: live.current.facing === 'user', width: Math.round(cw * s), height: Math.round(ch * s), seed: Math.random() * 100 })
      let shot = snapshot(r)
      if (useTorch) track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {})
      setScreenFlash(false)
      setBusy(false)
      if (event.frame_style === 'polaroid') {
        await ensureFont(catalog, event.frame_font)
        shot = composeFrame(shot, event, catalog)
      }
      setLast({ src: shot.toDataURL('image/jpeg', 0.5), key: Date.now() })
      const blob = await canvasToBlob(shot, 0.9)
      try {
        const res = await uploadPhoto(event.slug, token, blob, { filter: chosen, source: 'camera' })
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

  // Preview this guest's own roll without leaving the camera.
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
    setFilter(id)
    document.getElementById(`cf-${id}`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }
  const step = (dir) => {
    const i = filters.findIndex((f) => f.id === filter)
    const n = filters[Math.min(filters.length - 1, Math.max(0, i + dir))]
    if (n && n.id !== filter) pick(n.id)
  }
  useEffect(() => {
    document.getElementById(`cf-${filter}`)?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [])

  return (
    <div class="cam" style={{ '--box-w': `${boxW}px`, '--box-h': `${boxH}px` }}>
      <video ref={videoRef} playsInline muted autoPlay class="cam-video" />

      <div
        class="vf"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - (touchX.current ?? 0)
          if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1)
        }}
      >
        <canvas ref={canvasRef} class="vf-canvas" />
        <div class="vf-shade-top" />
        <div class="vf-shade-bottom" />
        {!ready && !error && <div class="vf-wait"><span class="spinner" /></div>}
        {shutterFx > 0 && <div key={shutterFx} class="vf-flash" />}
        {error && (
          <div class="vf-error">
            <Icon name="camera" size={34} stroke={1.4} />
            <p>{error}</p>
            <button class="g-btn" onClick={() => location.reload()}>{t.retry}</button>
          </div>
        )}

        <header class="vf-top">
          <button class="vf-round" onClick={onClose} aria-label={t.close}><Icon name="back" size={20} stroke={2} /></button>
          <div class="vf-title">
            <span class="vf-pill">{event.name}</span>
            <span class="vf-pill vf-pill-sub">{facing === 'user' ? t.cameraFront : t.cameraBack}</span>
          </div>
          {canFlash ? (
            <button class={`vf-round ${flashOn ? 'on' : ''}`} onClick={() => setFlashOn(!flashOn)} aria-pressed={flashOn} aria-label={flashOn ? t.flashOn : t.flashOff}>
              <Icon name={flashOn ? 'bolt' : 'boltOff'} size={19} />
            </button>
          ) : (
            <span class="vf-round vf-ghost" />
          )}
        </header>
      </div>

      <div class="cam-controls">
        {!error && (
          <div class="zoom-pill" role="group" aria-label="Zoom">
            {cams > 1 && (
              <button class={facing === 'user' ? 'on' : ''} onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')} aria-label={facing === 'user' ? t.cameraBack : t.cameraFront}>
                <Icon name={facing === 'user' ? 'flip' : 'person'} size={16} />
              </button>
            )}
            {(facing === 'environment' || cams <= 1) &&
              levels.map((z) => (
                <button key={z} class={zoom === z ? 'on' : ''} onClick={() => applyZoom(z)}>
                  {z}x
                </button>
              ))}
          </div>
        )}

        {filters.length > 1 && (
          <div class="cf-row" role="listbox" aria-label="Filter">
            {filters.map((f) => (
              <button key={f.id} id={`cf-${f.id}`} role="option" aria-selected={f.id === filter} class={`cf ${f.id === filter ? 'on' : ''}`} onClick={() => pick(f.id)}>
                <span class="cf-dot">{thumbs[f.id] && <img src={thumbs[f.id]} alt="" />}</span>
                <span class="cf-name">{f.name}</span>
              </button>
            ))}
          </div>
        )}

        <div class="cam-bottom">
          <button class="roll-btn" onClick={openRoll} aria-label={t.yourRoll}><RollDial left={remaining} total={event.max_photos_per_guest} /></button>
          <button class="shutter" onClick={shoot} disabled={!ready || busy || remaining <= 0} aria-label={t.shutter}>
            <span />
          </button>
          <button class={`last-shot ${last ? '' : 'empty'}`} onClick={openRoll} aria-label={t.yourRoll}>
            {last && <img key={last.key} src={last.src} alt="" />}
            {pending > 0 && <span class="last-pending">{pending}</span>}
          </button>
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
              <a class="lb-action icon" href={`/api/g/${event.slug}/photos/${p.id}/download`} aria-label={t.download}><Icon name="download" size={18} /></a>
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
