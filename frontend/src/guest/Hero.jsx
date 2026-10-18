import { Icon } from '../ui/icons.jsx'

const FILM_EDGE = 'CANDID 400 ◂ 12 ◂ 12A ◂ 13 ◂ 13A ◂ 14 ◂ 14A ◂ 15 ◂ 15A ◂ 16 ◂ 16A ◂ 17'

/** Readable text colour on top of `hex`. */
export function onColor(hex) {
  const n = parseInt((hex || '#000000').slice(1), 16)
  const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
  return l > 0.6 ? '#141210' : '#ffffff'
}

/** Inline CSS variables for the host's accent colour, if they picked one. */
export function themeVars(event) {
  return event.accent_color ? { '--g-accent': event.accent_color, '--g-on-accent': onColor(event.accent_color) } : {}
}

/** "Pernikahan Nadia & Rafi" -> "N&R": the names either side of the ampersand. */
function initials(name) {
  const parts = (name || '').split(/\s*(?:&|\+|\bdan\b|\band\b)\s*/i).filter((p) => p.trim())
  if (parts.length >= 2) {
    const a = parts[0].trim().split(/\s+/).pop()
    const b = parts[1].trim().split(/\s+/)[0]
    return `${a[0]}&${b[0]}`.toUpperCase()
  }
  const words = (name || '').trim().split(/\s+/)
  return (words[0]?.[0] || '·').toUpperCase()
}

/** Stable ticket number from the event id, so it never changes between visits. */
function serial(id = '') {
  let n = 7
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) % 999983
  return String(n % 1000000).padStart(6, '0')
}

function Doodle({ kind, class: cls }) {
  if (kind === 'star')
    return (
      <svg class={cls} viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 4c1.4 7.6 4.2 11 12.5 12.8-8.3 1.6-11 5-12.6 13.2C18.4 21.8 15.5 18.6 7.5 17c8-1.8 11-5.2 12.5-13z" />
      </svg>
    )
  if (kind === 'sprig')
    return (
      <svg class={cls} viewBox="0 0 60 120" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
        <path d="M30 118C30 80 28 40 34 4" />
        <path d="M31 96c-9-2-16-9-18-19 9 1 16 8 18 19zM31 74c9-3 15-10 16-20-9 2-15 9-16 20zM30 54c-8-3-13-10-13-19 8 2 13 9 13 19zM32 34c7-3 11-9 11-17-7 2-11 8-11 17z" />
      </svg>
    )
  return (
    <svg class={cls} viewBox="0 0 120 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <path d="M3 12c10-8 18 6 28-1s18 6 28-1 18 6 28-1 18 6 28-1" />
    </svg>
  )
}

function Cover({ src, class: cls }) {
  return src ? <img class={cls} src={src} alt="" /> : <div class={`gh-cover-empty ${cls || ''}`}><Icon name="camera" size={36} stroke={1.3} /></div>
}

/** Cover, title and head count of the guest home, in the event's theme. */
export function Hero({ event, t, coverUrl }) {
  const cover = coverUrl !== undefined ? coverUrl : event.cover_url
  const count = t.participants(event.guests_count ?? 0, event.participant_limit)
  const name = event.name || ' '

  switch (event.theme) {
    case 'scrapbook':
      return (
        <header class="gh-hero gh-scrap">
          <div class="gh-scrap-photo">
            <span class="gh-tape gh-tape-l" />
            <span class="gh-tape gh-tape-r" />
            <div class="gh-scrap-img"><Cover src={cover} /></div>
            <span class="gh-scrap-stamp">{t.poweredBy}</span>
          </div>
          <h1 class="gh-title">{name}<Doodle kind="star" class="gh-doodle-star" /></h1>
          <Doodle kind="squiggle" class="gh-doodle-line" />
          <p class="gh-count"><Icon name="users" size={15} /> {count}</p>
        </header>
      )

    case 'ivory':
      return (
        <header class="gh-hero gh-ivory">
          <p class="gh-mono">{initials(event.couple_names || event.name)}</p>
          <div class="gh-arch"><Cover src={cover} /></div>
          <h1 class="gh-title">{name}</h1>
          <span class="gh-rule" aria-hidden="true"><i /></span>
          <p class="gh-count">{count}</p>
        </header>
      )

    case 'contact_sheet':
      return (
        <header class="gh-hero gh-sheet">
          <p class="gh-sheet-label"><span>ROLL 01</span><span>{t.poweredBy}</span><span>36 EXP</span></p>
          <div class="gh-sheet-row" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} class="gh-sheet-thumb" style={{ '--o': `${20 + i * 30}%` }}>
                <Cover src={cover} />
                <em>{12 + i}</em>
              </span>
            ))}
          </div>
          <div class="gh-sheet-pick">
            <Cover src={cover} />
            <svg class="gh-grease" viewBox="0 0 200 160" preserveAspectRatio="none" aria-hidden="true">
              <path d="M18 84C14 38 70 10 116 12c48 2 74 30 70 70-4 44-52 68-98 66C40 146 20 120 18 84c-1-18 6-34 16-44" />
            </svg>
            <em class="gh-sheet-num">15 ▸</em>
          </div>
          <h1 class="gh-title">{name}</h1>
          <p class="gh-count">{count}</p>
        </header>
      )

    case 'riso':
      return (
        <header class="gh-hero gh-riso">
          <span class="gh-riso-stamp">ZINE · NO. {serial(event.id).slice(-2)}</span>
          <div class="gh-riso-print">
            {cover ? (
              <>
                <img class="ink-a" src={cover} alt="" />
                <img class="ink-b" src={cover} alt="" />
              </>
            ) : (
              <Cover src={null} />
            )}
          </div>
          <h1 class="gh-title" data-text={name}>{name}</h1>
          <p class="gh-count">{count}</p>
        </header>
      )

    case 'ticket':
      return (
        <header class="gh-hero gh-ticket">
          <div class="gh-ticket-card">
            <div class="gh-ticket-img"><Cover src={cover} /></div>
            <div class="gh-ticket-perf" aria-hidden="true" />
            <div class="gh-ticket-stub">
              <p class="gh-ticket-admit">ADMIT ONE</p>
              <h1 class="gh-title">{name}</h1>
              <p class="gh-ticket-meta"><span>No. {serial(event.id)}</span><span>{count}</span></p>
              <span class="gh-barcode" aria-hidden="true" />
            </div>
          </div>
        </header>
      )

    case 'neon':
      return (
        <header class="gh-hero gh-neon">
          <div class="gh-neon-frame"><Cover src={cover} /></div>
          <h1 class="gh-title">{name}</h1>
          <p class="gh-count"><i class="gh-neon-dot" /> {count}</p>
        </header>
      )

    case 'garden':
      return (
        <header class="gh-hero gh-garden">
          <div class="gh-oval-wrap">
            <Doodle kind="sprig" class="gh-sprig l" />
            <div class="gh-oval"><Cover src={cover} /></div>
            <Doodle kind="sprig" class="gh-sprig r" />
          </div>
          <h1 class="gh-title">{name}</h1>
          <p class="gh-count">{count}</p>
        </header>
      )

    case 'noir_gold':
      return (
        <header class="gh-hero gh-deco">
          <p class="gh-deco-kicker"><span />{t.poweredBy}<span /></p>
          <div class="gh-deco-frame">
            <span class="gh-deco-corner tl" /><span class="gh-deco-corner tr" /><span class="gh-deco-corner bl" /><span class="gh-deco-corner br" />
            <div class="gh-deco-img"><Cover src={cover} /></div>
          </div>
          <h1 class="gh-title">{name}</h1>
          <p class="gh-deco-fan" aria-hidden="true" />
          <p class="gh-count">{count}</p>
        </header>
      )

    case 'velvet':
      return (
        <header class="gh-hero gh-velvet">
          <div class="gh-velvet-img"><Cover src={cover} /></div>
          <p class="gh-velvet-kicker">— {t.poweredBy} —</p>
          <h1 class="gh-title">{name}</h1>
          <p class="gh-count">{count}</p>
        </header>
      )

    case 'marquee':
      return (
        <header class="gh-hero gh-marquee">
          <div class="gh-marquee-sign">
            <span class="gh-bulbs" aria-hidden="true" />
            <p class="gh-marquee-now">NOW SHOWING</p>
            <div class="gh-marquee-img"><Cover src={cover} /></div>
            <h1 class="gh-title">{name}</h1>
          </div>
          <p class="gh-count">{count}</p>
        </header>
      )

    case 'moonlight':
      return (
        <header class="gh-hero gh-moon">
          <span class="gh-stars" aria-hidden="true" />
          <div class="gh-moon-disc"><Cover src={cover} /></div>
          <h1 class="gh-title">{name}</h1>
          <p class="gh-count">{count}</p>
        </header>
      )

    default:
      return (
        <header class="gh-hero gh-dark">
          <div class="gh-dark-cover">
            <Cover src={cover} />
            <div class="gh-dark-vignette" />
            <div class="gh-sprockets gh-sprockets-l"><span>{FILM_EDGE}</span></div>
            <div class="gh-sprockets gh-sprockets-r"><span>{FILM_EDGE}</span></div>
            <span class="gh-badge">{t.poweredBy}</span>
            <div class="gh-dark-fade" />
          </div>
          <div class="gh-dark-text">
            <h1 class="gh-title">{name}</h1>
            <p class="gh-count">{count}</p>
          </div>
        </header>
      )
  }
}
