import { useEffect, useState } from 'preact/hooks'
import { render } from 'preact'

// ---- toasts: a tiny global queue, rendered by <Toasts /> once per page ----
let listeners = []
let queue = []
let seq = 0
export function toast(message, kind = 'info') {
  const item = { id: ++seq, message, kind }
  queue = [...queue, item]
  listeners.forEach((l) => l(queue))
  setTimeout(() => {
    queue = queue.filter((t) => t.id !== item.id)
    listeners.forEach((l) => l(queue))
  }, kind === 'error' ? 4800 : 2800)
}
export const toastError = (e) => toast(e?.message || String(e), 'error')

export function Toasts({ class: cls = '' }) {
  const [items, setItems] = useState(queue)
  useEffect(() => {
    listeners.push(setItems)
    return () => (listeners = listeners.filter((l) => l !== setItems))
  }, [])
  return (
    <div class={`toasts ${cls}`} role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`}>{t.message}</div>
      ))}
    </div>
  )
}

export function Spinner() {
  return <span class="spinner" aria-label="Memuat" />
}

export function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" class="switch" aria-checked={checked ? 'true' : 'false'} aria-label={label} onClick={(e) => { e.stopPropagation(); onChange(!checked) }} />
  )
}

export function SwitchRow({ title, hint, checked, onChange }) {
  return (
    <div class="switch-row" onClick={() => onChange(!checked)}>
      <div>
        <strong>{title}</strong>
        {hint && <p class="hint">{hint}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  )
}

export function Seg({ value, options, onChange }) {
  return (
    <div class="seg" role="group">
      {options.map((o) => (
        <button type="button" key={o.value} aria-pressed={value === o.value ? 'true' : 'false'} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Promise-based confirm dialog: `if (await confirmDialog({...})) ...` */
export function confirmDialog({ title, body, confirm = 'Ya', cancel = 'Batal', danger = false }) {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const close = (v) => {
      render(null, host)
      host.remove()
      resolve(v)
    }
    render(
      <div class="modal-back" onClick={(e) => e.target === e.currentTarget && close(false)}>
        <div class="modal" role="dialog" aria-modal="true">
          <h3>{title}</h3>
          {body && <p class="muted" style="margin:0">{body}</p>}
          <div class="modal-actions">
            <button class="btn btn-ghost" onClick={() => close(false)}>{cancel}</button>
            <button class={`btn ${danger ? 'btn-accent' : 'btn-primary'}`} onClick={() => close(true)} autoFocus>{confirm}</button>
          </div>
        </div>
      </div>,
      host,
    )
  })
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fn().then(
      (data) => alive && setState({ loading: false, data, error: null }),
      (error) => alive && setState({ loading: false, data: null, error }),
    )
    return () => (alive = false)
  }, deps)
  return [state, setState]
}
