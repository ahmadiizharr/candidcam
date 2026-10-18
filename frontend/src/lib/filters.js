// Camera filters as one WebGL shader with per-look parameters. The same renderer drives the
// live viewfinder, the full-resolution capture and the wizard thumbnails, so what a guest
// sees is exactly what gets saved.

const N = [0.5, 0.5, 0.5]

const base = {
  exposure: 0, contrast: 1, curve: 0, saturation: 1, temp: 0, tint: 0, fade: 0,
  shadow: N, shadowAmt: 0, high: N, highAmt: 0, vignette: 0, grain: 0, glow: 0, smooth: 0,
}

export const PRESETS = {
  none: {},
  amber_vintage: { temp: 0.42, tint: 0.04, contrast: 1.04, curve: 0.25, saturation: 0.82, fade: 0.07, shadow: [0.42, 0.26, 0.12], shadowAmt: 0.55, high: [1, 0.82, 0.55], highAmt: 0.35, vignette: 0.35, grain: 0.035 },
  cinema_deep: { exposure: -0.12, contrast: 1.16, curve: 0.45, saturation: 0.86, shadow: [0.05, 0.3, 0.36], shadowAmt: 0.7, high: [1, 0.78, 0.6], highAmt: 0.35, vignette: 0.42, grain: 0.02 },
  warm_classic: { exposure: 0.04, temp: 0.28, tint: 0.05, contrast: 1.06, curve: 0.2, saturation: 1.06, fade: 0.025, high: [1, 0.86, 0.7], highAmt: 0.25, vignette: 0.18 },
  retro_toy: { contrast: 1.28, curve: 0.5, saturation: 1.38, temp: 0.05, shadow: [0.12, 0.18, 0.62], shadowAmt: 0.75, high: [1, 0.95, 0.45], highAmt: 0.6, vignette: 0.75, grain: 0.05 },
  soft_skin: { exposure: 0.1, contrast: 0.94, saturation: 0.96, temp: 0.08, tint: 0.03, smooth: 0.75, glow: 0.18, high: [1, 0.86, 0.82], highAmt: 0.3, fade: 0.02 },
  directors_cut: { exposure: -0.05, contrast: 1.14, curve: 0.35, saturation: 0.68, temp: -0.04, fade: 0.05, shadow: [0.18, 0.32, 0.36], shadowAmt: 0.55, high: [0.98, 0.9, 0.78], highAmt: 0.2, vignette: 0.38, grain: 0.03 },
  teal_orange: { contrast: 1.1, curve: 0.3, saturation: 1.12, shadow: [0.0, 0.48, 0.56], shadowAmt: 0.85, high: [1, 0.62, 0.3], highAmt: 0.65, vignette: 0.2 },
  cool_steel: { temp: -0.38, tint: -0.02, contrast: 1.1, curve: 0.25, saturation: 0.72, fade: 0.03, shadow: [0.25, 0.35, 0.5], shadowAmt: 0.45, high: [0.85, 0.93, 1], highAmt: 0.35, vignette: 0.2 },
  moody_teal: { exposure: -0.22, contrast: 1.12, curve: 0.4, saturation: 0.7, fade: 0.04, shadow: [0.0, 0.36, 0.38], shadowAmt: 0.85, high: [0.86, 0.96, 0.9], highAmt: 0.2, vignette: 0.55, grain: 0.025 },
  matte_fade: { contrast: 0.9, saturation: 0.84, fade: 0.15, shadow: [0.3, 0.26, 0.4], shadowAmt: 0.35, high: [1, 0.95, 0.88], highAmt: 0.15, grain: 0.02 },
  golden_hour: { exposure: 0.08, temp: 0.55, tint: 0.07, contrast: 1.04, curve: 0.2, saturation: 1.16, glow: 0.3, high: [1, 0.72, 0.36], highAmt: 0.55, shadow: [0.45, 0.28, 0.2], shadowAmt: 0.3, vignette: 0.28 },
  bright_airy: { exposure: 0.32, contrast: 0.86, saturation: 0.9, temp: -0.06, tint: 0.02, fade: 0.06, high: [0.96, 0.98, 1], highAmt: 0.2, glow: 0.1 },
  soft_glow: { exposure: 0.06, contrast: 0.95, saturation: 1.02, glow: 0.6, smooth: 0.3, high: [1, 0.88, 0.92], highAmt: 0.3, temp: 0.06, vignette: 0.12 },
  faded_film: { contrast: 0.94, curve: 0.15, saturation: 0.72, temp: 0.14, fade: 0.12, shadow: [0.22, 0.32, 0.38], shadowAmt: 0.5, high: [1, 0.94, 0.78], highAmt: 0.35, vignette: 0.25, grain: 0.06 },
}

const VERT = `
attribute vec2 a_pos;
uniform vec4 u_crop;
uniform float u_mirror;
varying vec2 v_uv;
void main() {
  vec2 t = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  if (u_mirror > 0.5) t.x = 1.0 - t.x;
  v_uv = u_crop.xy + t * u_crop.zw;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform vec2 u_res;
uniform float u_exposure, u_contrast, u_curve, u_saturation, u_temp, u_tint, u_fade;
uniform vec3 u_shadow, u_high;
uniform float u_shadowAmt, u_highAmt, u_vignette, u_grain, u_glow, u_smooth, u_seed;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec3 c = texture2D(u_tex, v_uv).rgb;
  if (u_glow > 0.0 || u_smooth > 0.0) {
    vec3 b = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5235988;
      vec2 o = vec2(cos(a), sin(a)) * u_texel;
      b += texture2D(u_tex, v_uv + o).rgb + texture2D(u_tex, v_uv + o * 0.45).rgb;
    }
    b /= 24.0;
    float d = length(c - b);
    c = mix(c, b, u_smooth * (1.0 - smoothstep(0.03, 0.16, d)));
    vec3 g = max(b - 0.42, 0.0) * 1.7;
    c = 1.0 - (1.0 - c) * (1.0 - g * u_glow);
  }
  c *= exp2(u_exposure);
  c += vec3(u_temp * 0.09, u_tint * 0.05, -u_temp * 0.09);
  c = clamp((c - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  c = mix(c, c * c * (3.0 - 2.0 * c), u_curve);
  float l = luma(c);
  c = mix(vec3(l), c, u_saturation);
  float sh = 1.0 - smoothstep(0.0, 0.6, l);
  float hi = smoothstep(0.4, 1.0, l);
  c += (u_shadow - vec3(luma(u_shadow))) * u_shadowAmt * sh * 0.5;
  c += (u_high - vec3(luma(u_high))) * u_highAmt * hi * 0.5;
  c = mix(vec3(u_fade), vec3(1.0 - u_fade * 0.25), clamp(c, 0.0, 1.0));
  vec2 p = gl_FragCoord.xy / u_res - 0.5;
  p.x *= u_res.x / u_res.y;
  c *= 1.0 - u_vignette * smoothstep(0.28, 0.95, length(p));
  c += (hash(gl_FragCoord.xy + u_seed) - 0.5) * u_grain;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

function compile(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader')
  return s
}

export function sourceSize(src) {
  return {
    w: src.videoWidth || src.naturalWidth || src.width,
    h: src.videoHeight || src.naturalHeight || src.height,
  }
}

/** Largest centred crop of a w×h source with the given width/height ratio, in 0–1 units. */
export function centerCrop(w, h, ratio) {
  if (w / h > ratio) {
    const cw = (h * ratio) / w
    return { x: (1 - cw) / 2, y: 0, w: cw, h: 1 }
  }
  const ch = w / ratio / h
  return { x: 0, y: (1 - ch) / 2, w: 1, h: ch }
}

export class FilterGL {
  constructor({ canvas = document.createElement('canvas'), preserve = false } = {}) {
    this.canvas = canvas
    const opts = { preserveDrawingBuffer: preserve, premultipliedAlpha: false, antialias: false, alpha: false }
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts)
    if (!gl) throw new Error('WebGL tidak tersedia')
    this.gl = gl
    const prog = gl.createProgram()
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link')
    gl.useProgram(prog)
    this.prog = prog
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    this.tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) {
      gl.texParameteri(gl.TEXTURE_2D, k, v)
    }
    this.u = {}
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS)
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(prog, i).name
      this.u[name] = gl.getUniformLocation(prog, name)
    }
    this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
  }

  /** Render `source` (video, image or canvas) through `filter` into this.canvas. */
  draw(source, { filter = 'none', crop, mirror = false, width, height, seed = 0 } = {}) {
    const { gl, u, canvas } = this
    const { w: sw, h: sh } = sourceSize(source)
    if (!sw || !sh) return false
    crop = crop || { x: 0, y: 0, w: 1, h: 1 }
    width = Math.round(width || sw * crop.w)
    height = Math.round(height || sh * crop.h)
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    gl.viewport(0, 0, width, height)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source)
    const p = { ...base, ...(PRESETS[filter] || {}) }
    const r = Math.max(2, Math.max(width, height) * 0.007)
    gl.uniform4f(u.u_crop, crop.x, crop.y, crop.w, crop.h)
    gl.uniform1f(u.u_mirror, mirror ? 1 : 0)
    gl.uniform2f(u.u_texel, (r * crop.w) / width, (r * crop.h) / height)
    gl.uniform2f(u.u_res, width, height)
    for (const k of ['exposure', 'contrast', 'curve', 'saturation', 'temp', 'tint', 'fade', 'shadowAmt', 'highAmt', 'vignette', 'grain', 'glow', 'smooth']) {
      gl.uniform1f(u[`u_${k}`], p[k])
    }
    gl.uniform3fv(u.u_shadow, p.shadow)
    gl.uniform3fv(u.u_high, p.high)
    gl.uniform1f(u.u_seed, seed)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    return true
  }
}

// ---------------------------------------------------------------- CPU fallback
// Same maths as the shader, per pixel in JS. Used when WebGL is missing or fails the
// self-test below, so a broken GPU driver degrades to slower filters instead of black photos.

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

function hash(x, y) {
  let px = (x * 123.34) % 1
  let py = (y * 456.21) % 1
  const d = px * (px + 45.32) + py * (py + 45.32)
  px += d
  py += d
  return (px * py) % 1
}

export function applyPixels(data, w, h, filter, blur, seed = 0) {
  const p = { ...base, ...(PRESETS[filter] || {}) }
  if (filter === 'none' || !PRESETS[filter]) return
  const ex = 2 ** p.exposure
  const sl = luma(...p.shadow)
  const hl = luma(...p.high)
  const sd = p.shadow.map((v) => (v - sl) * p.shadowAmt * 0.5)
  const hd = p.high.map((v) => (v - hl) * p.highAmt * 0.5)
  const aspect = w / h
  const top = 1 - p.fade * 0.25
  for (let y = 0; y < h; y++) {
    const vy = (h - y - 0.5) / h - 0.5
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let r = data[i] / 255
      let g = data[i + 1] / 255
      let b = data[i + 2] / 255
      if (blur) {
        const br = blur[i] / 255
        const bg = blur[i + 1] / 255
        const bb = blur[i + 2] / 255
        const d = Math.hypot(r - br, g - bg, b - bb)
        const k = p.smooth * (1 - smooth(0.03, 0.16, d))
        r += (br - r) * k
        g += (bg - g) * k
        b += (bb - b) * k
        r = 1 - (1 - r) * (1 - Math.max(br - 0.42, 0) * 1.7 * p.glow)
        g = 1 - (1 - g) * (1 - Math.max(bg - 0.42, 0) * 1.7 * p.glow)
        b = 1 - (1 - b) * (1 - Math.max(bb - 0.42, 0) * 1.7 * p.glow)
      }
      r = r * ex + p.temp * 0.09
      g = g * ex + p.tint * 0.05
      b = b * ex - p.temp * 0.09
      r = clamp01((r - 0.5) * p.contrast + 0.5)
      g = clamp01((g - 0.5) * p.contrast + 0.5)
      b = clamp01((b - 0.5) * p.contrast + 0.5)
      r += (r * r * (3 - 2 * r) - r) * p.curve
      g += (g * g * (3 - 2 * g) - g) * p.curve
      b += (b * b * (3 - 2 * b) - b) * p.curve
      const l = luma(r, g, b)
      r = l + (r - l) * p.saturation
      g = l + (g - l) * p.saturation
      b = l + (b - l) * p.saturation
      const sh = 1 - smooth(0, 0.6, l)
      const hi = smooth(0.4, 1, l)
      r = p.fade + (top - p.fade) * clamp01(r + sd[0] * sh + hd[0] * hi)
      g = p.fade + (top - p.fade) * clamp01(g + sd[1] * sh + hd[1] * hi)
      b = p.fade + (top - p.fade) * clamp01(b + sd[2] * sh + hd[2] * hi)
      let m = 1
      if (p.vignette) {
        const vx = ((x + 0.5) / w - 0.5) * aspect
        m = 1 - p.vignette * smooth(0.28, 0.95, Math.sqrt(vx * vx + vy * vy))
      }
      const n = p.grain ? (hash(x + 0.5 + seed, h - y - 0.5 + seed) - 0.5) * p.grain : 0
      data[i] = (r * m + n) * 255
      data[i + 1] = (g * m + n) * 255
      data[i + 2] = (b * m + n) * 255
    }
  }
}

export class FilterCPU {
  constructor({ canvas = document.createElement('canvas') } = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })
    this.kind = 'cpu'
  }

  draw(source, { filter = 'none', crop, mirror = false, width, height, seed = 0 } = {}) {
    const { w: sw, h: sh } = sourceSize(source)
    if (!sw || !sh) return false
    crop = crop || { x: 0, y: 0, w: 1, h: 1 }
    width = Math.round(width || sw * crop.w)
    height = Math.round(height || sh * crop.h)
    const { canvas, ctx } = this
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    ctx.save()
    if (mirror) {
      ctx.translate(width, 0)
      ctx.scale(-1, 1)
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, crop.x * sw, crop.y * sh, crop.w * sw, crop.h * sh, 0, 0, width, height)
    ctx.restore()
    if (filter === 'none') return true
    const p = { ...base, ...(PRESETS[filter] || {}) }
    let blur = null
    if (p.glow || p.smooth) {
      const r = Math.max(2, Math.max(width, height) * 0.007)
      const small = document.createElement('canvas')
      small.width = Math.max(1, Math.round(width / r))
      small.height = Math.max(1, Math.round(height / r))
      small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height)
      const up = document.createElement('canvas')
      up.width = width
      up.height = height
      const uctx = up.getContext('2d', { willReadFrequently: true })
      uctx.imageSmoothingQuality = 'high'
      uctx.drawImage(small, 0, 0, width, height)
      blur = uctx.getImageData(0, 0, width, height).data
    }
    const img = ctx.getImageData(0, 0, width, height)
    applyPixels(img.data, width, height, filter, blur, seed)
    ctx.putImageData(img, 0, 0)
    return true
  }
}

/** Does this WebGL renderer draw correctly? Checks colour and orientation on a 1×2 image. */
function selfTest(r) {
  try {
    const src = document.createElement('canvas')
    src.width = 1
    src.height = 2
    const c = src.getContext('2d')
    c.fillStyle = 'rgb(200,60,30)'
    c.fillRect(0, 0, 1, 1)
    c.fillStyle = 'rgb(20,90,210)'
    c.fillRect(0, 1, 1, 1)
    r.draw(src, { filter: 'none', width: 1, height: 2 })
    const gl = r.gl
    const px = new Uint8Array(8)
    gl.readPixels(0, 0, 1, 2, gl.RGBA, gl.UNSIGNED_BYTE, px)
    const near = (a, b) => Math.abs(a - b) < 12
    // readPixels starts at the bottom row: blue first, then red.
    return near(px[0], 20) && near(px[1], 90) && near(px[2], 210) && near(px[4], 200) && near(px[5], 60) && near(px[6], 30)
  } catch {
    return false
  }
}

let glWorks = null
/** WebGL when it renders correctly on this device, otherwise the CPU renderer. */
export function createRenderer({ canvas, preserve = false } = {}) {
  if (glWorks !== false) {
    try {
      if (glWorks === null) glWorks = selfTest(new FilterGL({ preserve: true }))
      if (glWorks) {
        const r = new FilterGL({ canvas, preserve })
        r.kind = 'webgl'
        return r
      }
    } catch {
      glWorks = false
    }
  }
  return new FilterCPU({ canvas })
}

let shared = null
/** One preserved-buffer renderer reused for stills (captures, thumbnails). */
export function stillRenderer() {
  if (!shared) shared = createRenderer({ preserve: true })
  return shared
}

/** Copy the renderer's current pixels into a fresh 2D canvas. */
export function snapshot(r) {
  const out = document.createElement('canvas')
  out.width = r.canvas.width
  out.height = r.canvas.height
  out.getContext('2d').drawImage(r.canvas, 0, 0)
  return out
}

/** Filter thumbnails as data URLs, rendered from one source frame. */
export function renderThumbs(source, ids, { ratio = 3 / 4, size = 160, mirror = false } = {}) {
  const r = stillRenderer()
  const { w, h } = sourceSize(source)
  const crop = centerCrop(w, h, ratio)
  const out = {}
  for (const id of ids) {
    r.draw(source, { filter: id, crop, mirror, width: Math.round(size * ratio), height: size, seed: 1 })
    out[id] = r.canvas.toDataURL('image/jpeg', 0.8)
  }
  return out
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Gambar gagal dimuat'))
    img.src = src
  })
}
