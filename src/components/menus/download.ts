/**
 * Download + file-reading helpers shared by the menu components.
 *
 * downloadHref also works in Firefox (the anchor must be in the DOM when
 * clicked) and keeps the object URL alive until the download starts
 * instead of revoking it synchronously. readFileAsDataURL produces an
 * embeddable payload, unlike object URLs.
 */
export function downloadHref(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (href.startsWith('blob:')) {
    setTimeout(() => URL.revokeObjectURL(href), 4000)
  }
}

/** Read a file as a data URL (embeddable, unlike object URLs). */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
