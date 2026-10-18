import '../ui/base.css'
import './landing.css'

// Gently tilt the hero polaroids with the pointer; nothing else here needs JS.
const stack = document.querySelector('.hero-art')
if (stack && matchMedia('(pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  stack.addEventListener('pointermove', (e) => {
    const r = stack.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    stack.style.setProperty('--mx', x.toFixed(3))
    stack.style.setProperty('--my', y.toFixed(3))
  })
  stack.addEventListener('pointerleave', () => {
    stack.style.setProperty('--mx', 0)
    stack.style.setProperty('--my', 0)
  })
}
