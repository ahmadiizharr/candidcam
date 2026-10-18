import './lightbox.css'
import { useEffect, useRef } from 'preact/hooks'
import { Icon } from './icons.jsx'

/** Full-screen photo viewer with keyboard and swipe navigation. `footer(photo)` adds actions. */
export function Lightbox({ photos, index, onIndex, onClose, footer, labels = {} }) {
  const photo = photos[index]
  const touch = useRef(null)
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
  return (
    <div
      class="lb"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        const dx = e.changedTouches[0].clientX - (touch.current ?? 0)
        if (Math.abs(dx) > 50) {
          if (dx > 0 && index > 0) onIndex(index - 1)
          if (dx < 0 && index < photos.length - 1) onIndex(index + 1)
        }
      }}
    >
      <button class="lb-btn lb-close" onClick={onClose} aria-label={labels.close || 'Tutup'}><Icon name="close" size={20} /></button>
      {index > 0 && <button class="lb-btn lb-prev" onClick={() => onIndex(index - 1)} aria-label={labels.prev || 'Sebelumnya'}><Icon name="back" size={22} /></button>}
      {index < photos.length - 1 && <button class="lb-btn lb-next" onClick={() => onIndex(index + 1)} aria-label={labels.next || 'Berikutnya'}><Icon name="next" size={22} /></button>}
      <figure class="lb-fig" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <img key={photo.id} src={photo.url} alt="" style={{ aspectRatio: `${photo.width} / ${photo.height}` }} />
      </figure>
      {footer && <div class="lb-foot">{footer(photo)}</div>}
      <span class="lb-pos mono">{index + 1} / {photos.length}</span>
    </div>
  )
}
