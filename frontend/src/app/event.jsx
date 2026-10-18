import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { api } from '../lib/api.js'
import { formatDate, formatDateTime, timeAgo } from '../lib/format.js'
import { Icon } from '../ui/icons.jsx'
import { Lightbox } from '../ui/Lightbox.jsx'
import { confirmDialog, copyText, Spinner, toast, toastError } from '../ui/ui.jsx'
import { StatusChip } from './events.jsx'
import { Link, navigate } from './router.jsx'
import { draftBody, StepCover, StepFilters, StepFrame, StepName, StepRatio, StepSchedule, StepSettings, STEPS, stepProblem } from './steps.jsx'
import { uploadCover } from './wizard.jsx'
import { WizardPreview } from './preview.jsx'

const TABS = [
  ['overview', 'Ringkasan'],
  ['photos', 'Foto'],
  ['guests', 'Tamu'],
  ['settings', 'Pengaturan'],
]

export function EventPage({ id, tab = 'overview', catalog }) {
  const [ev, setEv] = useState(null)
  const [error, setError] = useState(null)
  const reload = useCallback(() => api(`/api/events/${id}`).then(setEv, setError), [id])
  useEffect(() => {
    reload()
  }, [id])
  if (error) return <div class="center-fill"><div><p>{error.message}</p><Link class="btn" href="/app">Kembali</Link></div></div>
  if (!ev) return <div class="center-fill"><Spinner /></div>

  const copy = async () => toast((await copyText(ev.public_url)) ? 'Tautan disalin' : 'Gagal menyalin tautan')
  return (
    <div class="page">
      <Link class="back-link" href="/app"><Icon name="back" size={16} /> Acara Saya</Link>
      <header class="ev-head">
        <span class={`ev-cover theme-${ev.theme}`}>{ev.cover_url ? <img src={ev.cover_url} alt="" /> : <Icon name="camera" size={26} stroke={1.3} />}</span>
        <div class="ev-title">
          <div class="row-gap"><StatusChip status={ev.status} /><span class="muted small">Dibuat {formatDate(ev.created_at)}</span></div>
          <h1 class="serif">{ev.name}</h1>
          <button class="ev-link mono" onClick={copy} title="Salin tautan">{ev.public_url.replace(/^https?:\/\//, '')} <Icon name="copy" size={14} /></button>
        </div>
        <div class="ev-actions">
          <a class="btn" href={ev.public_url} target="_blank" rel="noopener"><Icon name="external" size={16} /> Halaman Tamu</a>
          <a class="btn btn-primary" href={`/display/${ev.id}`} target="_blank" rel="noopener"><Icon name="monitor" size={16} /> Live Display</a>
        </div>
      </header>
      <nav class="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <Link key={key} role="tab" aria-selected={tab === key} class={`tab ${tab === key ? 'on' : ''}`} href={`/app/e/${ev.id}${key === 'overview' ? '' : `/${key}`}`}>
            {label}
            {key === 'photos' && <span class="tab-n">{ev.photos_count}</span>}
            {key === 'guests' && <span class="tab-n">{ev.guests_count}</span>}
          </Link>
        ))}
      </nav>
      {tab === 'overview' && <Overview ev={ev} setEv={setEv} />}
      {tab === 'photos' && <Photos ev={ev} reload={reload} />}
      {tab === 'guests' && <Guests ev={ev} />}
      {tab === 'settings' && <Settings ev={ev} setEv={setEv} catalog={catalog} />}
    </div>
  )
}

// ---------------------------------------------------------------- overview
function Overview({ ev, setEv }) {
  const [showCode, setShowCode] = useState(false)
  const pct = ev.participant_limit ? Math.min(100, (ev.guests_count / ev.participant_limit) * 100) : 0
  const wa = `https://wa.me/?text=${encodeURIComponent(`Yuk ikut foto-foto di ${ev.name}! Buka kamera di sini: ${ev.public_url}`)}`
  const regen = async () => {
    if (!(await confirmDialog({ title: 'Buat passcode baru?', body: 'Layar display yang sedang terbuka harus memasukkan passcode baru.', confirm: 'Buat baru' }))) return
    try {
      setEv(await api(`/api/events/${ev.id}/display-passcode`, { method: 'POST' }))
      setShowCode(true)
      toast('Passcode baru dibuat')
    } catch (e) {
      toastError(e)
    }
  }
  return (
    <div class="overview">
      <section class="card share-card">
        <div class="qr-frame small"><img src={`/api/g/${ev.slug}/qr.svg`} alt="QR tamu" /></div>
        <div class="share-body">
          <p class="kicker">Bagikan ke tamu</p>
          <h2 class="serif">Pindai, lalu jepret.</h2>
          <p class="muted">Cetak QR ini untuk meja tamu atau kirim tautannya lewat WhatsApp. Tamu tidak perlu install aplikasi.</p>
          <div class="row-gap wrap">
            <button class="btn btn-sm" onClick={async () => toast((await copyText(ev.public_url)) ? 'Tautan disalin' : 'Gagal menyalin')}><Icon name="copy" size={15} /> Salin Tautan</button>
            <a class="btn btn-sm" href={`/api/g/${ev.slug}/qr.png`} download><Icon name="download" size={15} /> Download QR</a>
            <a class="btn btn-sm" href={wa} target="_blank" rel="noopener"><Icon name="share" size={15} /> WhatsApp</a>
          </div>
        </div>
      </section>
      <section class="stats">
        <div class="card stat">
          <span class="kicker">Peserta</span>
          <strong class="serif">{ev.guests_count}<small>/{ev.participant_limit ?? '∞'}</small></strong>
          {ev.participant_limit !== null && <span class="bar"><span style={{ width: `${pct}%` }} /></span>}
        </div>
        <div class="card stat">
          <span class="kicker">Foto</span>
          <strong class="serif">{ev.photos_count}</strong>
          <span class="muted small">maks {ev.max_photos_per_guest} per tamu</span>
        </div>
        <div class="card stat">
          <span class="kicker">Like</span>
          <strong class="serif">{ev.enable_likes ? ev.likes_count : '—'}</strong>
          <span class="muted small">{ev.enable_likes ? 'dari tamu' : 'fitur like mati'}</span>
        </div>
      </section>
      <section class="card display-card">
        <div class="dc-art" aria-hidden="true"><Icon name="monitor" size={30} stroke={1.4} /></div>
        <div class="share-body">
          <p class="kicker">Live Display</p>
          <h2 class="serif">Tampilkan foto tamu di layar acara.</h2>
          <p class="muted">Buka tautan display di laptop yang tersambung ke proyektor/TV. Foto baru muncul otomatis. Perangkat lain perlu passcode ini.</p>
          <div class="passcode">
            <span class="mono pc-code">{showCode ? ev.display_passcode : '••••••'}</span>
            <button class="btn btn-sm btn-ghost" onClick={() => setShowCode(!showCode)}><Icon name="eye" size={15} /> {showCode ? 'Sembunyikan' : 'Lihat'}</button>
            <button class="btn btn-sm btn-ghost" onClick={async () => toast((await copyText(ev.display_passcode)) ? 'Passcode disalin' : 'Gagal menyalin')}><Icon name="copy" size={15} /> Salin</button>
            <button class="btn btn-sm btn-ghost" onClick={regen}><Icon name="refresh" size={15} /> Baru</button>
          </div>
          <div class="row-gap wrap">
            <a class="btn btn-sm btn-primary" href={`/display/${ev.id}`} target="_blank" rel="noopener"><Icon name="external" size={15} /> Buka Live Display</a>
            <button class="btn btn-sm" onClick={async () => toast((await copyText(ev.display_url)) ? 'Tautan display disalin' : 'Gagal menyalin')}><Icon name="copy" size={15} /> Salin tautan display</button>
          </div>
        </div>
      </section>
      <section class="card info-card">
        <dl>
          <div><dt>Jadwal</dt><dd>{ev.starts_at || ev.ends_at ? `${ev.starts_at ? formatDateTime(ev.starts_at) : '…'} – ${ev.ends_at ? formatDateTime(ev.ends_at) : '…'}` : 'Belum diatur (kamera selalu terbuka)'}</dd></div>
          <div><dt>Penyimpanan foto</dt><dd>{ev.photos_deleted_at ? `Diarsipkan ${formatDate(ev.photos_deleted_at)}` : ev.photos_expire_at ? `Sampai ${formatDate(ev.photos_expire_at)}` : '12 bulan sejak foto pertama'}</dd></div>
          <div><dt>Tampilan tamu</dt><dd>{ev.theme === 'scrapbook' ? 'Scrapbook' : 'Dark Elegant'} · {ev.language === 'en' ? 'English' : 'Bahasa Indonesia'} · {ev.aspect_ratio}</dd></div>
        </dl>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- photos
function Photos({ ev, reload }) {
  const [photos, setPhotos] = useState(null)
  const [guests, setGuests] = useState([])
  const params = new URLSearchParams(location.search)
  const [guest, setGuest] = useState(params.get('guest') || '')
  const [sort, setSort] = useState('newest')
  const [open, setOpen] = useState(-1)
  const load = () => {
    const q = new URLSearchParams({ sort, ...(guest ? { guest } : {}) })
    api(`/api/events/${ev.id}/photos?${q}`).then((r) => setPhotos(r.photos), toastError)
  }
  useEffect(load, [sort, guest])
  useEffect(() => {
    api(`/api/events/${ev.id}/guests`).then((r) => setGuests(r.guests), () => {})
  }, [])

  const remove = async (p) => {
    if (!(await confirmDialog({ title: 'Hapus foto ini?', body: `Foto dari ${p.guest_name} akan dihapus permanen dari album dan display.`, confirm: 'Hapus', danger: true }))) return
    try {
      await api(`/api/events/${ev.id}/photos/${p.id}`, { method: 'DELETE' })
      const next = photos.filter((x) => x.id !== p.id)
      setPhotos(next)
      if (open >= next.length) setOpen(next.length - 1)
      reload()
      toast('Foto dihapus')
    } catch (e) {
      toastError(e)
    }
  }

  if (!photos) return <div class="center-fill"><Spinner /></div>
  return (
    <div>
      <div class="toolbar">
        <select class="input select" value={guest} onChange={(e) => setGuest(e.currentTarget.value)} aria-label="Filter tamu">
          <option value="">Semua tamu</option>
          {guests.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.photos_count})</option>)}
        </select>
        <select class="input select" value={sort} onChange={(e) => setSort(e.currentTarget.value)} aria-label="Urutkan">
          <option value="newest">Terbaru</option>
          <option value="oldest">Terlama</option>
          {ev.enable_likes && <option value="most_liked">Like terbanyak</option>}
        </select>
        <span class="grow" />
        {ev.photos_count > 0 && <a class="btn btn-sm btn-primary" href={`/api/events/${ev.id}/photos.zip`}><Icon name="download" size={15} /> Download semua (ZIP)</a>}
      </div>
      {photos.length === 0 ? (
        <div class="empty-small card">
          <Icon name="image" size={28} stroke={1.4} />
          <p>Belum ada foto{guest ? ' dari tamu ini' : ''}. Foto dari tamu akan muncul di sini secara otomatis.</p>
        </div>
      ) : (
        <div class="photo-grid">
          {photos.map((p, i) => (
            <button key={p.id} class="photo-tile" onClick={() => setOpen(i)} style={{ aspectRatio: `${p.width} / ${p.height}` }}>
              <img src={p.thumb_url} alt={`Foto dari ${p.guest_name}`} loading="lazy" />
              <span class="pt-meta"><span>{p.guest_name}</span>{ev.enable_likes && p.likes_count > 0 && <span><Icon name="heart" size={13} fill="currentColor" /> {p.likes_count}</span>}</span>
            </button>
          ))}
        </div>
      )}
      {open >= 0 && (
        <Lightbox
          photos={photos}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(-1)}
          footer={(p) => (
            <>
              <div class="lb-info">
                <strong>{p.guest_name}</strong>
                <span>{timeAgo(p.created_at)} · {p.source === 'gallery' ? 'dari galeri' : 'kamera'}{ev.enable_likes ? ` · ${p.likes_count} like` : ''}</span>
              </div>
              <a class="lb-action" href={`/api/g/${ev.slug}/photos/${p.id}/download`}><Icon name="download" size={18} /> Unduh</a>
              <button class="lb-action danger" onClick={() => remove(p)}><Icon name="trash" size={18} /> Hapus</button>
            </>
          )}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- guests
function Guests({ ev }) {
  const [guests, setGuests] = useState(null)
  useEffect(() => {
    api(`/api/events/${ev.id}/guests`).then((r) => setGuests(r.guests), toastError)
  }, [])
  if (!guests) return <div class="center-fill"><Spinner /></div>
  if (!guests.length) return <div class="empty-small card"><Icon name="users" size={28} stroke={1.4} /><p>Belum ada tamu yang bergabung. Bagikan QR atau tautan acara.</p></div>
  return (
    <div class="card table-card">
      <table class="table">
        <thead><tr><th>Nama</th><th>Bergabung</th><th class="num">Foto</th><th /></tr></thead>
        <tbody>
          {guests.map((g, i) => (
            <tr key={g.id}>
              <td><span class="avatar" style={{ '--h': (i * 47) % 360 }}>{g.name.slice(0, 1).toUpperCase()}</span> {g.name}</td>
              <td class="muted">{formatDateTime(g.created_at)}</td>
              <td class="num mono">{g.photos_count}<span class="muted">/{ev.max_photos_per_guest}</span></td>
              <td class="num">{g.photos_count > 0 && <Link class="btn btn-sm btn-ghost" href={`/app/e/${ev.id}/photos?guest=${g.id}`}>Lihat foto</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------- settings
const SECTIONS = [
  ['name', StepName],
  ['cover', StepCover],
  ['ratio', StepRatio],
  ['filters', StepFilters],
  ['frame', StepFrame],
  ['settings', StepSettings],
  ['schedule', StepSchedule],
]

function toDraft(ev) {
  return {
    ...ev,
    frame_caption: ev.frame_caption || '',
    frame_date: ev.frame_date || '',
    frame_hashtag: ev.frame_hashtag || '',
    slugTouched: true,
    coverPreview: ev.cover_url,
    coverFile: null,
    coverRemoved: false,
  }
}

const EDITABLE = ['name', 'slug', 'language', 'theme', 'aspect_ratio', 'filters', 'frame_style', 'frame_paper', 'frame_caption', 'frame_date', 'frame_hashtag', 'frame_font', 'frame_text_color', 'frame_date_format', 'participant_limit', 'max_photos_per_guest', 'allow_gallery_upload', 'guest_can_see_others', 'enable_likes', 'starts_at', 'ends_at']

function Settings({ ev, setEv, catalog }) {
  const [draft, setDraft] = useState(() => toDraft(ev))
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState('amber_vintage')
  const [active, setActive] = useState('name')
  const set = useCallback((patch) => setDraft((d) => ({ ...d, ...patch })), [])
  const base = useMemo(() => toDraft(ev), [ev])
  const dirty = EDITABLE.some((k) => JSON.stringify(draft[k] ?? null) !== JSON.stringify(base[k] ?? null)) || draft.coverFile || draft.coverRemoved

  const save = async () => {
    for (const [id] of SECTIONS) {
      const p = stepProblem(id, draft)
      if (p) return toast(p, 'error')
    }
    setBusy(true)
    try {
      const body = draftBody(draft)
      const patch = Object.fromEntries(EDITABLE.map((k) => [k, body[k] ?? null]))
      let next = await api(`/api/events/${ev.id}`, { method: 'PATCH', body: patch })
      if (draft.coverFile) next = await uploadCover(ev.id, draft.coverFile)
      else if (draft.coverRemoved && ev.cover_url) next = await api(`/api/events/${ev.id}/cover`, { method: 'DELETE' })
      setEv(next)
      setDraft(toDraft(next))
      toast('Perubahan disimpan')
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (!(await confirmDialog({ title: 'Hapus acara ini?', body: `“${ev.name}” beserta ${ev.photos_count} foto dan ${ev.guests_count} tamu akan dihapus permanen. Tautan tamu berhenti bekerja.`, confirm: 'Hapus permanen', danger: true }))) return
    try {
      await api(`/api/events/${ev.id}`, { method: 'DELETE' })
      toast('Acara dihapus')
      navigate('/app', { replace: true })
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <div class="settings">
      <div class="settings-main">
        {SECTIONS.map(([id, Body]) => {
          const s = STEPS.find((x) => x.id === id)
          return (
            <section key={id} class="card set-section" onFocusIn={() => setActive(id)} onPointerDown={() => setActive(id)}>
              <header>
                <p class="wz-label"><Icon name={s.icon} size={16} /> {s.label}</p>
                <h2 class="serif">{s.title}</h2>
              </header>
              <Body draft={draft} set={set} catalog={catalog} host={location.host} eventId={ev.id} onFocus={setFocus} minParticipants={ev.guests_count} />
            </section>
          )
        })}
        <section class="card set-section danger-zone">
          <header>
            <p class="wz-label"><Icon name="trash" size={16} /> Zona Bahaya</p>
            <h2 class="serif">Hapus acara</h2>
          </header>
          <p class="muted">Semua foto, tamu, dan tautan acara ini akan dihapus permanen. Unduh fotonya dulu kalau masih dibutuhkan.</p>
          <button class="btn btn-danger" onClick={del}><Icon name="trash" size={16} /> Hapus acara ini</button>
        </section>
      </div>
      <aside class="settings-preview">
        <WizardPreview stepId={active} draft={draft} catalog={catalog} focusFilter={focus} />
      </aside>
      <div class={`savebar ${dirty ? 'show' : ''}`}>
        <span>Ada perubahan yang belum disimpan</span>
        <button class="btn btn-ghost btn-sm" onClick={() => setDraft(toDraft(ev))} disabled={busy}>Batalkan</button>
        <button class="btn btn-accent btn-sm" onClick={save} disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan perubahan'}</button>
      </div>
    </div>
  )
}
