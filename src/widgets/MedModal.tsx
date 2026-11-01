/**
 * MedModal — shared pop-up shell for medcore widgets (Ranking info/settings,
 * and any future pop-up). Mirrors the inline overlay/panel idiom already
 * used by MedPacePreview's treatment-edit modal, factored out so every
 * pop-up looks and behaves identically: themed overlay + panel, a titled
 * header with a ✕ close button, closes on backdrop click or Escape, and an
 * optional footer row for action buttons.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  maxWidth?: number
}

export function MedModal({ title, onClose, children, footer, maxWidth = 560 }: Props) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6,
        maxWidth, width: '100%', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)',
        }}>
          <span className="section-header" style={{ padding: 0, background: 'none', border: 'none' }}>
            {title}
          </span>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close" style={{ padding: '2px 7px', lineHeight: 1 }}>
            ✕
          </button>
        </div>

        <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
          {children}
        </div>

        {footer && (
          <div style={{
            padding: '10px 14px', borderTop: '1px solid var(--border)',
            display: 'flex', gap: 8, justifyContent: 'flex-end',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
