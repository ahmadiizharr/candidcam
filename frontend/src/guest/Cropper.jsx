import { createPortal } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'

/**
 * Fixed-ratio crop box over an image. Drag the box to move it, drag the corner to resize.
 * Calls onDone({x, y, w, h}) in 0–1 image units.
 */
export function Cropper({ image, ratio, t, onCancel, onDone, busy, themeClass = 'theme-dark_elegant' }) {
  const wrap = useRef(null)
  const [box, setBox] = useState(null)
  const [view, setView] = useState(null)
  const drag = useRef(null)
  const iw = image.width || image.naturalWidth
  const ih = image.height || image.naturalHeight
  const url = useRef(null)

  if (!url.current) {
    const c = document.createElement('canvas')
    const s = Math.min(1, 1400 / Math.max(iw, ih))
    c.width = Math.round(iw * s)
    c.height = Math.round(ih * s)
    c.getContext('2d').drawImage(image, 0, 0, c.width, c.height)
    url.current = c.toDataURL('image/jpeg', 0.85)
  }

  useEffect(() => {
    const fit = () => {
      const r = wrap.current.getBoundingClientRect()
      const s = Math.min(r.width / iw, r.height / ih)
      const v = { w: iw * s, h: ih * s }
      setView(v)
      // Largest centred box with the event ratio.
      let bw = v.w
      let bh = bw / ratio
      if (bh > v.h) {
        bh = v.h
        bw = bh * ratio
      }
      setBox({ x: (v.w - bw) / 2, y: (v.h - bh) / 2, w: bw, h: bh })
    }
    fit()
    addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [])

  const onDown = (mode) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { mode, x: e.clientX, y: e.clientY, box: { ...box } }
  }
  const onMove = (e) => {
    const d = drag.current
    if (!d || !view) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (d.mode === 'move') {
      setBox({ ...d.box, x: Math.min(view.w - d.box.w, Math.max(0, d.box.x + dx)), y: Math.min(view.h - d.box.h, Math.max(0, d.box.y + dy)) })
    } else {
      let w = Math.max(60, d.box.w + Math.max(dx, dy * ratio))
      w = Math.min(w, view.w - d.box.x, (view.h - d.box.y) * ratio)
      setBox({ ...d.box, w, h: w / ratio })
    }
  }
  const onUp = () => (drag.current = null)

  // Into <body>, so the guest theme wrapper can't trap this fixed overlay.
  return createPortal(
    <div class={`crop-back gtheme ${themeClass}`} role="dialog" aria-modal="true">
      <div class="crop">
        <h3>{t.adjustTitle}</h3>
        <p>{t.adjustBody}</p>
        <div class="crop-area" ref={wrap} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {view && (
            <div class="crop-img" style={{ width: `${view.w}px`, height: `${view.h}px`, backgroundImage: `url(${url.current})` }}>
              {box && (
                <div class="crop-box" style={{ left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` }} onPointerDown={onDown('move')}>
                  <span class="crop-grid" />
                  <span class="crop-handle" onPointerDown={onDown('resize')} />
                </div>
              )}
            </div>
          )}
        </div>
        <div class="crop-actions">
          <button class="g-btn g-btn-ghost" onClick={onCancel} disabled={busy}>{t.cancel}</button>
          <button class="g-btn" disabled={!box || busy} onClick={() => onDone({ x: box.x / view.w, y: box.y / view.h, w: box.w / view.w, h: box.h / view.h })}>
            {busy ? t.uploading : t.usePhoto}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
