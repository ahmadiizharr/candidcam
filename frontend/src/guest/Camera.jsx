import { useEffect, useRef, useState } from 'preact/hooks'
import { api } from '../lib/api.js'
import { centerCrop, createRenderer, renderThumbs, snapshot, stillRenderer } from '../lib/filters.js'
import { canvasToBlob, composeFrame, ensureFont, loadFrameFonts } from '../lib/frame.js'
import { pad2 } from '../lib/format.js'
import { Icon } from '../ui/icons.jsx'
import { toast } from '../ui/ui.jsx'

const MAX_OUT = 2000

export async function uploadPhoto(slug, token, blob, { filter, source }) {
  const form = new FormData()
  form.append('photo', blob, 'photo.jpg')
  form.append('filter', filter)
  form.append('source', source)
  return api(`/api/g/${slug}/photos`, { method: 'POST', form, headers: { 'X-Guest-Token': token } })
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
  const stateRef = useRef({ filter: filters[0]?.id || 'none', facing: 'user' })
  const [facing, setFacing] = useState('user')
  const [filter, setFilter] = useState(stateRef.current.filter)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  const [thumbs, setThumbs] = useState({})
  const [left, setLeft] = useState(guest.photos_left)
  const [pending, setPending] = useState(0)
  const [last, setLast] = useState(null)
  const [flash, setFlash] = useState(0)
  const [canFlip, setCanFlip] = useState(false)
  const touchX = useRef(null)

  stateRef.current.filter = filter
  stateRef.current.facing = facing

  // Fonts for the frame are needed at capture time; start loading them now.
  useEffect(() => {
    if (event.frame_style === 'polaroid') {
      loadFrameFonts()
      ensureFont(catalog, event.frame_font)
    }
  }, [])

  // Start / restart the camera when the facing mode changes.
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
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
        setCanFlip(devices.filter((d) => d.kind === 'videoinput').length > 1)
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

  // Render loop: video -> filter -> visible canvas.
  useEffect(() => {
    let raf = 0
    let thumbsDone = false
    const v = videoRef.current
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (document.hidden || !canvasRef.current || !v.videoWidth || v.readyState < 2) return
      if (!rendererRef.current) {
        rendererRef.current = createRenderer({ canvas: canvasRef.current })
      }
      const r = rendererRef.current
      const box = canvasRef.current.parentElement.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cap = r.kind === 'cpu' ? 420 : 1280
      let h = Math.min(box.height * dpr, cap)
      let w = h * ratio
      if (w > box.width * dpr) {
        w = box.width * dpr
        h = w / ratio
      }
      const crop = centerCrop(v.videoWidth, v.videoHeight, ratio)
      r.draw(v, { filter: stateRef.current.filter, crop, mirror: stateRef.current.facing === 'user', width: w, height: h, seed: (performance.now() % 1000) / 10 })
      if (!thumbsDone) {
        thumbsDone = true
        setReady(true)
        setTimeout(() => {
          try {
            setThumbs(renderThumbs(v, filters.map((f) => f.id), { ratio, size: 112, mirror: stateRef.current.facing === 'user' }))
          } catch {
            /* thumbnails are decoration */
          }
        }, 400)
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [facing])

  const remaining = left - pending
  const finished = left <= 0 && pending === 0

  async function shoot() {
    const v = videoRef.current
    if (!ready || remaining <= 0 || !v.videoWidth) return
    navigator.vibrate?.(18)
    setFlash((n) => n + 1)
    setPending((n) => n + 1)
    const chosen = stateRef.current.filter
    try {
      const crop = centerCrop(v.videoWidth, v.videoHeight, ratio)
      const cw = v.videoWidth * crop.w
      const ch = v.videoHeight * crop.h
      const s = Math.min(1, MAX_OUT / Math.max(cw, ch))
      const r = stillRenderer()
      r.draw(v, { filter: chosen, crop, mirror: stateRef.current.facing === 'user', width: Math.round(cw * s), height: Math.round(ch * s), seed: Math.random() * 100 })
      let shot = snapshot(r)
      if (event.frame_style === 'polaroid') {
        await ensureFont(catalog, event.frame_font)
        shot = composeFrame(shot, event, catalog)
      }
      const preview = shot.toDataURL('image/jpeg', 0.5)
      setLast({ src: preview, key: Date.now() })
      const blob = await canvasToBlob(shot, 0.9)
      const res = await uploadPhoto(event.slug, token, blob, { filter: chosen, source: 'camera' })
      setLeft(res.guest.photos_left)
      onShot?.(res.photo, res.guest)
    } catch (e) {
      toast(e.status === 409 ? t.rollFinished : `${t.captureFailed}: ${e.message}`, 'error')
      if (e.status === 409) setLeft(0)
    } finally {
      setPending((n) => n - 1)
    }
  }

  const pick = (id) => {
    setFilter(id)
    document.getElementById(`cf-${id}`)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }
  const step = (dir) => {
    const i = filters.findIndex((f) => f.id === filter)
    const n = filters[Math.min(filters.length - 1, Math.max(0, i + dir))]
    if (n) pick(n.id)
  }

  const current = filters.find((f) => f.id === filter)
  return (
    <div class="cam" role="application" aria-label="Kamera">
      <video ref={videoRef} playsInline muted autoPlay class="cam-video" />
      <header class="cam-top">
        <button class="cam-icon" onClick={onClose} aria-label={t.close}><Icon name="close" size={20} /></button>
        <div class="cam-counter" aria-live="polite">
          <span class="cc-n">{pad2(Math.max(0, remaining))}</span>
          <span class="cc-of">/{pad2(event.max_photos_per_guest)}</span>
          <span class="cc-label">{t.shotsLeft}</span>
        </div>
        <span class="cam-icon cam-ghost" />
      </header>

      <div
        class="cam-stage"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          const dx = e.changedTouches[0].clientX - (touchX.current ?? 0)
          if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1)
        }}
      >
        <div class="cam-frame" style={{ aspectRatio: `${ratio}` }}>
          <canvas ref={canvasRef} class="cam-canvas" />
          <span class="cam-corner tl" /><span class="cam-corner tr" /><span class="cam-corner bl" /><span class="cam-corner br" />
          {!ready && !error && <div class="cam-wait"><span class="spinner" /></div>}
          {flash > 0 && <div key={flash} class="cam-flash" />}
          {error && (
            <div class="cam-error">
              <Icon name="camera" size={34} stroke={1.4} />
              <p>{error}</p>
              <button class="g-btn" onClick={() => location.reload()}>{t.retry}</button>
            </div>
          )}
        </div>
        <p class="cam-filter-name" key={filter}>{current?.name}</p>
      </div>

      {filters.length > 1 && (
        <div class="cam-filters" role="listbox" aria-label="Filter">
          {filters.map((f) => (
            <button key={f.id} id={`cf-${f.id}`} role="option" aria-selected={f.id === filter} class={`cf ${f.id === filter ? 'on' : ''}`} onClick={() => pick(f.id)}>
              <span class="cf-img" style={{ aspectRatio: `${ratio}` }}>{thumbs[f.id] && <img src={thumbs[f.id]} alt="" />}</span>
              <span class="cf-name">{f.name}</span>
            </button>
          ))}
        </div>
      )}

      <footer class="cam-bottom">
        <button class="cam-last" onClick={onClose} aria-label={t.viewGallery}>
          {last ? <img key={last.key} src={last.src} alt="" /> : <Icon name="image" size={20} />}
          {pending > 0 && <span class="cam-pending">{pending}</span>}
        </button>
        <button class="cam-shutter" onClick={shoot} disabled={!ready || remaining <= 0} aria-label={t.shutter}>
          <span />
        </button>
        {canFlip ? (
          <button class="cam-icon cam-flip" onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')} aria-label={facing === 'user' ? t.cameraBack : t.cameraFront}>
            <Icon name="flip" size={22} />
          </button>
        ) : (
          <span class="cam-icon cam-ghost" />
        )}
      </footer>

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
