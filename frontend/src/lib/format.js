export function plural(n, word) {
  return `${n} ${word}`
}

export function formatDateTime(iso, lang = 'id') {
  if (!iso) return ''
  return new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function formatDate(iso, lang = 'id') {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** ISO (UTC) -> value for <input type="datetime-local"> in the browser's timezone. */
export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null
}

export function timeAgo(iso, lang = 'id') {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  if (s < 60) return rtf.format(-s, 'second')
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  return rtf.format(-Math.round(s / 86400), 'day')
}

export function pad2(n) {
  return String(n).padStart(2, '0')
}
