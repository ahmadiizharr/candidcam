export function Wordmark({ href = '/app' }) {
  return (
    <a class="wordmark" href={href} aria-label="Candid Cam">
      <span class="wm-dot" aria-hidden="true" />
      <span class="wm-text">Candid<em>Cam</em></span>
    </a>
  )
}
