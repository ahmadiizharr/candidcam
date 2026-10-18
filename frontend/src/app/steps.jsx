// The event settings, one component per wizard step. The event page's Settings tab renders
// the same components, so creating and editing an event can never drift apart.
import { useEffect, useRef, useState } from 'preact/hooks'
import { api } from '../lib/api.js'
import { renderThumbs } from '../lib/filters.js'
import { fontFor, loadFrameFonts, paperFor } from '../lib/frame.js'
import { fromLocalInput, toLocalInput } from '../lib/format.js'
import { Icon } from '../ui/icons.jsx'
import { Seg, SwitchRow, toast } from '../ui/ui.jsx'
import { ratioOf, useSample } from './preview.jsx'

export const STEPS = [
  { id: 'name', label: 'Nama Acara', icon: 'sparkle', title: 'Acara apa yang mau kamu abadikan?', sub: 'Nama ini akan tampil di halaman utama tamu.' },
  { id: 'cover', label: 'Foto Sampul', icon: 'image', title: 'Pilih foto sampul acara', sub: 'Foto ini jadi kesan pertama buat tamu kamu. Opsional, bisa diubah kapan saja.' },
  { id: 'ratio', label: 'Ukuran Foto', icon: 'ratio', title: 'Mau ukuran hasil foto yang mana?', sub: 'Foto tamu akan otomatis dipotong mengikuti rasio ini saat difoto.' },
  { id: 'filters', label: 'Filter Kamera', icon: 'film', title: 'Filter apa yang bisa dipakai tamu?', sub: 'Tamu bisa menjepret dengan gaya ini saat mengambil foto. Klik untuk aktif/nonaktifkan.' },
  { id: 'frame', label: 'Bingkai Foto', icon: 'frame', title: 'Mau pakai bingkai foto?', sub: 'Bingkai ini akan menempel permanen di setiap foto yang diambil tamu.' },
  { id: 'settings', label: 'Pengaturan Foto', icon: 'users', title: 'Atur kuota & foto acaramu', sub: 'Pilih perkiraan jumlah peserta dan berapa foto yang didapat tiap tamu.' },
  { id: 'schedule', label: 'Jadwal', icon: 'calendar', title: 'Kapan acara berlangsung?', sub: 'Opsional. Kamu bisa lewati dan atur ini nanti.' },
  { id: 'confirm', label: 'Konfirmasi', icon: 'check', title: 'Semua siap?', sub: 'Cek sekali lagi sebelum acara dibuat.' },
]

export function slugify(name) {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}

const SLUG_MSG = {
  invalid: 'Gunakan 3–40 huruf kecil, angka, atau tanda hubung.',
  reserved: 'Link ini dipakai sistem, pilih yang lain.',
  taken: 'Sudah dipakai acara lain.',
}

export function newDraft(catalog) {
  return {
    name: '',
    couple_names: '',
    slug: '',
    slugTouched: false,
    language: 'id',
    theme: 'dark_elegant',
    aspect_ratio: '3:4',
    filters: catalog.filters.map((f) => f.id),
    frame_style: 'none',
    frame_paper: 'white',
    frame_caption: '',
    frame_date: '',
    frame_hashtag: '',
    frame_font: 'playfair',
    frame_text_color: '#1d1d1d',
    frame_date_format: 'dd/mm/yyyy',
    participant_limit: catalog.free_participants,
    max_photos_per_guest: 10,
    allow_gallery_upload: false,
    guest_can_see_others: true,
    enable_likes: true,
    starts_at: null,
    ends_at: null,
    coverFile: null,
    coverPreview: null,
  }
}

/** The API body for a draft (drops UI-only fields). */
export function draftBody(d) {
  const { slugTouched, coverFile, coverPreview, coverRemoved, slugState, ...rest } = d
  for (const k of ['couple_names', 'frame_caption', 'frame_date', 'frame_hashtag']) rest[k] = rest[k]?.trim() || null
  return rest
}

// ---------------------------------------------------------------- 1. name
export function StepName({ draft, set, eventId, host }) {
  const [state, setState] = useState(null)
  const timer = useRef(0)

  useEffect(() => {
    const slug = draft.slug
    if (!slug) {
      setState(null)
      set({ slugState: 'invalid' })
      return
    }
    setState({ checking: true })
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ slug, ...(eventId ? { exclude: eventId } : {}) })
        const res = await api(`/api/events/check-slug?${q}`)
        if (!res.available && res.reason === 'taken' && !draft.slugTouched) {
          const s = await api(`/api/events/suggest-slug?name=${encodeURIComponent(draft.name)}`)
          set({ slug: s.slug })
          return
        }
        setState(res)
        set({ slugState: res.available ? 'ok' : res.reason })
      } catch {
        setState(null)
      }
    }, 350)
    return () => clearTimeout(timer.current)
  }, [draft.slug])

  const onName = (e) => {
    const name = e.currentTarget.value.slice(0, 40)
    set(draft.slugTouched ? { name } : { name, slug: slugify(name) })
  }
  const onSlug = (e) => {
    const slug = e.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40)
    set({ slug, slugTouched: true })
  }

  return (
    <div class="step-fields">
      <div class="field">
        <label for="ev-name">Nama Acara</label>
        <div class="input-wrap">
          <input id="ev-name" class="input" placeholder="cth. Pernikahan Emma & Noah" value={draft.name} onInput={onName} maxLength={40} autoFocus={!eventId} style="padding-right:64px" />
          <span class="count">{draft.name.length}/40</span>
        </div>
      </div>
      <div class="field">
        <label for="ev-couple">Nama Mempelai <span class="muted">(opsional)</span></label>
        <input id="ev-couple" class="input" placeholder="cth. Nadia & Rafi" value={draft.couple_names} maxLength={60} onInput={(e) => set({ couple_names: e.currentTarget.value })} />
        <p class="hint">Ditampilkan besar di Live Display, dengan tanggal acara di bawahnya. Kosongkan untuk memakai nama acara.</p>
      </div>
      <div class="field">
        <label for="ev-slug">Link Tamu</label>
        <div class="input-prefix">
          <span>{host}/</span>
          <input id="ev-slug" value={draft.slug} onInput={onSlug} placeholder="budi-sinta" spellcheck={false} autoCapitalize="off" />
        </div>
        <p class={`hint slug-state ${state && !state.checking ? (state.available ? 'ok' : 'bad') : ''}`}>
          {state?.checking ? 'Mengecek…' : state?.available ? <><Icon name="check" size={14} /> Tersedia</> : state?.reason ? SLUG_MSG[state.reason] : 'Buat link yang lebih singkat dan mudah diingat, misalnya budi-sinta.'}
        </p>
      </div>
      <div class="field">
        <span class="label">Bahasa Halaman Tamu</span>
        <Seg value={draft.language} onChange={(language) => set({ language })} options={[{ value: 'id', label: 'Bahasa Indonesia' }, { value: 'en', label: 'English' }]} />
        <p class="hint">Bahasa halaman tamu ini tetap, tamu tidak bisa menggantinya sendiri.</p>
      </div>
      <div class="field">
        <span class="label">Tema Halaman Home</span>
        <div class="theme-cards">
          <button type="button" class={`theme-card tc-dark ${draft.theme === 'dark_elegant' ? 'on' : ''}`} onClick={() => set({ theme: 'dark_elegant' })} aria-pressed={draft.theme === 'dark_elegant'}>
            <span class="tc-art">
              <span class="tc-strip l" /><span class="tc-strip r" />
              <span class="tc-name">Nadia &amp; Rafi</span>
              <span class="tc-btn">Open Camera</span>
            </span>
            <span class="tc-label">Dark Elegant</span>
          </button>
          <button type="button" class={`theme-card tc-scrap ${draft.theme === 'scrapbook' ? 'on' : ''}`} onClick={() => set({ theme: 'scrapbook' })} aria-pressed={draft.theme === 'scrapbook'}>
            <span class="tc-art">
              <span class="tc-polaroid" />
              <span class="tc-name">Nadia &amp; Rafi</span>
              <span class="tc-btn">Open Camera</span>
            </span>
            <span class="tc-label">Scrapbook</span>
          </button>
        </div>
        <p class="hint">Hanya mengubah tampilan halaman home tamu, layar kamera tetap sama.</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 2. cover
const MAX_COVER = 15 * 1024 * 1024

export function StepCover({ draft, set }) {
  const input = useRef(null)
  const [over, setOver] = useState(false)

  const take = (file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return toast('File harus berupa gambar (JPG, PNG, atau WebP)', 'error')
    if (file.size > MAX_COVER) return toast('Ukuran foto maksimal 15 MB', 'error')
    if (draft.coverPreview?.startsWith('blob:')) URL.revokeObjectURL(draft.coverPreview)
    set({ coverFile: file, coverPreview: URL.createObjectURL(file), coverRemoved: false })
  }

  useEffect(() => {
    const onPaste = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))
      if (item) take(item.getAsFile())
    }
    addEventListener('paste', onPaste)
    return () => removeEventListener('paste', onPaste)
  })

  const remove = () => set({ coverFile: null, coverPreview: null, coverRemoved: true })

  return (
    <div class="step-fields">
      <div
        class={`dropzone ${over ? 'over' : ''} ${draft.coverPreview ? 'has' : ''}`}
        onClick={() => input.current.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]) }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current.click()}
      >
        {draft.coverPreview ? (
          <img src={draft.coverPreview} alt="Foto sampul" />
        ) : (
          <div class="dz-empty">
            <span class="dz-icon"><Icon name="upload" size={22} /></span>
            <strong>Unggah Foto Sampul</strong>
            <span class="muted">Klik, drag &amp; drop, atau paste</span>
            <span class="dz-meta">JPG, PNG, WebP · maks. 15 MB</span>
          </div>
        )}
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { take(e.currentTarget.files[0]); e.currentTarget.value = '' }} />
      </div>
      {draft.coverPreview && (
        <div class="row-gap">
          <button type="button" class="btn btn-sm" onClick={() => input.current.click()}><Icon name="refresh" size={16} /> Ganti Foto</button>
          <button type="button" class="btn btn-sm btn-ghost btn-danger" onClick={remove}><Icon name="trash" size={16} /> Hapus</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 3. ratio
export function StepRatio({ draft, set, catalog }) {
  return (
    <div class="choice-cards">
      {catalog.aspect_ratios.map((r) => (
        <button type="button" key={r.id} class={`choice-card ${draft.aspect_ratio === r.id ? 'on' : ''}`} aria-pressed={draft.aspect_ratio === r.id} onClick={() => set({ aspect_ratio: r.id })}>
          <span class="ratio-shape" style={{ aspectRatio: `${r.w} / ${r.h}` }}>
            <img src="/static/sample.jpg" alt="" />
          </span>
          <span class="cc-title mono">{r.id}</span>
          <span class="cc-sub">{r.name.id}</span>
          <span class="cc-check"><Icon name="check" size={14} stroke={2.4} /></span>
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- 4. filters
export function StepFilters({ draft, set, catalog, onFocus }) {
  const img = useSample()
  const [thumbs, setThumbs] = useState({})
  const ratio = ratioOf(catalog, draft.aspect_ratio)
  useEffect(() => {
    if (!img) return
    try {
      setThumbs(renderThumbs(img, catalog.filters.map((f) => f.id), { ratio, size: 260 }))
    } catch {
      setThumbs({})
    }
  }, [img, ratio])

  const toggle = (id) => {
    onFocus?.(id)
    const on = draft.filters.includes(id)
    if (on && draft.filters.length === 1) {
      toast('Pilih minimal 1 filter supaya tamu punya sesuatu untuk dipakai memotret.', 'error')
      return
    }
    const next = on ? draft.filters.filter((f) => f !== id) : [...draft.filters, id]
    set({ filters: catalog.filters.map((f) => f.id).filter((f) => next.includes(f)) })
  }

  return (
    <div class="step-fields">
      <div class="filter-head">
        <span class="mono filter-count">{draft.filters.length} filter aktif</span>
        <div class="row-gap">
          <button type="button" class="btn btn-sm btn-ghost" onClick={() => set({ filters: catalog.filters.map((f) => f.id) })}>Pilih semua</button>
          <button type="button" class="btn btn-sm btn-ghost" onClick={() => { set({ filters: ['none'] }); onFocus?.('none') }}>Original saja</button>
        </div>
      </div>
      <div class="filter-grid">
        {catalog.filters.map((f) => {
          const on = draft.filters.includes(f.id)
          return (
            <button type="button" key={f.id} class={`filter-tile ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(f.id)} onMouseEnter={() => on && onFocus?.(f.id)}>
              <span class="ft-img" style={{ aspectRatio: `${ratio}` }}>
                {thumbs[f.id] ? <img src={thumbs[f.id]} alt="" /> : <span class="ft-ph" />}
                <span class="ft-check"><Icon name="check" size={13} stroke={2.6} /></span>
              </span>
              <span class="ft-name">{f.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 5. frame
export function StepFrame({ draft, set, catalog }) {
  useEffect(() => loadFrameFonts(), [])
  const isPolaroid = draft.frame_style === 'polaroid'
  const pickPaper = (p) => set({ frame_paper: p.id, frame_text_color: p.ink })
  return (
    <div class="step-fields">
      <div class="choice-cards">
        <button type="button" class={`choice-card ${!isPolaroid ? 'on' : ''}`} aria-pressed={!isPolaroid} onClick={() => set({ frame_style: 'none' })}>
          <span class="frame-art fa-none"><img src="/static/sample.jpg" alt="" /></span>
          <span class="cc-title">Tanpa Bingkai</span>
          <span class="cc-sub">Foto penuh, bersih</span>
          <span class="cc-check"><Icon name="check" size={14} stroke={2.4} /></span>
        </button>
        <button type="button" class={`choice-card ${isPolaroid ? 'on' : ''}`} aria-pressed={isPolaroid} onClick={() => set({ frame_style: 'polaroid' })}>
          <span class="frame-art fa-polaroid"><img src="/static/sample.jpg" alt="" /><i>Our Day</i></span>
          <span class="cc-title">Polaroid</span>
          <span class="cc-sub">Bingkai kertas + teks</span>
          <span class="cc-check"><Icon name="check" size={14} stroke={2.4} /></span>
        </button>
      </div>
      {isPolaroid && (
        <div class="frame-options">
          <div class="field">
            <span class="label">Template Bingkai</span>
            <div class="paper-row">
              {catalog.frame_papers.map((p) => (
                <button type="button" key={p.id} class={`paper ${draft.frame_paper === p.id ? 'on' : ''}`} onClick={() => pickPaper(p)} aria-pressed={draft.frame_paper === p.id} title={p.name.id}>
                  <span style={{ background: p.paper }} />
                  <small>{p.name.id}</small>
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <label for="fr-cap">Teks Bingkai <span class="muted">(opsional)</span></label>
            <input id="fr-cap" class="input" maxLength={40} placeholder="cth. Our Wedding Day" value={draft.frame_caption} onInput={(e) => set({ frame_caption: e.currentTarget.value })} />
          </div>
          <div class="two-col">
            <div class="field">
              <label for="fr-date">Tanggal <span class="muted">(opsional)</span></label>
              <input id="fr-date" class="input" type="date" value={draft.frame_date || ''} onInput={(e) => set({ frame_date: e.currentTarget.value })} />
            </div>
            <div class="field">
              <span class="label">Format Tanggal</span>
              <Seg value={draft.frame_date_format} onChange={(v) => set({ frame_date_format: v })} options={catalog.date_formats.map((d) => ({ value: d.id, label: d.name }))} />
            </div>
          </div>
          <div class="field">
            <label for="fr-tag">Hashtag <span class="muted">(opsional)</span></label>
            <input id="fr-tag" class="input" maxLength={40} placeholder="#pernikahanku" value={draft.frame_hashtag} onInput={(e) => set({ frame_hashtag: e.currentTarget.value })} />
          </div>
          <div class="field">
            <span class="label">Font Teks Bingkai</span>
            <div class="font-row">
              {catalog.frame_fonts.map((f) => (
                <button type="button" key={f.id} class={`font-chip ${draft.frame_font === f.id ? 'on' : ''}`} aria-pressed={draft.frame_font === f.id} onClick={() => set({ frame_font: f.id })}>
                  <span style={{ fontFamily: `"${f.family}"`, fontStyle: f.style, fontWeight: f.weight }}>Aa</span>
                  <small>{f.name.id}</small>
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <span class="label">Warna Teks Caption</span>
            <div class="color-row">
              {[...new Set([paperFor(catalog, draft.frame_paper).ink, '#1d1d1d', '#8a2f2a', '#2c4a6b', '#4b5b3a', '#b07a2a', '#ffffff'])].map((c) => (
                <button type="button" key={c} class={`swatch ${draft.frame_text_color.toLowerCase() === c.toLowerCase() ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ frame_text_color: c })} aria-label={c} />
              ))}
              <label class="swatch swatch-custom" title="Warna lain">
                <input type="color" value={draft.frame_text_color} onInput={(e) => set({ frame_text_color: e.currentTarget.value })} />
                <Icon name="plus" size={14} />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 6. settings
export function StepSettings({ draft, set, catalog, minParticipants = 0 }) {
  const tiers = catalog.participant_limits
  const idx = Math.max(0, tiers.indexOf(draft.participant_limit))
  const limit = draft.participant_limit
  const pick = (i) => {
    const v = tiers[i]
    if (v !== null && v < minParticipants) return toast(`Sudah ${minParticipants} tamu bergabung, kuota tidak bisa di bawah itu.`, 'error')
    set({ participant_limit: v })
  }
  return (
    <div class="step-fields">
      <div class="quota card-flat">
        <div class="quota-head">
          <div>
            <span class="kicker">Kuota Peserta</span>
            <p class="quota-value serif">{limit === null ? 'Tamu tanpa batas' : `Hingga ${limit} tamu`}</p>
          </div>
          <span class="chip chip-live-soft">Gratis</span>
        </div>
        <input type="range" class="range" min={0} max={tiers.length - 1} step={1} value={idx} onInput={(e) => pick(+e.currentTarget.value)} aria-label="Kuota peserta" style={{ '--p': `${(idx / (tiers.length - 1)) * 100}%` }} />
        <div class="range-ends mono"><span>{tiers[0]}</span><span>∞ Tamu</span></div>
        <p class="hint">Kamu bisa menambah kuota kapan saja, bahkan setelah acara dimulai.</p>
      </div>
      <div class="field">
        <span class="label">Foto per Tamu</span>
        <div class="pill-row">
          {catalog.photos_per_guest.map((n) => (
            <button type="button" key={n} class={`pill ${draft.max_photos_per_guest === n ? 'on' : ''}`} aria-pressed={draft.max_photos_per_guest === n} onClick={() => set({ max_photos_per_guest: n })}>
              {n} Foto
            </button>
          ))}
        </div>
      </div>
      <div class="switches">
        <SwitchRow title="Izinkan upload dari galeri" hint="Tamu juga bisa pilih foto dari galeri HP, bukan cuma jepret langsung dari kamera." checked={draft.allow_gallery_upload} onChange={(v) => set({ allow_gallery_upload: v })} />
        <SwitchRow title="Tamu bisa lihat foto tamu lain" hint="Galeri bersama “Semua Orang” terbuka untuk tamu." checked={draft.guest_can_see_others} onChange={(v) => set({ guest_can_see_others: v })} />
        <SwitchRow title="Nyalakan fitur like" hint="Tamu bisa memberi hati pada foto favorit." checked={draft.enable_likes} onChange={(v) => set({ enable_likes: v })} />
      </div>
      <p class="notice"><Icon name="calendar" size={16} /> Foto tamu akan tersimpan {catalog.retention_months} bulan sejak foto pertama dari tamu, lalu otomatis terhapus.</p>
    </div>
  )
}

// ---------------------------------------------------------------- 7. schedule
export function StepSchedule({ draft, set }) {
  const bad = draft.starts_at && draft.ends_at && draft.ends_at <= draft.starts_at
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <div class="step-fields">
      <div class="two-col">
        <div class="field">
          <label for="sc-start">Mulai</label>
          <input id="sc-start" class="input" type="datetime-local" value={toLocalInput(draft.starts_at)} onInput={(e) => set({ starts_at: fromLocalInput(e.currentTarget.value) })} />
        </div>
        <div class="field">
          <label for="sc-end">Selesai</label>
          <input id="sc-end" class="input" type="datetime-local" aria-invalid={bad ? 'true' : 'false'} value={toLocalInput(draft.ends_at)} onInput={(e) => set({ ends_at: fromLocalInput(e.currentTarget.value) })} />
        </div>
      </div>
      {bad ? <p class="form-error">Waktu selesai harus setelah waktu mulai.</p> : <p class="hint">Di luar jadwal ini kamera tamu ditutup, tapi album tetap bisa dilihat. Zona waktu: {tz}.</p>}
      {(draft.starts_at || draft.ends_at) && (
        <button type="button" class="btn btn-sm btn-ghost" style="justify-self:start" onClick={() => set({ starts_at: null, ends_at: null })}>Hapus jadwal</button>
      )}
    </div>
  )
}

export function stepProblem(id, draft) {
  if (id === 'name') {
    if (!draft.name.trim()) return 'Isi nama acara dulu.'
    if (draft.slugState && draft.slugState !== 'ok') return 'Link tamu belum bisa dipakai.'
  }
  if (id === 'filters' && !draft.filters.length) return 'Pilih minimal 1 filter.'
  if (id === 'schedule' && draft.starts_at && draft.ends_at && draft.ends_at <= draft.starts_at) return 'Waktu selesai harus setelah waktu mulai.'
  return null
}

export function fontName(catalog, id) {
  return fontFor(catalog, id).name.id
}
