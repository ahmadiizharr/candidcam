import { useEffect, useState } from 'preact/hooks'

let subs = []

export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search) return
  history[replace ? 'replaceState' : 'pushState'](null, '', to)
  subs.forEach((f) => f(location.pathname))
  window.scrollTo(0, 0)
}

export function usePath() {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const onPop = () => setPath(location.pathname)
    subs.push(setPath)
    addEventListener('popstate', onPop)
    return () => {
      subs = subs.filter((f) => f !== setPath)
      removeEventListener('popstate', onPop)
    }
  }, [])
  return path
}

export function Link({ href, onClick, ...rest }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || rest.target) return
        e.preventDefault()
        navigate(href)
      }}
      {...rest}
    />
  )
}
