import { useEffect, useState } from 'preact/hooks'
import { centerCrop, loadImage, PRESETS, snapshot, sourceSize, stillRenderer } from '../lib/filters.js'
import { composeFrame, ensureFont, loadFrameFonts } from '../lib/frame.js'
import { strings } from '../lib/i18n.js'
import { pad2 } from '../lib/format.js'
import { Hero, themeVars } from '../guest/Hero.jsx'
import { WatermarkPreview } from './steps.jsx'
import { Icon } from '../ui/icons.jsx'

let samplePromise = null
export const sampleImage = () => (samplePromise ||= loadImage('/static/sample.jpg'))

export function useSample() {
  const [img, setImg] = useState(null)
  useEffect(() => {
    sampleImage().then(setImg, () => {})
  }, [])
  return img
}

export function ratioOf(catalog, id) {
  const r = catalog.aspect_ratios.find((a) => a.id === id) || catalog.aspect_ratios[0]
  return r.w / r.h
}

/** The sample photo through a filter, cropped to the event ratio, as a data URL. */
export function renderSample(img, { filter = 'none', ratio = 3 / 4, height = 900 }) {
  const gl = stillRenderer()
  const { w, h } = sourceSize(img)
  gl.draw(img, { filter, crop: centerCrop(w, h, ratio), width: Math.round(height * ratio), height, seed: 3 })
  return gl.canvas.toDataURL('image/jpeg', 0.86)
}

function Phone({ children, dark }) {
  return (
    <div class={`phone ${dark ? 'phone-dark' : ''}`}>
      <div class="phone-notch" />
      <div class="phone-screen">{children}</div>
    </div>
  )
}

function GuestPhone({ draft, catalog, joined }) {
  const t = strings(draft.language)
  const event = {
    ...draft,
    name: draft.name || 'Nama Acara Kamu',
    guests_count: joined ? 1 : 0,
  }
  return (
    <Phone dark={catalog.themes.find((x) => x.id === draft.theme)?.dark !== false}>
      <div class={`gtheme theme-${draft.theme} preview-guest`} style={themeVars(draft)}>
        <Hero event={event} t={t} coverUrl={draft.coverPreview || null} />
        <div class="gh-actions">
          {joined ? (
            <>
              <p class="pv-hello">{t.hello('Rina')} · <span>{t.photosLeft(draft.max_photos_per_guest)}</span></p>
              <span class="g-btn"><Icon name="camera" size={18} /> {t.openCamera}</span>
              {draft.allow_gallery_upload && <span class="g-btn g-btn-ghost"><Icon name="image" size={18} /> {t.uploadPhoto}</span>}
            </>
          ) : (
            <>
              <span class="g-field pv-field">{t.enterYourName}</span>
              <span class="g-btn">{t.joinAlbum}</span>
            </>
          )}
        </div>
        <p class="gh-foot">{t.poweredBy}</p>
      </div>
    </Phone>
  )
}

function CameraPhone({ draft, catalog, filter, img }) {
  const ratio = ratioOf(catalog, draft.aspect_ratio)
  const [src, setSrc] = useState(null)
  useEffect(() => {
    if (img) setSrc(renderSample(img, { filter, ratio, height: 720 }))
  }, [img, filter, ratio])
  const name = catalog.filters.find((f) => f.id === filter)?.name
  return (
    <Phone dark>
      <div class="pv-cam">
        <div class="pv-cam-top">
          <span class="pv-cam-x"><Icon name="close" size={16} /></span>
          <span class="pv-counter">{pad2(draft.max_photos_per_guest)}<small>/{pad2(draft.max_photos_per_guest)}</small></span>
          <span class="pv-cam-x"><Icon name="flip" size={16} /></span>
        </div>
        <div class="pv-viewfinder" style={{ aspectRatio: `${ratio}` }}>
          {src && <img src={src} alt="" />}
          <span class="pv-corner tl" /><span class="pv-corner tr" /><span class="pv-corner bl" /><span class="pv-corner br" />
        </div>
        <p class="pv-filter-name">{name}</p>
        <div class="pv-shutter-row">
          <span class="pv-last" />
          <span class="pv-shutter" />
          <span class="pv-last pv-ghost" />
        </div>
      </div>
    </Phone>
  )
}

function FramePreview({ draft, catalog, img }) {
  const [src, setSrc] = useState(null)
  const ratio = ratioOf(catalog, draft.aspect_ratio)
  useEffect(() => {
    loadFrameFonts()
  }, [])
  useEffect(() => {
    if (!img) return
    let alive = true
    ;(async () => {
      await ensureFont(catalog, draft.frame_font)
      const gl = stillRenderer()
      const { w, h } = sourceSize(img)
      gl.draw(img, { filter: 'none', crop: centerCrop(w, h, ratio), width: Math.round(900 * ratio), height: 900 })
      const out = composeFrame(snapshot(gl), draft, catalog)
      if (alive) setSrc(out.toDataURL('image/jpeg', 0.88))
    })()
    return () => (alive = false)
  }, [img, ratio, draft.frame_style, draft.frame_paper, draft.frame_caption, draft.frame_date, draft.frame_hashtag, draft.frame_font, draft.frame_text_color, draft.frame_date_format])
  return (
    <div class="pv-table">
      {src && <img class={`pv-print ${draft.frame_style === 'polaroid' ? 'is-polaroid' : ''}`} src={src} alt="Pratinjau bingkai" style={{ maxWidth: ratio < 0.6 ? '62%' : '78%' }} />}
      <p class="pv-table-note">{draft.frame_style === 'polaroid' ? 'Setiap foto tamu akan tersimpan seperti ini.' : 'Foto tersimpan tanpa bingkai.'}</p>
    </div>
  )
}

export function WizardPreview({ stepId, draft, catalog, focusFilter, eventId }) {
  const img = useSample()
  if (stepId === 'ratio') return <CameraPhone draft={draft} catalog={catalog} filter="none" img={img} />
  if (stepId === 'filters') {
    const f = draft.filters.includes(focusFilter) ? focusFilter : draft.filters[0] || 'none'
    return <CameraPhone draft={draft} catalog={catalog} filter={f} img={img} />
  }
  if (stepId === 'frame') return <FramePreview draft={draft} catalog={catalog} img={img} />
  if (stepId === 'watermark') return <WatermarkPreview draft={draft} eventId={eventId} />
  if (stepId === 'display') return <DisplayMock draft={draft} catalog={catalog} />
  return <GuestPhone draft={draft} catalog={catalog} joined={stepId === 'settings' || stepId === 'schedule' || stepId === 'confirm'} />
}

export { PRESETS }

/** Small schematic of the live display with the chosen layout and palette. */
function DisplayMock({ draft, catalog }) {
  const p = catalog.display_palettes.find((x) => x.id === draft.display_palette) || catalog.display_palettes[0]
  const shots = ['/static/guest-1.jpg', '/static/guest-2.jpg', '/static/sample.jpg', '/static/guest-3.jpg', '/static/guest-4.jpg', '/static/guest-5.jpg']
  return (
    <div class={`dmock dm-${draft.display_layout}`} style={{ '--bg': p.bg, '--panel': p.panel, '--ink': p.ink, '--accent': p.accent }}>
      <div class="dm-screen">
        {shots.map((s, i) => <img key={i} src={s} alt="" class={`dm-shot s${i}`} />)}
        <div class="dm-ticket"><b>{draft.couple_names || draft.name || 'Nama Acara'}</b><span class="dm-qr" /></div>
      </div>
      <p class="pv-table-note">{catalog.display_layouts.find((l) => l.id === draft.display_layout)?.name.id} · {p.name}</p>
    </div>
  )
}
