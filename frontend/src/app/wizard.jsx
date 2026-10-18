import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { api } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'
import { shrinkFile } from '../lib/image.js'
import { Icon } from '../ui/icons.jsx'
import { copyText, toast, toastError } from '../ui/ui.jsx'
import { WizardPreview } from './preview.jsx'
import { Link, navigate } from './router.jsx'
import { draftBody, fontName, newDraft, STEPS, StepCover, StepFilters, StepFrame, StepName, StepRatio, StepSchedule, StepSettings, StepTheme, StepWatermark, stepProblem } from './steps.jsx'

const STORE = 'candid:wizard'
const BODY = { name: StepName, theme: StepTheme, cover: StepCover, ratio: StepRatio, filters: StepFilters, frame: StepFrame, watermark: StepWatermark, settings: StepSettings, schedule: StepSchedule }

export async function uploadLogo(eventId, file) {
  const form = new FormData()
  form.append('image', file, 'logo.png')
  return api(`/api/events/${eventId}/watermark`, { method: 'POST', form })
}

export async function uploadCover(eventId, file) {
  const form = new FormData()
  form.append('photo', await shrinkFile(file, 1800), 'cover.jpg')
  return api(`/api/events/${eventId}/cover`, { method: 'POST', form })
}

function loadSaved(catalog) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) || 'null')
    if (saved?.draft) return { ...newDraft(catalog), ...saved.draft, coverFile: null, coverPreview: null, wmLogoFile: null, wmLogoPreview: null, slugState: undefined, step: saved.step || 0 }
  } catch {
    /* ignore */
  }
  return { ...newDraft(catalog), step: 0 }
}

export function Wizard({ catalog }) {
  const host = location.host
  const initial = useMemo(() => loadSaved(catalog), [])
  const [step, setStep] = useState(Math.min(initial.step, STEPS.length - 1))
  const [draft, setDraft] = useState(() => { const { step: _s, ...d } = initial; return d })
  const [focusFilter, setFocusFilter] = useState('amber_vintage')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState(null)
  const set = useCallback((patch) => setDraft((d) => ({ ...d, ...patch })), [])

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ step, draft: { ...draftBody(draft), slugTouched: draft.slugTouched } }))
    } catch {
      /* private mode */
    }
  }, [draft, step])

  const s = STEPS[step]
  const problem = stepProblem(s.id, draft)
  const go = (i) => {
    setStep(i)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const next = () => {
    if (problem) return toast(problem, 'error')
    go(step + 1)
  }

  async function create() {
    for (const st of STEPS) {
      const p = stepProblem(st.id, draft)
      if (p) {
        go(STEPS.indexOf(st))
        return toast(p, 'error')
      }
    }
    setBusy(true)
    try {
      let ev = await api('/api/events', { method: 'POST', body: draftBody(draft) })
      if (draft.coverFile) {
        try {
          ev = await uploadCover(ev.id, draft.coverFile)
        } catch (e) {
          toast(`Acara dibuat, tapi foto sampul gagal diunggah: ${e.message}`, 'error')
        }
      }
      if (draft.wm_mode === 'image' && draft.wmLogoFile) {
        try {
          ev = await uploadLogo(ev.id, draft.wmLogoFile)
        } catch (e) {
          toast(`Logo watermark gagal diunggah: ${e.message}`, 'error')
        }
      }
      sessionStorage.removeItem(STORE)
      setCreated(ev)
    } catch (e) {
      toastError(e)
      if (e.status === 409) go(0)
    } finally {
      setBusy(false)
    }
  }

  if (created) return <Success ev={created} />

  const Body = BODY[s.id]
  return (
    <div class="wizard">
      <div class="wz-main">
        <div class="wz-top">
          <Link class="btn btn-sm btn-ghost" href="/app"><Icon name="close" size={16} /> Batal</Link>
          <span class="kicker">Langkah {step + 1} dari {STEPS.length}</span>
        </div>
        <ol class="wz-progress" aria-label="Langkah">
          {STEPS.map((st, i) => (
            <li key={st.id} class={i < step ? 'done' : i === step ? 'now' : ''}>
              <button type="button" onClick={() => i < step && go(i)} disabled={i >= step} title={st.label}>
                <span class="sr-only">{st.label}</span>
              </button>
            </li>
          ))}
        </ol>
        <header class="wz-head">
          <p class="wz-label"><Icon name={s.icon} size={16} /> {s.label}</p>
          <h1 class="serif">{s.title}</h1>
          <p class="muted">{s.sub}</p>
        </header>
        <section class="wz-body" key={s.id}>
          {s.id === 'confirm' ? (
            <Summary draft={draft} catalog={catalog} host={host} go={go} />
          ) : (
            <Body draft={draft} set={set} catalog={catalog} host={host} onFocus={setFocusFilter} />
          )}
        </section>
        <footer class="wz-foot">
          <button type="button" class="btn" onClick={() => go(step - 1)} disabled={step === 0}><Icon name="back" size={16} /> Kembali</button>
          <div class="row-gap">
            {s.id === 'schedule' && !draft.starts_at && !draft.ends_at && <button type="button" class="btn btn-ghost" onClick={() => go(step + 1)}>Lewati</button>}
            {s.id === 'confirm' ? (
              <button type="button" class="btn btn-accent btn-lg" onClick={create} disabled={busy}>{busy ? 'Membuat…' : 'Buat Candid Cam'}</button>
            ) : (
              <button type="button" class="btn btn-primary" onClick={next}>Lanjut <Icon name="next" size={16} /></button>
            )}
          </div>
        </footer>
      </div>
      <aside class="wz-preview" aria-label="Pratinjau">
        <p class="kicker">Pratinjau {s.id === 'frame' || s.id === 'watermark' ? 'hasil foto' : s.id === 'ratio' || s.id === 'filters' ? 'kamera tamu' : 'halaman tamu'}</p>
        <WizardPreview stepId={s.id} draft={draft} catalog={catalog} focusFilter={focusFilter} />
      </aside>
    </div>
  )
}

function Row({ label, value, onEdit }) {
  return (
    <div class="sum-row">
      <span class="sum-label">{label}</span>
      <span class="sum-value">{value}</span>
      <button type="button" class="btn btn-sm btn-ghost" onClick={onEdit}>Ubah</button>
    </div>
  )
}

function Summary({ draft, catalog, host, go }) {
  const yes = (b) => (b ? 'bisa' : 'tidak bisa')
  const theme = catalog.themes.find((t) => t.id === draft.theme)?.name
  const ratio = catalog.aspect_ratios.find((r) => r.id === draft.aspect_ratio)
  return (
    <div class="summary card">
      <Row label="Nama acara" value={<strong>{draft.name}</strong>} onEdit={() => go(0)} />
      {draft.couple_names?.trim() && <Row label="Nama mempelai" value={draft.couple_names} onEdit={() => go(0)} />}
      <Row label="Link tamu" value={<span class="mono">{host}/{draft.slug}</span>} onEdit={() => go(0)} />
      <Row label="Tampilan" value={<span class="sum-theme">{theme}{draft.accent_color && <i style={{ background: draft.accent_color }} />} · {draft.language === 'en' ? 'English' : 'Bahasa Indonesia'}</span>} onEdit={() => go(1)} />
      <Row label="Foto sampul" value={draft.coverPreview ? <img class="sum-thumb" src={draft.coverPreview} alt="" /> : <span class="muted">Belum ada</span>} onEdit={() => go(2)} />
      <Row label="Ukuran foto" value={`${ratio.id} · ${ratio.name.id}`} onEdit={() => go(3)} />
      <Row label="Filter" value={`${draft.filters.length} filter kamera aktif`} onEdit={() => go(4)} />
      <Row label="Bingkai" value={draft.frame_style === 'polaroid' ? `Polaroid · ${fontName(catalog, draft.frame_font)}${draft.frame_caption ? ` · “${draft.frame_caption}”` : ''}` : 'Tanpa bingkai'} onEdit={() => go(5)} />
      <Row label="Watermark" value={draft.wm_enabled ? (draft.wm_mode === 'image' ? 'Logo PNG' : [draft.wm_text?.trim(), draft.wm_show_date ? 'tanggal acara' : ''].filter(Boolean).join(' + ')) + (draft.allow_clean_download ? ' · tamu boleh unduh asli' : ' · unduhan tamu selalu ber-watermark') : 'Tanpa watermark'} onEdit={() => go(6)} />
      <Row label="Kuota" value={`${draft.participant_limit === null ? 'Tamu tanpa batas' : `Hingga ${draft.participant_limit} tamu`} · maks ${draft.max_photos_per_guest} foto per tamu`} onEdit={() => go(7)} />
      <Row
        label="Galeri"
        value={<>Tamu {yes(draft.guest_can_see_others)} melihat foto tamu lain · {yes(draft.allow_gallery_upload)} upload dari galeri · like {draft.enable_likes ? 'aktif' : 'mati'}</>}
        onEdit={() => go(7)}
      />
      <Row label="Jadwal" value={draft.starts_at || draft.ends_at ? `${draft.starts_at ? formatDateTime(draft.starts_at) : '…'} – ${draft.ends_at ? formatDateTime(draft.ends_at) : '…'}` : <span class="muted">Jadwal belum diatur, kamera langsung dibuka</span>} onEdit={() => go(8)} />
      <p class="notice"><Icon name="calendar" size={16} /> Foto tersimpan {catalog.retention_months} bulan sejak foto pertama dari tamu, lalu otomatis terhapus.</p>
    </div>
  )
}

function Success({ ev }) {
  const copy = async () => toast((await copyText(ev.public_url)) ? 'Tautan disalin' : 'Gagal menyalin tautan. Silakan salin manual.')
  return (
    <div class="success">
      <div class="success-card card">
        <span class="success-burst"><Icon name="check" size={26} stroke={2.4} /></span>
        <h1 class="serif">Candid Cam berhasil dibuat!</h1>
        <p class="muted">Bagikan QR atau tautan ini ke tamu supaya mereka bisa mulai memotret.</p>
        <div class="qr-frame">
          <img src={`/api/g/${ev.slug}/qr.svg`} alt={`QR untuk ${ev.public_url}`} />
        </div>
        <div class="link-box">
          <span class="mono">{ev.public_url.replace(/^https?:\/\//, '')}</span>
          <button class="btn btn-sm" onClick={copy}><Icon name="copy" size={15} /> Salin</button>
        </div>
        <div class="success-actions">
          <a class="btn" href={`/api/g/${ev.slug}/qr.png`} download><Icon name="download" size={16} /> Download QR</a>
          <button class="btn btn-primary" onClick={() => navigate(`/app/e/${ev.id}`)}>Buka Acara <Icon name="next" size={16} /></button>
        </div>
        <Link class="muted small-link" href="/app">Kembali ke Daftar Acara</Link>
      </div>
    </div>
  )
}
