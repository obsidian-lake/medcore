/**
 * PDF link annotations for rasterized slide exports.
 *
 * Verbatim transplant from medplanner app/src/export/medPackage.ts. MedSlide.tsx
 * tags each facility address with data-maps-url and each facility phone with
 * data-tel-url (the DOM anchor a real <a> can't be, since the slide is
 * rasterized via html2canvas); this walks the live DOM before rasterization
 * and converts those markers into PDF-coordinate rectangles a caller can pass
 * straight to jsPDF's pdf.link().
 */

const LINK_ATTRS = ['data-maps-url', 'data-tel-url']

export interface LinkAnnotation {
  x: number
  y: number
  w: number
  h: number
  url: string
}

/** Measure elements tagged with data-maps-url or data-tel-url and return PDF-coordinate link annotations. */
export function collectLinkAnnotations(
  slideEl: HTMLElement,
  pageW: number,
  pageH: number,
): LinkAnnotation[] {
  const sr = slideEl.getBoundingClientRect()
  if (sr.width === 0 || sr.height === 0) return []
  const anns: LinkAnnotation[] = []
  const selector = LINK_ATTRS.map(a => `[${a}]`).join(', ')
  slideEl.querySelectorAll<HTMLElement>(selector).forEach(el => {
    const url = LINK_ATTRS.map(a => el.getAttribute(a)).find(Boolean)
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
