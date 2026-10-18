import { useState } from 'preact/hooks'
import { api } from '../lib/api.js'
import { Wordmark } from './Wordmark.jsx'
import { Link, navigate } from './router.jsx'

const SHOTS = ['/static/guest-1.jpg', '/static/guest-3.jpg', '/static/guest-2.jpg', '/static/sample.jpg', '/static/guest-4.jpg']

export function AuthPage({ mode, onAuthed, next }) {
  const isLogin = mode === 'login'
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm({ ...form, [k]: e.currentTarget.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = isLogin ? { email: form.email, password: form.password } : form
      const res = await api(`/api/auth/${isLogin ? 'login' : 'register'}`, { method: 'POST', body })
      onAuthed(res.user)
      navigate(next && next.startsWith('/app') && !next.startsWith('/app/login') && !next.startsWith('/app/register') ? next : '/app', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const q = next ? `?next=${encodeURIComponent(next)}` : ''
  return (
    <div class="auth">
      <aside class="auth-art" aria-hidden="true">
        <Wordmark href="/" />
        <div class="auth-stack">
          {SHOTS.map((src, i) => (
            <figure key={src} class={`auth-shot s${i}`}>
              <img src={src} alt="" />
              <figcaption>{['Rina', 'Dimas', 'Laras', 'Sinta', 'Bayu'][i]}</figcaption>
            </figure>
          ))}
        </div>
        <p class="auth-quote serif">Setiap tamu memegang kamera.<br /><em>Kamu tinggal menikmati acaranya.</em></p>
      </aside>
      <main class="auth-main">
        <div class="auth-mobile-mark"><Wordmark href="/" /></div>
        <form class="auth-form" onSubmit={submit}>
          <p class="kicker">{isLogin ? 'Masuk' : 'Daftar gratis'}</p>
          <h1 class="serif">{isLogin ? 'Selamat datang kembali.' : 'Buat akun penyelenggara.'}</h1>
          <p class="muted">{isLogin ? 'Kelola acara dan lihat foto dari tamu-tamumu.' : 'Gratis untuk 5 tamu pertama di setiap acara.'}</p>
          {!isLogin && (
            <div class="field">
              <label for="name">Nama</label>
              <input id="name" class="input" autoComplete="name" required maxLength={80} value={form.name} onInput={set('name')} />
            </div>
          )}
          <div class="field">
            <label for="email">Email</label>
            <input id="email" class="input" type="email" autoComplete="email" required value={form.email} onInput={set('email')} />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input id="password" class="input" type="password" autoComplete={isLogin ? 'current-password' : 'new-password'} required minLength={isLogin ? 1 : 8} value={form.password} onInput={set('password')} />
            {!isLogin && <p class="hint">Minimal 8 karakter.</p>}
          </div>
          {error && <p class="form-error" role="alert">{error}</p>}
          <button class="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Memproses…' : isLogin ? 'Masuk' : 'Buat Akun'}</button>
          <p class="auth-switch muted">
            {isLogin ? 'Belum punya akun? ' : 'Sudah punya akun? '}
            <Link href={`/app/${isLogin ? 'register' : 'login'}${q}`}>{isLogin ? 'Daftar di sini' : 'Masuk di sini'}</Link>
          </p>
        </form>
      </main>
    </div>
  )
}
