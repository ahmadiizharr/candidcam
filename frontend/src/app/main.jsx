import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import '../ui/base.css'
import '../guest/guest.css'
import './app.css'
import { api, getCatalog } from '../lib/api.js'
import { Icon } from '../ui/icons.jsx'
import { Spinner, Toasts } from '../ui/ui.jsx'
import { AuthPage } from './auth.jsx'
import { EventPage } from './event.jsx'
import { EventList } from './events.jsx'
import { Link, navigate, usePath } from './router.jsx'
import { Wizard } from './wizard.jsx'
import { Wordmark } from './Wordmark.jsx'

function TopBar({ user, onLogout }) {
  return (
    <header class="topbar">
      <Wordmark />
      <nav class="topnav">
        <Link href="/app" class="topnav-link">Acara Saya</Link>
        <span class="topnav-user" title={user.email}>{user.name}</span>
        <button class="btn btn-sm btn-ghost" onClick={onLogout} aria-label="Keluar"><Icon name="logout" size={16} /> <span class="hide-sm">Keluar</span></button>
      </nav>
    </header>
  )
}

function App() {
  const path = usePath()
  const [user, setUser] = useState(undefined)
  const [catalog, setCatalog] = useState(null)

  useEffect(() => {
    api('/api/auth/me').then((r) => setUser(r.user), () => setUser(null))
    getCatalog().then(setCatalog)
  }, [])

  if (user === undefined || !catalog) return <div class="center-fill"><Spinner /></div>

  const next = new URLSearchParams(location.search).get('next') || ''
  if (path.startsWith('/app/register') || path.startsWith('/app/login') || !user) {
    if (user && (path.startsWith('/app/login') || path.startsWith('/app/register'))) {
      navigate('/app', { replace: true })
      return null
    }
    const mode = path.startsWith('/app/register') ? 'register' : 'login'
    return <AuthPage mode={mode} onAuthed={setUser} next={user ? '' : next || (path.startsWith('/app/log') || path.startsWith('/app/reg') ? '' : path)} />
  }

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {})
    setUser(null)
    navigate('/app/login', { replace: true })
  }

  let body
  const m = path.match(/^\/app\/e\/([0-9a-f]{32})(?:\/(photos|guests|settings))?\/?$/)
  if (path === '/app/new') body = <Wizard catalog={catalog} />
  else if (m) body = <EventPage key={m[1]} id={m[1]} tab={m[2] || 'overview'} catalog={catalog} />
  else body = <EventList user={user} />

  return (
    <div class={`shell ${path === '/app/new' ? 'shell-wizard' : ''}`}>
      <TopBar user={user} onLogout={logout} />
      <main>{body}</main>
    </div>
  )
}

render(
  <>
    <App />
    <Toasts />
  </>,
  document.getElementById('root'),
)
