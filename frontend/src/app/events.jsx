import { api } from '../lib/api.js'
import { formatDate } from '../lib/format.js'
import { Icon } from '../ui/icons.jsx'
import { Spinner, useAsync } from '../ui/ui.jsx'
import { Link } from './router.jsx'

export const STATUS = {
  open: ['Berlangsung', 'chip-live'],
  not_started: ['Belum dimulai', 'chip-wait'],
  ended: ['Selesai', 'chip-end'],
  archived: ['Diarsipkan', 'chip-end'],
}

export function StatusChip({ status }) {
  const [label, cls] = STATUS[status] || STATUS.open
  return <span class={`chip ${cls}`}>{label}</span>
}

export function EventList({ user }) {
  const [{ loading, data, error }] = useAsync(() => api('/api/events'), [])
  if (loading) return <div class="center-fill"><Spinner /></div>
  if (error) return <div class="center-fill">{error.message}</div>
  const events = data.events
  return (
    <div class="page">
      <header class="page-head">
        <div>
          <p class="kicker">Halo, {user.name.split(' ')[0]}</p>
          <h1 class="serif">Acara Saya</h1>
        </div>
        {events.length > 0 && <Link class="btn btn-accent" href="/app/new"><Icon name="plus" size={17} /> Buat Acara</Link>}
      </header>
      {events.length === 0 ? (
        <div class="empty card">
          <div class="empty-art" aria-hidden="true">
            <img src="/static/guest-1.jpg" alt="" class="ea-1" />
            <img src="/static/guest-2.jpg" alt="" class="ea-2" />
            <img src="/static/sample.jpg" alt="" class="ea-3" />
          </div>
          <h2 class="serif">Acara pertamamu, difoto langsung oleh tamu-tamumu.</h2>
          <p class="muted">Buat Candid Cam, bagikan QR-nya di meja tamu, lalu nikmati album yang terisi sendiri sepanjang acara.</p>
          <Link class="btn btn-accent btn-lg" href="/app/new"><Icon name="plus" size={18} /> Buat Acara</Link>
        </div>
      ) : (
        <div class="event-grid">
          {events.map((ev) => (
            <Link key={ev.id} class="event-card card" href={`/app/e/${ev.id}`}>
              <span class={`ec-cover theme-${ev.theme}`}>
                {ev.cover_url ? <img src={ev.cover_url} alt="" loading="lazy" /> : <Icon name="camera" size={30} stroke={1.3} />}
                <StatusChip status={ev.status} />
              </span>
              <span class="ec-body">
                <strong class="ec-name">{ev.name}</strong>
                <span class="ec-link mono">/{ev.slug}</span>
                <span class="ec-stats">
                  <span><Icon name="users" size={15} /> {ev.guests_count}{ev.participant_limit === null ? '' : `/${ev.participant_limit}`}</span>
                  <span><Icon name="image" size={15} /> {ev.photos_count}</span>
                  <span class="muted">{formatDate(ev.created_at)}</span>
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
