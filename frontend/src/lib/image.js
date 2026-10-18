// Decode a user-picked file into a canvas-friendly image, downscaled so phones don't upload
// 12 MP originals and WebGL stays under its texture limit.

export async function decodeFile(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Foto tidak dapat dibaca'))
      img.src = url
    })
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export function downscale(img, longest) {
  const w = img.width || img.naturalWidth
  const h = img.height || img.naturalHeight
  const s = Math.min(1, longest / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.round(w * s)
  c.height = Math.round(h * s)
  const ctx = c.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return c
}

export async function shrinkFile(file, longest = 1800, quality = 0.88) {
  const img = await decodeFile(file)
  const c = downscale(img, longest)
  return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal memproses foto'))), 'image/jpeg', quality))
}
