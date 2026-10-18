// Small fetch wrapper. Host calls carry the CSRF header the backend requires on mutations.

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function api(path, { method = 'GET', body, headers = {}, form } = {}) {
  const init = { method, headers: { 'X-Requested-With': 'candid', ...headers }, credentials: 'same-origin' }
  if (form) init.body = form
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError(0, 'Koneksi terputus. Cek internet kamu lalu coba lagi.')
  }
  const type = res.headers.get('content-type') || ''
  const data = type.includes('json') ? await res.json().catch(() => null) : null
  if (!res.ok) {
    let msg = data?.detail
    if (Array.isArray(msg)) msg = msg.map((d) => d.msg).join(', ')
    throw new ApiError(res.status, msg || `Terjadi kesalahan (${res.status})`)
  }
  return data
}

let catalogPromise = null
export function getCatalog() {
  catalogPromise ||= api('/api/catalog')
  return catalogPromise
}
