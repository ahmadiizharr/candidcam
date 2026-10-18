import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import '../ui/base.css'
import './display.css'
import { api } from '../lib/api.js'
import { strings } from '../lib/i18n.js'
import { Icon } from '../ui/icons.jsx'
import { Lightbox } from '../ui/Lightbox.jsx'
import { Spinner, Switch } from '../ui/ui.jsx'

const eventId = location.pathname.split('/')[2]
const TOKEN = `candid:display:${eventId}`
const PREFS = 'candid:display:prefs'
const POLL_MS = 5000
const FILM_EDGE = 'CANDID 400 ◂ 12 ◂ 12A ◂ 13 ◂ 13A ◂ 14 ◂ 14A ◂ 15 ◂ 15A ◂ 16 ◂ 16A ◂ 17 ◂ 17A ◂ 18 ◂ 18A ◂ 19 ◂ 19A ◂ 20'

const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(k)
      return v === null ? fallback : JSON.parse(v)
    } catch {
      return fallback
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch {
      /* ignore */
    }
  },
}

/** The day of the event: its schedule, else the frame date, else the day it was created. */
function eventDate(ev) {
  let d = null
  if (ev.starts_at) d = new Date(ev.starts_at)
  else if (ev.frame_date) {
    const [y, m, day] = ev.frame_date.split('-').map(Number)
    d = new Date(y, m - 1, day)
  } else if (ev.created_at) d = new Date(ev.created_at)
  if (!d || Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(ev.language === 'en' ? 'en-GB' : 'id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function Unlock({ onUnlocked, lang }) {
  const t = strings(lang)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await api(`/api/display/${eventId}/unlock`, { method: 'POST', body: { passcode: code } })
      store.set(TOKEN, r.token)
      onUnlocked(r.token)
    } catch (err) {
      setError(err.status === 403 ? t.wrongPasscode : err.message)
      setCode('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div class="dsp-lock">
      <form class="lock-card" onSubmit={submit}>
        <span class="lock-icon"><Icon name="lock" size={26} /></span>
        <p>{t.enterPasscode}</p>
        <input
          class="lock-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))}
          placeholder="••••••"
          aria-label={t.passcode}
          autoFocus
        />
        {error && <p class="lock-error" role="alert">{error}</p>}
        <button class="lock-btn" disabled={busy || code.length < 6}>{busy ? <Spinner /> : t.unlock}</button>
      </form>
    </div>
  )
}

function Settings({ prefs, setPrefs, likes, t, onClose }) {
  const sorts = [
    ['newest', t.sortNewest],
    ['oldest', t.sortOldest],
    ...(likes ? [['most_liked', t.sortMostLiked], ['least_liked', t.sortLeastLiked]] : []),
  ]
  const set = (k) => (v) => setPrefs({ ...prefs, [k]: v })
  return (
    <>
      <div class="pop-back" onClick={onClose} />
      <div class="pop" role="dialog" aria-label={t.settings}>
        <p class="pop-label">{t.sortBy}</p>
        {sorts.map(([v, label]) => (
          <button key={v} class={`pop-item ${prefs.sort === v ? 'on' : ''}`} onClick={() => set('sort')(v)}>
            {label} {prefs.sort === v && <Icon name="check" size={15} />}
          </button>
        ))}
        <div class="pop-sep" />
        {likes && (
          <label class="pop-row">{t.showLikeCounts}<Switch checked={prefs.likes} onChange={set('likes')} label={t.showLikeCounts} /></label>
        )}
        <label class="pop-row">{t.spotlight}<Switch checked={prefs.spotlight} onChange={set('spotlight')} label={t.spotlight} /></label>
        <label class="pop-row">{t.autoScroll}<Switch checked={prefs.scroll} onChange={set('scroll')} label={t.autoScroll} /></label>
        {prefs.scroll && (
          <label class="pop-row">
            {t.scrollSpeed}
            <input type="number" min={5} step={5} value={prefs.speed} onInput={(e) => set('speed')(Math.max(5, +e.currentTarget.value || 5))} />
          </label>
        )}
      </div>
    </>
  )
}

function Wall() {
  const [token, setToken] = useState(() => store.get(TOKEN, null))
  const [data, setData] = useState(null)
  const [locked, setLocked] = useState(false)
  const [missing, setMissing] = useState(false)
  const [prefs, setPrefsState] = useState(() => ({ sort: 'newest', likes: true, scroll: false, speed: 30, spotlight: true, ...store.get(PREFS, {}) }))
  const [menu, setMenu] = useState(false)
  const [open, setOpen] = useState(-1)
  const [fresh, setFresh] = useState(() => new Set())
  const [spot, setSpot] = useState(null)
  const [full, setFull] = useState(false)
  const [idle, setIdle] = useState(false)
  const seen = useRef(null)
  const queue = useRef([])
  const wallRef = useRef(null)
  const setPrefs = (p) => {
    setPrefsState(p)
    store.set(PREFS, p)
  }

  // Poll the live feed.
  useEffect(() => {
    let alive = true
    let timer = 0
    const tick = async () => {
      try {
        const r = await api(`/api/display/${eventId}/live?sort=${prefs.sort}&limit=200`, { headers: token ? { 'X-Display-Token': token } : {} })
        if (!alive) return
        setLocked(false)
        const ids = new Set(r.photos.map((p) => p.id))
        if (seen.current) {
          const added = r.photos.filter((p) => !seen.current.has(p.id))
          if (added.length) {
            setFresh((f) => new Set([...f, ...added.map((p) => p.id)]))
            setTimeout(() => setFresh((f) => new Set([...f].filter((id) => !added.some((p) => p.id === id)))), 9000)
            queue.current.push(...added.slice(0, 5).reverse())
          }
        }
        seen.current = ids
        setData(r)
      } catch (e) {
        if (!alive) return
        if (e.status === 403) {
          store.set(TOKEN, null)
          setLocked(true)
        } else if (e.status === 404) setMissing(true)
      }
      timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [token, prefs.sort])

  // Spotlight newly arrived photos one by one.
  useEffect(() => {
    const id = setInterval(() => {
      if (spot || open >= 0 || !prefs.spotlight) return
      const next = queue.current.shift()
      if (next) {
        setSpot(next)
        setTimeout(() => setSpot(null), 5500)
      }
    }, 700)
    return () => clearInterval(id)
  }, [spot, open, prefs.spotlight])

  // Auto-scroll the wall, pausing at the bottom before returning to the top.
  useEffect(() => {
    if (!prefs.scroll) return
    let raf = 0
    let last = performance.now()
    let pause = 0
    const el = wallRef.current
    let pos = el?.scrollTop || 0
    const loop = (now) => {
      raf = requestAnimationFrame(loop)
      const dt = (now - last) / 1000
      last = now
      if (!el || open >= 0) return
      if (pause > 0) {
        pause -= dt
        if (pause <= 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
          el.scrollTo({ top: 0, behavior: 'smooth' })
          pos = 0
          pause = 2
        }
        return
      }
      if (Math.abs(el.scrollTop - pos) > 4) pos = el.scrollTop
      pos += prefs.speed * dt
      el.scrollTop = pos
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) pause = 3
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [prefs.scroll, prefs.speed, open])

  // Hide the cursor on an idle projector screen.
  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), 3000)
    const wake = () => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), 3000)
    }
    addEventListener('mousemove', wake)
    const onFs = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      removeEventListener('mousemove', wake)
      document.removeEventListener('fullscreenchange', onFs)
      clearTimeout(timer)
    }
  }, [])

  const lang = data?.event.language || 'id'
  const t = strings(lang)
  if (missing) return <div class="dsp-lock"><div class="lock-card"><p>{t.notFoundTitle}</p></div></div>
  if (locked) return <Unlock lang={lang} onUnlocked={(tk) => { setToken(tk); setLocked(false) }} />
  if (!data) return <div class="dsp-lock"><Spinner /></div>

  const ev = data.event
  const showLikes = ev.enable_likes && prefs.likes
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())
  const scrap = ev.theme === 'scrapbook'
  document.title = `${ev.name} · Live Display`

  return (
    <div class={`dsp ${scrap ? 'dsp-scrap' : 'dsp-dark'} ${idle ? 'idle' : ''}`}>
      <aside class="dsp-side">
        <div class="side-cover">
          {ev.cover_url ? <img src={ev.cover_url} alt="" /> : <span class="side-cover-empty"><Icon name="camera" size={44} stroke={1.2} /></span>}
          {scrap ? (
            <>
              <span class="side-tape l" />
              <span class="side-tape r" />
            </>
          ) : (
            <>
              <span class="side-vignette" />
              <span class="side-sprockets l"><span>{FILM_EDGE}</span></span>
              <span class="side-sprockets r"><span>{FILM_EDGE}</span></span>
              <span class="side-fade" />
            </>
          )}
          <span class="side-pill"><i /> LIVE · Candid Cam</span>
        </div>
        <div class="side-body">
          <h1 class="side-name">{ev.couple_names || ev.name}</h1>
          {eventDate(ev) && <p class="side-date">{eventDate(ev)}</p>}
          <p class="side-stats">
            <span><Icon name="users" size={14} /> {data.guests_count}/{ev.participant_limit ?? '∞'} {t.participantsShort}</span>
            <span class="dot" />
            <span><Icon name="camera" size={14} /> {t.photosCount(data.photos_count)}</span>
          </p>
          <div class="side-qr">
            <img src={`/api/g/${ev.slug}/qr.svg`} alt="QR" />
            <span class="qr-logo" aria-hidden="true"><Icon name="camera" size={18} stroke={2} /><i /></span>
          </div>
          <p class="side-scan">{t.scanToJoin}</p>
          <p class="side-url">{ev.public_url.replace(/^https?:\/\//, '')}</p>
        </div>
        <p class="side-brand"><span class="wm-dot" /> Candid<em>Cam</em></p>
      </aside>

      <main class="dsp-main">
        <div class="dsp-tools">
          <button class="tool" onClick={toggleFull} aria-label={t.fullscreen}><Icon name={full ? 'shrink' : 'expand'} size={18} /></button>
          <button class="tool" onClick={() => setMenu(!menu)} aria-label={t.settings}><Icon name="sliders" size={18} /></button>
          {menu && <Settings prefs={prefs} setPrefs={setPrefs} likes={ev.enable_likes} t={t} onClose={() => setMenu(false)} />}
        </div>
        <div class="dsp-wall" ref={wallRef}>
          {data.photos.length === 0 ? (
            <div class="dsp-empty">
              <span class="empty-roll"><Icon name="film" size={40} stroke={1.2} /></span>
              <p>{t.waitingForPhotos}</p>
            </div>
          ) : (
            <div class="wall-grid">
              {data.photos.map((p, i) => (
                <button key={p.id} class={`wall-item ${fresh.has(p.id) ? 'is-new' : ''}`} onClick={() => setOpen(i)} style={{ aspectRatio: `${p.width} / ${p.height}`, '--r': `${((p.id.charCodeAt(0) + p.id.charCodeAt(1)) % 5) - 2}deg` }}>
                  <img src={p.thumb_url} srcSet={`${p.thumb_url} 720w, ${p.url} 2000w`} sizes="(min-width: 1600px) 25vw, 33vw" alt="" loading="lazy" />
                  <span class="wall-meta">
                    <span>{p.guest_name}</span>
                    {showLikes && <span><Icon name="heart" size={14} fill="currentColor" /> {p.likes_count}</span>}
                  </span>
                  {fresh.has(p.id) && <span class="wall-new">{t.justIn}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </main>

      {spot && (
        <div class="spot" key={spot.id} onClick={() => setSpot(null)}>
          <figure>
            <img src={spot.url} alt="" />
            <figcaption><span class="spot-kicker">{t.justIn}</span> {spot.guest_name}</figcaption>
          </figure>
        </div>
      )}

      {open >= 0 && (
        <Lightbox
          photos={data.photos}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(-1)}
          labels={{ close: t.close, prev: t.prev, next: t.next }}
          footer={(p) => (
            <div class="lb-info">
              <strong>{p.guest_name}</strong>
              {showLikes && <span>{t.likes(p.likes_count)}</span>}
            </div>
          )}
        />
      )}
    </div>
  )
}

render(<Wall />, document.getElementById('root'))
