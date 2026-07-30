// ── Slide dimensions — shared by all templates ────────────────────────────────

export const SLIDE_W = 1280
export const SLIDE_H  = 720

// ── Chrome heights — all fixed px; never use % or flex:1 in capture targets ──

export const CLASS_BAR_H  = 22   // classification stripe (each edge)
export const HEADER_H_THIN  = 41   // field-green header
export const HEADER_H_THICK = 56   // mission-planning header
export const FOOTER_H     = 34   // footer bar
export const SLIDE_PAD_H  = 20   // content vertical padding (top and bottom each)
export const SLIDE_PAD_V  = 36   // content horizontal padding (left and right each)

// ── Theme types ───────────────────────────────────────────────────────────────

export type SlideThemeId = 'field-green' | 'mission-planning'
export type HeaderStyle  = 'thin' | 'thick'

export interface SlideTheme {
  id:           SlideThemeId
  headerStyle:  HeaderStyle
  bg:           string   // slide body background
  headerBg:     string   // header bar background
  headerText:   string   // header center title color
  headerLabel:  string   // header left/right label text color
  headerBorder: string   // header bottom separator
  border:       string   // internal rule color
  accent:       string   // primary content accent
  accent2:      string   // secondary content accent
  label:        string   // de-emphasised label text
  dim:          string   // very dim text
  warn:         string   // warning colour
  danger:       string   // danger/error colour
  mono:         string   // monospace font stack
}

// ── Theme definitions ─────────────────────────────────────────────────────────

export const SLIDE_THEMES: Record<SlideThemeId, SlideTheme> = {
  'field-green': {
    id:           'field-green',
    headerStyle:  'thin',
    bg:           '#0d1a0d',
    headerBg:     '#0d1a0d',
    headerText:   '#4caf50',
    headerLabel:  '#6a9a6a',
    headerBorder: '#2e4a2e',
    border:       '#2e4a2e',
    accent:       '#4caf50',
    accent2:      '#80deea',
    label:        '#6a9a6a',
    dim:          '#8a9a8a',
    warn:         '#d4a017',
    danger:       '#ef5350',
    mono:         "'Courier New', 'Consolas', monospace",
  },

  'mission-planning': {
    id:           'mission-planning',
    headerStyle:  'thick',
    bg:           '#111111',
    headerBg:     '#000000',
    headerText:   '#ffffff',
    headerLabel:  '#aaaaaa',
    headerBorder: '#000000',
    border:       '#333333',
    accent:       '#ffffff',
    accent2:      '#cccccc',
    label:        '#888888',
    dim:          '#555555',
    warn:         '#d4a017',
    danger:       '#ef5350',
    mono:         "'Courier New', 'Consolas', monospace",
  },
}
