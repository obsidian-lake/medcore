/**
 * PDF link annotations for rasterized slide exports.
 *
 * Verbatim transplant from medplanner app/src/export/medPackage.ts. MedSlide.tsx
 * tags each facility address with data-maps-url (the DOM anchor a real <a> can't
 * be, since the slide is rasterized via html2canvas); this walks the live DOM
 * before rasterization and converts those markers into PDF-coordinate rectangles
 * a caller can pass straight to jsPDF's pdf.link().
 */

export interface LinkAnnotation {
  x: number
  y: number
  w: number
  h: number
  url: string
}

/** Measure elements tagged with data-maps-url and return PDF-coordinate link annotations. */
export function collectLinkAnnotations(
  slideEl: HTMLElement,
  pageW: number,
  pageH: number,
): LinkAnnotation[] {
  const sr = slideEl.getBoundingClientRect()
  if (sr.width === 0 || sr.height === 0) return []
  const anns: LinkAnnotation[] = []
  slideEl.querySelectorAll<HTMLElement>('[data-maps-url]').forEach(el => {
    const url = el.getAttribute('data-maps-url')
    if (!url) return
    const r = el.getBoundingClientRect()
    anns.push({
      x: ((r.left - sr.left) / sr.width)  * pageW,
      y: ((r.top  - sr.top)  / sr.height) * pageH,
      w: (r.width  / sr.width)  * pageW,
      h: (r.height / sr.height) * pageH,
      url,
    })
  })
  return anns
}
