import { render } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import '../ui/base.css'
import './display.css'
import { api, getCatalog } from '../lib/api.js'
import { strings } from '../lib/i18n.js'
import { Icon } from '../ui/icons.jsx'
import { Lightbox } from '../ui/Lightbox.jsx'
import { Spinner, Switch } from '../ui/ui.jsx'

const eventId = location.pathname.split('/')[2]
const TOKEN = `candid:display:${eventId}`
const PREFS = 'candid:display:prefs'
const POLL_MS = 5000

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

/** Small deterministic noise from a photo id, so a polaroid keeps its tilt between polls. */
function jitter(id, salt) {
  let h = salt * 7919
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 100003
  return (h % 1000) / 1000
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
        <span class="lock-icon"><Icon name="lock" size={24} /></span>
        <p>{t.enterPasscode}</p>
        <label class="lock-slots">
          {[0, 1, 2, 3, 4, 5].map((i) => <span key={i} class={code.length === i ? 'cur' : code[i] ? 'on' : ''}>{code[i] || ''}</span>)}
          <input class="lock-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))} aria-label={t.passcode} autoFocus />
        </label>
        {error && <p class="lock-error" role="alert">{error}</p>}
        <button class="lock-btn" disabled={busy || code.length < 6}>{busy ? <Spinner /> : t.unlock}</button>
      </form>
    </div>
  )
}

/** Admission ticket with the QR: title, date, head count. Same card in every layout. */
function Ticket({ ev, data, t }) {
  return (
    <aside class="ticket">
      <span class="ticket-tape" aria-hidden="true" />
      <div class="ticket-main">
        <p class="ticket-kicker"><i /> LIVE · Candid Cam</p>
        <h1 class="ticket-name">{ev.couple_names || ev.name}</h1>
        {eventDate(ev) && <p class="ticket-date">{eventDate(ev)}</p>}
        <p class="ticket-stats">{data.guests_count}/{ev.participant_limit ?? '∞'} {t.participantsShort} · {t.photosCount(data.photos_count)}</p>
      </div>
      <div class="ticket-perf" aria-hidden="true" />
      <div class="ticket-stub">
        <div class="ticket-qr">
          <img src={`/api/g/${ev.slug}/qr.svg`} alt="QR" />
          <span class="qr-logo" aria-hidden="true"><Icon name="camera" size={15} stroke={2} /><i /></span>
        </div>
        <div class="ticket-scan">
          <strong>{t.scanToJoin}</strong>
          <span>{ev.public_url.replace(/^https?:\/\//, '')}</span>
        </div>
      </div>
    </aside>
  )
}

function Settings({ prefs, setPrefs, ev, catalog, t, onClose }) {
  const sorts = [
    ['newest', t.sortNewest],
    ['oldest', t.sortOldest],
    ...(ev.enable_likes ? [['most_liked', t.sortMostLiked], ['least_liked', t.sortLeastLiked]] : []),
  ]
  const set = (k) => (v) => setPrefs({ ...prefs, [k]: v })
  const layout = prefs.layout || ev.display_layout
  const palette = prefs.palette || ev.display_palette
  return (
    <>
      <div class="pop-back" onClick={onClose} />
      <div class="pop" role="dialog" aria-label={t.settings}>
        <p class="pop-label">{t.layout}</p>
        <div class="pop-chips">
          {catalog.display_layouts.map((l) => (
            <button key={l.id} class={layout === l.id ? 'on' : ''} onClick={() => set('layout')(l.id)}>{l.name[ev.language] || l.name.id}</button>
          ))}
        </div>
        <p class="pop-label">{t.palette}</p>
        <div class="pop-swatches">
          {catalog.display_palettes.map((p) => (
            <button key={p.id} class={palette === p.id ? 'on' : ''} style={{ background: p.bg, '--a': p.accent }} onClick={() => set('palette')(p.id)} title={p.name} aria-label={p.name} />
          ))}
        </div>
        {(prefs.layout || prefs.palette) && <button class="pop-item" onClick={() => setPrefs({ ...prefs, layout: null, palette: null })}>{t.eventDefault}</button>}
        <div class="pop-sep" />
        {layout === 'mosaic' && (
          <>
            <p class="pop-label">{t.sortBy}</p>
            {sorts.map(([v, label]) => (
              <button key={v} class={`pop-item ${prefs.sort === v ? 'on' : ''}`} onClick={() => set('sort')(v)}>
                {label} {prefs.sort === v && <Icon name="check" size={15} />}
              </button>
            ))}
            <div class="pop-sep" />
          </>
        )}
        {ev.enable_likes && <label class="pop-row">{t.showLikeCounts}<Switch checked={prefs.likes} onChange={set('likes')} label={t.showLikeCounts} /></label>}
        <label class="pop-row">{t.spotlight}<Switch checked={prefs.spotlight} onChange={set('spotlight')} label={t.spotlight} /></label>
        {layout === 'mosaic' && <label class="pop-row">{t.autoScroll}<Switch checked={prefs.scroll} onChange={set('scroll')} label={t.autoScroll} /></label>}
        {layout === 'mosaic' && prefs.scroll && (
          <label class="pop-row">
            {t.scrollSpeed}
            <input type="number" min={5} step={5} value={prefs.speed} onInput={(e) => set('speed')(Math.max(5, +e.currentTarget.value || 5))} />
          </label>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- layouts
function Likes({ p, show }) {
  return show ? <span class="likes"><Icon name="heart" size={13} fill="currentColor" /> {p.likes_count}</span> : null
}

function Mosaic({ photos, fresh, showLikes, onOpen, wallRef, t }) {
  return (
    <div class="wall" ref={wallRef}>
      <div class="mosaic">
        {photos.map((p, i) => (
          <button key={p.id} class={`tile ${fresh.has(p.id) ? 'is-new' : ''}`} onClick={() => onOpen(i)} style={{ aspectRatio: `${p.width} / ${p.height}` }}>
            <img src={p.thumb_url} srcSet={`${p.thumb_url} 720w, ${p.url} 2000w`} sizes="(min-width: 1600px) 25vw, 33vw" alt="" loading="lazy" />
            <span class="tag">{p.guest_name}<Likes p={p} show={showLikes} /></span>
            {fresh.has(p.id) && <span class="tile-new">{t.justIn}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Polaroids scattered on a table. A fixed set of slots; new photos land on the slot that has
 *  been showing longest, and when nothing new comes in the table slowly cycles the album. */
function Table({ photos, showLikes, onOpen, landscape }) {
  const cols = landscape ? 4 : 2
  const rows = landscape ? 2 : 4
  const count = cols * rows - 1 // one cell is left for the ticket
  const [slots, setSlots] = useState([])
  const seen = useRef(new Set())
  const cursor = useRef(0)
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos])

  useEffect(() => {
    setSlots((prev) => {
      let next = prev.filter((s) => byId.has(s.id) && s.slot < count)
      const incoming = photos.filter((p) => !seen.current.has(p.id))
      incoming.forEach((p) => seen.current.add(p.id))
      for (const p of incoming.reverse()) {
        const free = Array.from({ length: count }, (_, i) => i).find((i) => !next.some((s) => s.slot === i))
        if (free !== undefined) next = [...next, { id: p.id, slot: free, at: performance.now() + Math.random() }]
        else {
          const oldest = next.reduce((a, b) => (a.at < b.at ? a : b))
          next = next.map((s) => (s === oldest ? { id: p.id, slot: s.slot, at: performance.now() + Math.random() } : s))
        }
      }
      return next
    })
  }, [photos, count])

  useEffect(() => {
    const id = setInterval(() => {
      setSlots((prev) => {
        if (prev.length < count) return prev
        const shown = new Set(prev.map((s) => s.id))
        const pool = photos.filter((p) => !shown.has(p.id))
        if (!pool.length) return prev
        const pick = pool[cursor.current++ % pool.length]
        const oldest = prev.reduce((a, b) => (a.at < b.at ? a : b))
        return prev.map((s) => (s === oldest ? { id: pick.id, slot: s.slot, at: performance.now() } : s))
      })
    }, 6500)
    return () => clearInterval(id)
  }, [photos, count])

  return (
    <div class="table" style={{ '--cols': cols, '--rows': rows }}>
      {slots.map((s) => {
        const p = byId.get(s.id)
        if (!p) return null
        const col = s.slot % cols
        const row = Math.floor(s.slot / cols)
        const dx = (jitter(p.id, 1) - 0.5) * 8
        const dy = (jitter(p.id, 2) - 0.5) * 8
        const rot = (jitter(p.id, 3) - 0.5) * 16
        return (
          <button
            key={`${s.slot}-${p.id}`}
            class="pola"
            onClick={() => onOpen(photos.indexOf(p))}
            style={{ '--x': `${((col + 0.5) / cols) * 100 + dx}%`, '--y': `${((row + 0.5) / rows) * 100 + dy}%`, '--r': `${rot}deg`, '--ar': `${p.width} / ${p.height}`, '--hw': p.height / p.width }}
          >
            <span class="pola-img"><img src={p.thumb_url} alt="" /></span>
            <span class="pola-cap">{p.guest_name}<Likes p={p} show={showLikes} /></span>
          </button>
        )
      })}
    </div>
  )
}

/** One big photo at a time with a slow drift, a film strip running underneath. */
function Cinema({ photos, showLikes, onOpen, t }) {
  const [i, setI] = useState(0)
  const first = photos[0]?.id
  useEffect(() => setI(0), [first])
  useEffect(() => {
    if (photos.length < 2) return
    const id = setInterval(() => setI((n) => (n + 1) % photos.length), 7000)
    return () => clearInterval(id)
  }, [photos.length])
  const p = photos[Math.min(i, photos.length - 1)]
  const strip = photos.slice(0, 24)
  return (
    <div class="cinema">
      {p && (
        <div class="screen" key={p.id} onClick={() => onOpen(photos.indexOf(p))}>
          <img class="screen-blur" src={p.thumb_url} alt="" />
          <img class="screen-img" src={p.url} alt="" />
          <p class="screen-cap">{t.by(p.guest_name)}<Likes p={p} show={showLikes} /></p>
        </div>
      )}
      {strip.length > 0 && (
        <div class="reel" aria-hidden="true">
          <div class="reel-track" style={{ '--n': strip.length }}>
            {[...strip, ...strip].map((s, k) => (
              <span key={k} class={`reel-frame ${s.id === p?.id ? 'on' : ''}`}><img src={s.thumb_url} alt="" loading="lazy" /></span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- page
function Wall() {
  const [token, setToken] = useState(() => store.get(TOKEN, null))
  const [catalog, setCatalog] = useState(null)
  const [data, setData] = useState(null)
  const [locked, setLocked] = useState(false)
  const [missing, setMissing] = useState(false)
  const [prefs, setPrefsState] = useState(() => ({ sort: 'newest', likes: true, scroll: false, speed: 30, spotlight: true, layout: null, palette: null, ...store.get(PREFS, {}) }))
  const [menu, setMenu] = useState(false)
  const [open, setOpen] = useState(-1)
  const [fresh, setFresh] = useState(() => new Set())
  const [spot, setSpot] = useState(null)
  const [full, setFull] = useState(false)
  const [idle, setIdle] = useState(false)
  const [landscape, setLandscape] = useState(innerWidth >= innerHeight)
  const seen = useRef(null)
  const queue = useRef([])
  const wallRef = useRef(null)
  const setPrefs = (p) => {
    setPrefsState(p)
    store.set(PREFS, p)
  }

  useEffect(() => {
    getCatalog().then(setCatalog)
    const on = () => setLandscape(innerWidth >= innerHeight)
    addEventListener('resize', on)
    return () => removeEventListener('resize', on)
  }, [])

  const layoutNow = prefs.layout || data?.event.display_layout || 'mosaic'
  const sort = layoutNow === 'mosaic' ? prefs.sort : 'newest'

  useEffect(() => {
    let alive = true
    let timer = 0
    const tick = async () => {
      try {
        const r = await api(`/api/display/${eventId}/live?sort=${sort}&limit=200`, { headers: token ? { 'X-Display-Token': token } : {} })
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
  }, [token, sort])

  // Newly arrived photos get a moment on their own, one at a time.
  useEffect(() => {
    const id = setInterval(() => {
      if (spot || open >= 0 || !prefs.spotlight) return
      const next = queue.current.shift()
      if (next) {
        setSpot(next)
        setTimeout(() => setSpot(null), 6000)
      }
    }, 700)
    return () => clearInterval(id)
  }, [spot, open, prefs.spotlight])

  useEffect(() => {
    if (!prefs.scroll || layoutNow !== 'mosaic') return
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
  }, [prefs.scroll, prefs.speed, open, layoutNow])

  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), 3000)
    const wake = () => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), 3000)
    }
    addEventListener('mousemove', wake)
    addEventListener('touchstart', wake)
    const onFs = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      removeEventListener('mousemove', wake)
      removeEventListener('touchstart', wake)
      document.removeEventListener('fullscreenchange', onFs)
      clearTimeout(timer)
    }
  }, [])

  const lang = data?.event.language || 'id'
  const t = strings(lang)
  if (missing) return <div class="dsp-lock"><div class="lock-card"><p>{t.notFoundTitle}</p></div></div>
  if (locked) return <Unlock lang={lang} onUnlocked={(tk) => { setToken(tk); setLocked(false) }} />
  if (!data || !catalog) return <div class="dsp-lock"><Spinner /></div>

  const ev = data.event
  const palette = catalog.display_palettes.find((p) => p.id === (prefs.palette || ev.display_palette)) || catalog.display_palettes[0]
  const showLikes = ev.enable_likes && prefs.likes
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())
  document.title = `${ev.couple_names || ev.name} · Live Display`
  const vars = { '--bg': palette.bg, '--panel': palette.panel, '--ink': palette.ink, '--accent': palette.accent }

  return (
    <div class={`dsp2 lay-${layoutNow} ${palette.dark ? 'is-dark' : 'is-light'} ${landscape ? 'wide' : 'tall'} ${idle ? 'idle' : ''}`} style={vars}>
      {data.photos.length === 0 ? (
        <div class="empty-stage">
          <span class="empty-roll"><Icon name="film" size={40} stroke={1.2} /></span>
          <p>{t.waitingForPhotos}</p>
        </div>
      ) : layoutNow === 'table' ? (
        <Table photos={data.photos} showLikes={showLikes} onOpen={setOpen} landscape={landscape} />
      ) : layoutNow === 'cinema' ? (
        <Cinema photos={data.photos} showLikes={showLikes} onOpen={setOpen} t={t} />
      ) : (
        <Mosaic photos={data.photos} fresh={fresh} showLikes={showLikes} onOpen={setOpen} wallRef={wallRef} t={t} />
      )}

      <Ticket ev={ev} data={data} t={t} />

      <div class="tools">
        <button class="tool" onClick={toggleFull} aria-label={t.fullscreen}><Icon name={full ? 'shrink' : 'expand'} size={18} /></button>
        <button class="tool" onClick={() => setMenu(!menu)} aria-label={t.settings}><Icon name="sliders" size={18} /></button>
        {menu && <Settings prefs={prefs} setPrefs={setPrefs} ev={ev} catalog={catalog} t={t} onClose={() => setMenu(false)} />}
      </div>

      {spot && (
        <div class="spot" key={spot.id} onClick={() => setSpot(null)}>
          <figure class="spot-print">
            <span class="spot-img"><img src={spot.url} alt="" /></span>
            <figcaption>{t.by(spot.guest_name)}</figcaption>
          </figure>
          <span class="spot-kicker">{t.justIn}</span>
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
            <>
              <div class="lb-info">
                <strong>{p.guest_name}</strong>
                {showLikes && <span>{t.likes(p.likes_count)}</span>}
              </div>
              <a class="lb-action primary" href={`/api/g/${ev.slug}/photos/${p.id}/download`} download><Icon name="download" size={18} /> {t.download}</a>
            </>
          )}
        />
      )}
    </div>
  )
}

render(<Wall />, document.getElementById('root'))
