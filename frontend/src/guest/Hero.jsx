import { Icon } from '../ui/icons.jsx'

const FILM_EDGE = 'CANDID 400 ◂ 12 ◂ 12A ◂ 13 ◂ 13A ◂ 14 ◂ 14A ◂ 15 ◂ 15A ◂ 16 ◂ 16A ◂ 17'

function Doodle({ kind, class: cls }) {
  if (kind === 'star')
    return (
      <svg class={cls} viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 4c1.4 7.6 4.2 11 12.5 12.8-8.3 1.6-11 5-12.6 13.2C18.4 21.8 15.5 18.6 7.5 17c8-1.8 11-5.2 12.5-13z" />
      </svg>
    )
  if (kind === 'heart')
    return (
      <svg class={cls} viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 33C11 27 5.5 21.5 6.2 14.6 6.8 9 13.6 6.3 17.6 10.4c1 1 1.8 2.3 2.4 3.7.7-1.5 1.6-2.9 2.8-3.9 4.4-3.6 11-.5 11.1 5.4.1 6.6-5.8 12-13.9 17.4z" />
      </svg>
    )
  return (
    <svg class={cls} viewBox="0 0 120 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <path d="M3 12c10-8 18 6 28-1s18 6 28-1 18 6 28-1 18 6 28-1" />
    </svg>
  )
}

/** Cover, title and head count of the guest home, in the event's theme. */
export function Hero({ event, t, coverUrl }) {
  const cover = coverUrl !== undefined ? coverUrl : event.cover_url
  const count = t.participants(event.guests_count ?? 0, event.participant_limit)
  if (event.theme === 'scrapbook') {
    return (
      <header class="gh-hero gh-scrap">
        <div class="gh-scrap-photo">
          <span class="gh-tape gh-tape-l" />
          <span class="gh-tape gh-tape-r" />
          <div class="gh-scrap-img">
            {cover ? <img src={cover} alt="" /> : <div class="gh-cover-empty"><Icon name="camera" size={40} stroke={1.4} /></div>}
          </div>
          <span class="gh-scrap-stamp">{t.poweredBy}</span>
        </div>
        <h1 class="gh-title">
          {event.name || ' '}
          <Doodle kind="star" class="gh-doodle-star" />
        </h1>
        <Doodle kind="squiggle" class="gh-doodle-line" />
        <p class="gh-count"><Icon name="users" size={15} /> {count}</p>
      </header>
    )
  }
  return (
    <header class="gh-hero gh-dark">
      <div class="gh-dark-cover">
        {cover ? <img src={cover} alt="" /> : <div class="gh-cover-empty"><Icon name="camera" size={40} stroke={1.3} /></div>}
        <div class="gh-dark-vignette" />
        <div class="gh-sprockets gh-sprockets-l"><span>{FILM_EDGE}</span></div>
        <div class="gh-sprockets gh-sprockets-r"><span>{FILM_EDGE}</span></div>
        <span class="gh-badge">{t.poweredBy}</span>
        <div class="gh-dark-fade" />
      </div>
      <div class="gh-dark-text">
        <h1 class="gh-title">{event.name || ' '}</h1>
        <p class="gh-count">{count}</p>
      </div>
    </header>
  )
}
