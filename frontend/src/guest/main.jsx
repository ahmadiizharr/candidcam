import { render } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import '../ui/base.css'
import './guest.css'
import './page.css'
import { api, getCatalog } from '../lib/api.js'
import { snapshot, stillRenderer } from '../lib/filters.js'
import { canvasToBlob, composeFrame, ensureFont, loadFrameFonts } from '../lib/frame.js'
import { formatDateTime } from '../lib/format.js'
import { strings } from '../lib/i18n.js'
import { decodeFile, downscale } from '../lib/image.js'
import { Icon } from '../ui/icons.jsx'
import { Lightbox } from '../ui/Lightbox.jsx'
import { copyText, Spinner, toast, Toasts } from '../ui/ui.jsx'
import { Camera, uploadPhoto } from './Camera.jsx'
import { Cropper } from './Cropper.jsx'
import { Hero } from './Hero.jsx'

const slug = location.pathname.split('/')[1].toLowerCase()
const tokenKey = (id) => `candid:guest:${id}`
const readToken = (id) => {
  try {
    return localStorage.getItem(tokenKey(id))
  } catch {
    return null
  }
}
const writeToken = (id, v) => {
  try {
    v ? localStorage.setItem(tokenKey(id), v) : localStorage.removeItem(tokenKey(id))
  } catch {
    /* private mode: the session lasts as long as the tab */
  }
}

function useRoute() {
  const [cam, setCam] = useState(location.pathname.endsWith('/camera'))
  useEffect(() => {
    const on = () => setCam(location.pathname.endsWith('/camera'))
    addEventListener('popstate', on)
    return () => removeEventListener('popstate', on)
  }, [])
  const go = (toCam) => {
    const path = toCam ? `/${slug}/camera` : `/${slug}`
    if (location.pathname !== path) history.pushState(null, '', path)
    setCam(toCam)
  }
  return [cam, go]
}

async function share(event, t) {
  const data = { title: event.name, text: t.shareText(event.name), url: event.public_url }
  if (navigator.share) {
    try {
      await navigator.share(data)
      return
    } catch (e) {
      if (e?.name === 'AbortError') return
    }
  }
  toast((await copyText(event.public_url)) ? t.linkCopied : t.copyFailed)
}

async function sharePhoto(photo, event, t) {
  try {
    const blob = await (await fetch(photo.url)).blob()
    const file = new File([blob], `${event.slug}-${photo.id.slice(0, 6)}.jpg`, { type: 'image/jpeg' })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: event.name })
      return
    }
  } catch (e) {
    if (e?.name === 'AbortError') return
  }
  share(event, t)
}

function App() {
  const [catalog, setCatalog] = useState(null)
  const [event, setEvent] = useState(null)
  const [missing, setMissing] = useState(false)
  const [token, setToken] = useState(null)
  const [guest, setGuest] = useState(undefined)
  const [cam, goCam] = useRoute()

  const refreshEvent = useCallback(() => api(`/api/g/${slug}`).then((r) => setEvent(r.event)), [])

  useEffect(() => {
    getCatalog().then(setCatalog)
    api(`/api/g/${slug}`).then(
      async ({ event }) => {
        setEvent(event)
        const tk = readToken(event.id)
        if (!tk) return setGuest(null)
        try {
          const r = await api(`/api/g/${slug}/session`, { headers: { 'X-Guest-Token': tk } })
          setToken(tk)
          setGuest(r.guest)
        } catch (e) {
          if (e.status === 401) writeToken(event.id, null)
          setGuest(null)
        }
      },
      () => setMissing(true),
    )
  }, [])

  useEffect(() => {
    if (event) document.documentElement.lang = event.language
  }, [event?.language])

  if (missing) {
    const t = strings(navigator.language?.startsWith('en') ? 'en' : 'id')
    return (
      <div class="gtheme theme-dark_elegant g-page g-missing">
        <Icon name="camera" size={40} stroke={1.3} />
        <h1>{t.notFoundTitle}</h1>
        <p>{t.notFoundBody}</p>
      </div>
    )
  }
  if (!event || !catalog || guest === undefined) {
    return <div class="gtheme theme-dark_elegant g-page g-loading"><Spinner /></div>
  }

  const t = strings(event.language)
  const canShoot = event.status === 'open' && guest

  if (cam && canShoot) {
    return (
      <Camera
        event={event}
        catalog={catalog}
        guest={guest}
        token={token}
        t={t}
        onClose={() => goCam(false)}
        onShot={(_photo, g) => setGuest(g)}
      />
    )
  }
  if (cam && !canShoot) history.replaceState(null, '', `/${slug}`)

  return (
    <Home
      event={event}
      catalog={catalog}
      t={t}
      guest={guest}
      token={token}
      onJoined={(tk, g) => {
        writeToken(event.id, tk)
        setToken(tk)
        setGuest(g)
        refreshEvent()
      }}
      onLeave={() => {
        writeToken(event.id, null)
        setToken(null)
        setGuest(null)
      }}
      setGuest={setGuest}
      openCamera={() => goCam(true)}
    />
  )
}

function StatusNote({ event, t, guest }) {
  if (event.status === 'not_started')
    return <div class="g-note"><Icon name="calendar" size={18} /><div><strong>{t.eventNotStarted}</strong>{event.starts_at && <span>{t.startsOn(formatDateTime(event.starts_at, event.language))}</span>}</div></div>
  if (event.status === 'ended') return <div class="g-note"><Icon name="lock" size={18} /><div><strong>{t.eventEnded}</strong><span>{t.endedBody}</span></div></div>
  if (event.status === 'archived') return <div class="g-note"><Icon name="lock" size={18} /><div><strong>{t.archived}</strong></div></div>
  if (!guest && event.quota_full) return <div class="g-note"><Icon name="users" size={18} /><div><strong>{t.quotaFull}</strong><span>{t.quotaFullBody}</span></div></div>
  return null
}

function JoinForm({ event, t, onJoined }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const r = await api(`/api/g/${slug}/join`, { method: 'POST', body: { name: name.trim() } })
      onJoined(r.token, r.guest)
    } catch (err) {
      toast(err.status === 409 ? t.quotaFull : err.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form class="gh-actions" onSubmit={submit}>
      <input class="g-field" placeholder={t.enterYourName} value={name} maxLength={40} onInput={(e) => setName(e.currentTarget.value)} autoComplete="given-name" enterKeyHint="go" aria-label={t.enterYourName} />
      <button class="g-btn" disabled={busy || !name.trim()}>{busy ? t.joining : t.joinAlbum}</button>
    </form>
  )
}

function Home({ event, catalog, t, guest, token, onJoined, onLeave, setGuest, openCamera }) {
  const [tab, setTab] = useState('mine')
  const [photos, setPhotos] = useState(null)
  const [open, setOpen] = useState(-1)
  const [cropping, setCropping] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const ratio = (() => {
    const r = catalog.aspect_ratios.find((a) => a.id === event.aspect_ratio) || catalog.aspect_ratios[0]
    return r.w / r.h
  })()
  const headers = token ? { 'X-Guest-Token': token } : {}

  const load = useCallback(() => {
    if (!token) return
    api(`/api/g/${slug}/photos?scope=${tab === 'all' ? 'all' : 'mine'}`, { headers }).then((r) => setPhotos(r.photos), () => setPhotos([]))
  }, [token, tab])
  useEffect(() => {
    setPhotos(null)
    load()
  }, [load])
  useEffect(() => {
    if (!token || tab !== 'all') return
    const id = setInterval(() => !document.hidden && load(), 20000)
    return () => clearInterval(id)
  }, [load, tab, token])
  useEffect(() => {
    if (!token) return
    api(`/api/g/${slug}/session`, { headers }).then((r) => setGuest(r.guest), () => {})
  }, [token])

  const like = async (p) => {
    try {
      const r = await api(`/api/g/${slug}/photos/${p.id}/like`, { method: 'POST', headers })
      setPhotos((list) => list.map((x) => (x.id === p.id ? { ...x, liked: r.liked, likes_count: r.likes_count } : x)))
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const pickFile = async (file) => {
    if (!file) return
    try {
      const img = await decodeFile(file)
      setCropping(downscale(img, 2400))
    } catch {
      toast(t.photoUnreadable, 'error')
    }
  }

  const finishCrop = async (crop) => {
    setUploading(true)
    try {
      const src = cropping
      const cw = src.width * crop.w
      const ch = src.height * crop.h
      const s = Math.min(1, 2000 / Math.max(cw, ch))
      const r = stillRenderer()
      r.draw(src, { filter: 'none', crop, width: Math.round(cw * s), height: Math.round(ch * s) })
      let shot = snapshot(r)
      if (event.frame_style === 'polaroid') {
        loadFrameFonts()
        await ensureFont(catalog, event.frame_font)
        shot = composeFrame(shot, event, catalog)
      }
      const res = await uploadPhoto(slug, token, await canvasToBlob(shot, 0.9), { filter: 'none', source: 'gallery' })
      setGuest(res.guest)
      setCropping(null)
      toast(t.uploadSuccess)
      if (tab === 'mine') load()
      else setTab('mine')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setUploading(false)
    }
  }

  const isOpen = event.status === 'open'
  const rollLeft = guest?.photos_left ?? 0
  return (
    <div class={`gtheme theme-${event.theme} g-page`}>
      <div class="g-col">
        <Hero event={event} t={t} />
        <StatusNote event={event} t={t} guest={guest} />
        {!guest && !event.quota_full && event.status !== 'archived' && <JoinForm event={event} t={t} onJoined={onJoined} />}

        {guest && (
          <section class="gh-actions g-me">
            <p class="g-hello">
              <span>{t.hello(guest.name)}</span>
              <span class="g-roll mono">
                <Icon name="film" size={15} /> {t.photosLeft(rollLeft)}
              </span>
            </p>
            {isOpen && (
              <button class="g-btn g-btn-cam" onClick={openCamera}>
                <Icon name="camera" size={19} /> {rollLeft > 0 ? t.openCamera : t.rollFinished}
              </button>
            )}
            {isOpen && event.allow_gallery_upload && rollLeft > 0 && (
              <>
                <button class="g-btn g-btn-ghost" onClick={() => fileRef.current.click()}><Icon name="image" size={18} /> {t.uploadPhoto}</button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pickFile(e.currentTarget.files[0]); e.currentTarget.value = '' }} />
              </>
            )}
            <button class="g-link" onClick={() => share(event, t)}><Icon name="share" size={15} /> {t.share}</button>
          </section>
        )}

        {guest && (
          <section class="g-gallery">
            <div class="g-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'mine'} class={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>{t.yourRoll}</button>
              {event.guest_can_see_others && <button role="tab" aria-selected={tab === 'all'} class={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>{t.everyone}</button>}
            </div>
            {photos === null ? (
              <div class="g-empty"><Spinner /></div>
            ) : photos.length === 0 ? (
              <div class="g-empty">
                <Icon name="image" size={30} stroke={1.3} />
                <p>{tab === 'mine' ? t.noPhotosYet : t.noOtherPhotosYet}</p>
              </div>
            ) : (
              <div class="g-grid">
                {photos.map((p, i) => (
                  <figure key={p.id} class="g-tile">
                    <button class="g-tile-img" onClick={() => setOpen(i)} style={{ aspectRatio: `${p.width} / ${p.height}` }}>
                      <img src={p.thumb_url} alt="" loading="lazy" />
                    </button>
                    <figcaption>
                      <span class="g-tile-name">{tab === 'all' ? p.guest_name : ''}</span>
                      {event.enable_likes && (
                        <button class={`g-like ${p.liked ? 'on' : ''}`} onClick={() => like(p)} aria-pressed={p.liked} aria-label={t.likes(p.likes_count)}>
                          <Icon name="heart" size={16} fill={p.liked ? 'currentColor' : 'none'} /> {p.likes_count > 0 ? p.likes_count : ''}
                        </button>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>
        )}

        <footer class="gh-foot">
          {guest && (
            <button class="g-link g-leave" onClick={() => confirm(t.switchConfirm) && onLeave()}>
              {t.notYou} {t.switchName}
            </button>
          )}
          <span>{t.poweredBy}</span>
        </footer>
      </div>

      {open >= 0 && photos && (
        <Lightbox
          photos={photos}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(-1)}
          labels={{ close: t.close, prev: t.prev, next: t.next }}
          footer={(p) => (
            <>
              <div class="lb-info"><strong>{p.guest_name}</strong><span>{formatDateTime(p.created_at, event.language)}</span></div>
              {event.enable_likes && (
                <button class={`lb-action ${p.liked ? 'liked' : ''}`} onClick={() => like(p)}>
                  <Icon name="heart" size={18} fill={p.liked ? 'currentColor' : 'none'} /> {p.likes_count}
                </button>
              )}
              <a class="lb-action icon" href={`/api/g/${slug}/photos/${p.id}/download`} aria-label={t.download}><Icon name="download" size={18} /></a>
              <button class="lb-action icon" onClick={() => sharePhoto(p, event, t)} aria-label={t.share}><Icon name="share" size={18} /></button>
            </>
          )}
        />
      )}

      {cropping && <Cropper image={cropping} ratio={ratio} t={t} busy={uploading} onCancel={() => setCropping(null)} onDone={finishCrop} />}
    </div>
  )
}

render(
  <>
    <App />
    <Toasts class="g-toasts" />
  </>,
  document.getElementById('root'),
)
