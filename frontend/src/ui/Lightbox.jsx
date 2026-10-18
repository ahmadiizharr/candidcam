import './lightbox.css'
import { createPortal } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Icon } from './icons.jsx'

/**
 * Full-screen photo viewer. Rendered into <body> so no ancestor (containment, transforms)
 * can trap the fixed overlay inside the page. Tap the photo to hide the controls, swipe
 * sideways to browse, swipe down to close. `footer(photo)` adds actions.
 */
export function Lightbox({ photos, index, onIndex, onClose, footer, labels = {} }) {
  const photo = photos[index]
  const touch = useRef(null)
  const [chrome, setChrome] = useState(true)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1)
    }
    addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [index, photos.length])
  if (!photo) return null
  return createPortal(
    <div class={`lb ${chrome ? '' : 'lb-bare'}`} role="dialog" aria-modal="true">
      <div
        class="lb-stage"
        onClick={() => setChrome(!chrome)}
        onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
        onTouchEnd={(e) => {
          if (!touch.current) return
          const dx = e.changedTouches[0].clientX - touch.current.x
          const dy = e.changedTouches[0].clientY - touch.current.y
          if (dy > 90 && Math.abs(dy) > Math.abs(dx)) onClose()
          else if (Math.abs(dx) > 50) {
            if (dx > 0 && index > 0) onIndex(index - 1)
            if (dx < 0 && index < photos.length - 1) onIndex(index + 1)
          }
        }}
      >
        <img key={photo.id} src={photo.url} alt="" />
      </div>
      <header class="lb-top">
        <button class="lb-btn" onClick={onClose} aria-label={labels.close || 'Tutup'}><Icon name="close" size={20} /></button>
        <span class="lb-pos">{index + 1} / {photos.length}</span>
        <span class="lb-btn lb-ghost" />
      </header>
      {index > 0 && <button class="lb-btn lb-prev" onClick={() => onIndex(index - 1)} aria-label={labels.prev || 'Sebelumnya'}><Icon name="back" size={22} /></button>}
      {index < photos.length - 1 && <button class="lb-btn lb-next" onClick={() => onIndex(index + 1)} aria-label={labels.next || 'Berikutnya'}><Icon name="next" size={22} /></button>}
      {footer && <footer class="lb-foot">{footer(photo)}</footer>}
    </div>,
    document.body,
  )
}
