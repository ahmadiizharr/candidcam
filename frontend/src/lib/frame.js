// Polaroid frame composed onto the guest's photo before upload, so the frame is part of the
// saved image. The wizard preview calls the same function with the sample photo.

export function formatFrameDate(iso, format) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return format === 'mm/dd/yyyy' ? `${m}.${d}.${y}` : `${d}.${m}.${y}`
}

export function fontFor(catalog, id) {
  return catalog.frame_fonts.find((f) => f.id === id) || catalog.frame_fonts[0]
}

export function paperFor(catalog, id) {
  return catalog.frame_papers.find((p) => p.id === id) || catalog.frame_papers[0]
}

const cssFont = (f, px) => `${f.style} ${f.weight} ${Math.round(px)}px "${f.family}"`

/** Wait until the frame font can be drawn on a canvas (Google Fonts load lazily). */
export async function ensureFont(catalog, id) {
  const f = fontFor(catalog, id)
  try {
    await document.fonts.load(cssFont(f, 40), 'Aa')
  } catch {
    /* falls back to the browser's default font */
  }
}

let grain = null
function paperGrain() {
  if (grain) return grain
  const c = document.createElement('canvas')
  c.width = c.height = 160
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(160, 160)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() < 0.5 ? 0 : 255
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = Math.random() * 14
  }
  ctx.putImageData(img, 0, 0)
  grain = c
  return c
}

function fitText(ctx, f, text, px, maxW) {
  let size = px
  ctx.font = cssFont(f, size)
  while (size > 10 && ctx.measureText(text).width > maxW) {
    size *= 0.92
    ctx.font = cssFont(f, size)
  }
  return size
}

/**
 * Returns a canvas with `photo` (canvas/image) inside the event's frame, or the photo itself
 * when the event has no frame. `ev` uses the API's event fields.
 */
export function composeFrame(photo, ev, catalog) {
  if (!ev || ev.frame_style !== 'polaroid') return photo
  const W = photo.width
  const H = photo.height
  const tall = H / W > 1.5
  const side = Math.round(W * 0.055)
  const bottom = Math.round(W * (tall ? 0.24 : 0.29))
  const out = document.createElement('canvas')
  out.width = W + side * 2
  out.height = H + side + bottom
  const ctx = out.getContext('2d')
  const paper = paperFor(catalog, ev.frame_paper)
  ctx.fillStyle = paper.paper
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.fillStyle = ctx.createPattern(paperGrain(), 'repeat')
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(photo, side, side, W, H)
  ctx.strokeStyle = 'rgba(0,0,0,0.14)'
  ctx.lineWidth = Math.max(1, W / 900)
  ctx.strokeRect(side + 0.5, side + 0.5, W - 1, H - 1)

  const f = fontFor(catalog, ev.frame_font)
  const caption = (ev.frame_caption || '').trim()
  const meta = [formatFrameDate(ev.frame_date, ev.frame_date_format), (ev.frame_hashtag || '').trim()].filter(Boolean).join('   ·   ')
  if (!caption && !meta) return out

  const maxW = W - side * 2
  const scale = { bebas: 1.25, typewriter: 0.82, script: 1.12 }[f.id] || 1
  ctx.fillStyle = ev.frame_text_color || paper.ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const cx = out.width / 2
  const area = { top: side + H, h: bottom }
  if (caption && meta) {
    fitText(ctx, f, caption, bottom * 0.3 * scale, maxW)
    ctx.fillText(caption, cx, area.top + area.h * 0.44)
    const metaFont = { ...f, style: 'normal' }
    fitText(ctx, metaFont, meta, bottom * 0.12 * Math.min(scale, 1.1), maxW)
    ctx.globalAlpha = 0.72
    ctx.fillText(meta, cx, area.top + area.h * 0.74)
    ctx.globalAlpha = 1
  } else if (caption) {
    fitText(ctx, f, caption, bottom * 0.32 * scale, maxW)
    ctx.fillText(caption, cx, area.top + area.h * 0.52)
  } else {
    const metaFont = { ...f, style: 'normal' }
    fitText(ctx, metaFont, meta, bottom * 0.15 * Math.min(scale, 1.1), maxW)
    ctx.globalAlpha = 0.8
    ctx.fillText(meta, cx, area.top + area.h * 0.52)
    ctx.globalAlpha = 1
  }
  return out
}

export function canvasToBlob(canvas, quality = 0.9) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal menyimpan foto'))), 'image/jpeg', quality),
  )
}

export const FRAME_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Cormorant+Garamond:ital,wght@1,500&family=Dancing+Script:wght@600&family=Montserrat:wght@600&family=Playfair+Display:ital,wght@1,500&family=Special+Elite&display=swap'

export function loadFrameFonts() {
  if (document.querySelector('link[data-frame-fonts]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = FRAME_FONTS_URL
  link.dataset.frameFonts = '1'
  document.head.appendChild(link)
}
