/**
 * Unit tests for collectLinkAnnotations.
 *
 * Tests:
 *  - Converts a [data-maps-url] element's DOM rect into page-coordinate fractions
 *  - Skips elements without a data-maps-url attribute
 *  - Returns [] when the slide element has zero size (not yet laid out)
 */
import { describe, expect, it } from 'vitest'
import { collectLinkAnnotations } from './pdfLinkAnnotations'

function mockRect(el: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () => ({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON() { return this },
  })
}

describe('collectLinkAnnotations', () => {
  it('scales a tagged element rect into page-coordinate fractions', () => {
    const slide = document.createElement('div')
    mockRect(slide, { left: 0, top: 0, width: 1280, height: 720 })

    const addr = document.createElement('div')
    addr.setAttribute('data-maps-url', 'https://maps.example/?q=1,2')
    mockRect(addr, { left: 640, top: 360, width: 128, height: 36 })
    slide.appendChild(addr)

    const anns = collectLinkAnnotations(slide, 297, 167.0625)
    expect(anns).toEqual([{
      x: (640 / 1280) * 297,
      y: (360 / 720) * 167.0625,
      w: (128 / 1280) * 297,
      h: (36 / 720) * 167.0625,
      url: 'https://maps.example/?q=1,2',
    }])
  })

  it('ignores elements with no data-maps-url value and untagged elements', () => {
    const slide = document.createElement('div')
    mockRect(slide, { left: 0, top: 0, width: 1280, height: 720 })

    const empty = document.createElement('div')
    empty.setAttribute('data-maps-url', '')
    slide.appendChild(empty)

    const plain = document.createElement('div')
    slide.appendChild(plain)

    expect(collectLinkAnnotations(slide, 297, 167)).toEqual([])
  })

  it('returns [] for a zero-size (unlaid-out) slide element', () => {
    const slide = document.createElement('div')
    mockRect(slide, { left: 0, top: 0, width: 0, height: 0 })
    document.body.appendChild(slide)

    expect(collectLinkAnnotations(slide, 297, 167)).toEqual([])
  })
})
