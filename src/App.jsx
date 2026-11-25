import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Check,
  Clipboard,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  FileUp,
  Flag,
  Gauge,
  Link2,
  LockKeyhole,
  Moon,
  PaintBucket,
  Plus,
  RotateCcw,
  Share2,
  Sparkles,
  Sun,
  Users,
  X
} from 'lucide-react'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 12 }, (_, i) => i + 8)
const COLORS = ['#00D26A', '#38BDF8', '#A78BFA', '#F59E0B', '#F472B6', '#22D3EE', '#FB7185']
const KEY = 'pitwall-sync-state-v1'
const THEME_KEY = 'pitwall-sync-theme'

const toMin = t => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

async function readTimetableWithAI(file, branchLabel) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (!isPdf && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Use a PDF, PNG, JPG or WEBP timetable.')
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('File is too large (max 20 MB).')
  }
  let blob = file
  if (isPdf) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 2.2 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) throw new Error('Could not convert the PDF page to an image.')
  }
  const media = blob.type || 'image/jpeg'
  const data = await new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1])
    r.onerror = () => rej(new Error('Could not read the file.'))
    r.readAsDataURL(blob)
  })
  const response = await fetch('/api/ai/read-timetable', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ branchLabel, fileName: file.name, mediaType: media, data })
  })
  const out = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(out.error || `AI request failed (${response.status}).`)
  const parsed = out.result
  if (!parsed || !Array.isArray(parsed.classes)) {
    throw new Error('AI reply was not readable. Try again.')
  }
  const classes = parsed.classes
    .map(c => ({
      day: Number(c.day),
      s: toMin(c.start),
      e: toMin(c.end),
      subject: String(c.subject || 'Class').slice(0, 40),
      guessed: !!c.guessed
    }))
    .filter(
      c =>
        Number.isInteger(c.day) &&
        c.day >= 0 &&
        c.day < 6 &&
        c.s !== null &&
        c.e !== null &&
        c.e > c.s
    )
  if (!classes.length) throw new Error('No classes found. Try a clearer file or another branch.')
  return { classes, notes: String(parsed.notes || '').slice(0, 200) }
}

const classSlots = classes => {
  const set = new Set()
  for (const c of classes) {
    for (let h = 8; h < 20; h++) {
      if (Math.min(c.e, (h + 1) * 60) - Math.max(c.s, h * 60) >= 20) {
        set.add(`${c.day}-${h}`)
      }
    }
  }
  return [...set]
}

const emptyState = () => ({ squad: 'HBTU // SQUAD ALPHA', drivers: [], locked: null })
const slotKey = (day, hour) => `${day}-${hour}`
const safeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

const HBTU_BRANCHES = [
  { value: 'CE', label: 'Civil Engineering (CE)' },
  { value: 'ME', label: 'Mechanical Engineering (ME)' },
  { value: 'EE', label: 'Electrical Engineering (EE)' },
  { value: 'ET', label: 'Electronics & Communication (ET)' },
  { value: 'CS', label: 'Computer Science (CS)' },
  { value: 'AI&ML', label: 'Artificial Intelligence & ML' },
  { value: 'IT', label: 'Information Technology (IT)' },
  { value: 'BS-MS', label: 'BS-MS Mathematics & Data Science' },
  { value: 'FT', label: 'Food Technology (FT)' },
  { value: 'PL', label: 'Plastic Technology (PL)' },
  { value: 'BE+LT', label: 'Bioinformatics / Leather Technology (BE + LT)' },
  { value: 'BIOTECH', label: 'Biotechnology' },
  { value: 'OT', label: 'Oil Technology (OT)' },
  { value: 'PT', label: 'Paint Technology (PT)' },
  { value: 'CH', label: 'Chemical Engineering (CH)' }
]

const BRANCH_CENTERS = [
  72.6, 112.1, 150.1, 185.2, 221.3, 256.6, 289.0, 322.7, 358.5, 390.0, 417.4, 449.8, 483.1, 511.7,
  541.7
]
const PERIOD_HOURS = [10, 11, 11, 12, 14, 15, 16]

async function readBranchTimetable(file, branch) {
  if (!file || (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))) {
    throw new Error('Please choose the official timetable PDF file.')
  }
  const bytes = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const items = content.items.filter(item => item.str && item.str.trim())
  const timeRows = items
    .map(item => {
      const match = item.str.match(/\(?\s*(10:00|10:50|11:40|12:30|14:20|15:10|16:00)\s*-/)
      return match && item.transform[4] < 55
        ? { y: viewport.height - item.transform[5], time: match[1] }
        : null
    })
    .filter(Boolean)
    .sort((a, b) => a.y - b.y)

  if (timeRows.length < 42) {
    throw new Error(
      'Could not read all six day rows in this PDF. Use the official searchable HBTU timetable PDF.'
    )
  }

  const rows = timeRows
    .slice(0, 42)
    .map((row, index) => ({ day: Math.floor(index / 7), period: index % 7, y: row.y }))
  const branchIndex = HBTU_BRANCHES.findIndex(b => b.value === branch)
  const left =
    branchIndex === 0 ? 52 : (BRANCH_CENTERS[branchIndex - 1] + BRANCH_CENTERS[branchIndex]) / 2
  const right =
    branchIndex === BRANCH_CENTERS.length - 1
      ? 562
      : (BRANCH_CENTERS[branchIndex] + BRANCH_CENTERS[branchIndex + 1]) / 2

  const busy = new Set()
  for (const item of items) {
    const x = item.transform[4] + (item.width || 0) / 2
    const y = viewport.height - item.transform[5]
    if (x < left || x >= right || y < 55 || y > 450) continue
    const nearest = rows.reduce(
      (best, row) => (Math.abs(row.y - y) < Math.abs(best.y - y) ? row : best),
      rows[0]
    )
    if (Math.abs(nearest.y - y) > 5.8) continue
    busy.add(`${nearest.day}-${PERIOD_HOURS[nearest.period]}`)
  }

  if (!busy.size) {
    throw new Error(
      'No classes were detected in that branch column. Check the selected branch or PDF.'
    )
  }
  return [...busy]
}

function encodeState(state) {
  try {
    return btoa(encodeURIComponent(JSON.stringify(state)))
  } catch {
    return ''
  }
}

function decodeState(value) {
  try {
    return cleanState(JSON.parse(decodeURIComponent(atob(value))))
  } catch {
    return null
  }
}

function cleanState(parsed) {
  try {
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.drivers)) return null
    const drivers = parsed.drivers
      .filter(d => d && typeof d.id === 'string' && typeof d.name === 'string')
      .map((d, i) => ({
        id: d.id,
        name: d.name.slice(0, 36) || `Driver ${i + 1}`,
        color: COLORS.includes(d.color) ? d.color : COLORS[i % COLORS.length],
        busy: Array.isArray(d.busy)
          ? [
              ...new Set(
                d.busy.filter(k => {
                  if (typeof k !== 'string') return false
                  const match = /^(\d+)-(\d+)$/.exec(k)
                  if (!match) return false
                  const day = Number(match[1])
                  const hour = Number(match[2])
                  return day >= 0 && day < 6 && hour >= 8 && hour < 20
                })
              )
            ]
          : [],
        active: d.active !== false
      }))
    const locked =
      parsed.locked &&
      Number.isInteger(parsed.locked.day) &&
      Number.isInteger(parsed.locked.hour) &&
      parsed.locked.day >= 0 &&
      parsed.locked.day < 6 &&
      parsed.locked.hour >= 8 &&
      parsed.locked.hour < 20 &&
      Number.isInteger(parsed.locked.duration) &&
      parsed.locked.duration > 0 &&
      parsed.locked.duration <= 12 &&
      parsed.locked.hour + parsed.locked.duration <= 20
        ? { day: parsed.locked.day, hour: parsed.locked.hour, duration: parsed.locked.duration }
        : null
    return {
      squad: typeof parsed.squad === 'string' ? parsed.squad.slice(0, 48) : 'HBTU // SQUAD',
      drivers,
      locked
    }
  } catch {
    return null
  }
}

function hourLabel(h) {
  return `${String(h).padStart(2, '0')}:00`
}
function endLabel(h) {
  return `${String(h).padStart(2, '0')}:00`
}
function prettyDay(d) {
  return DAYS[d] || '—'
}
function formatWindow(w) {
  return `${prettyDay(w.day)} ${hourLabel(w.start)} – ${endLabel(w.end)}`
}

function makeSample() {
  const specs = [
    ['Pranjal', COLORS[0], [[0, 9, 11], [0, 14, 16], [1, 10, 12], [2, 9, 12], [3, 11, 13], [4, 14, 17]]],
    ['Aarav', COLORS[1], [[0, 10, 12], [1, 9, 11], [1, 14, 16], [2, 11, 13], [3, 9, 11], [4, 10, 12]]],
    ['Diya', COLORS[2], [[0, 13, 15], [1, 10, 13], [2, 14, 16], [3, 10, 12], [4, 9, 11], [5, 10, 12]]],
    ['Kabir', COLORS[3], [[0, 11, 13], [1, 12, 14], [2, 10, 12], [3, 15, 17], [4, 12, 14], [5, 9, 11]]]
  ]
  return {
    squad: 'HBTU // AERO SQUAD',
    drivers: specs.map(([name, color, blocks]) => ({
      id: safeId(),
      name,
      color,
      active: true,
      busy: blocks.flatMap(([d, start, end]) =>
        Array.from({ length: end - start }, (_, i) => slotKey(d, start + i))
      )
    })),
    locked: null
  }
}

function getWindows(drivers) {
  const active = drivers.filter(d => d.active)
  if (!active.length) return []
  const result = []
  for (let day = 0; day < 6; day++) {
    let start = null
    for (let hour = 8; hour <= 20; hour++) {
      const clear = hour < 20 && active.every(d => !d.busy.includes(slotKey(day, hour)))
      if (clear && start === null) start = hour
      if ((!clear || hour === 20) && start !== null) {
        result.push({ day, start, end: hour, duration: hour - start })
        start = null
      }
    }
  }
  return result.sort(
    (a, b) =>
      b.duration - a.duration ||
      Math.abs((a.start + a.end) / 2 - 14) - Math.abs((b.start + b.end) / 2 - 14) ||
      a.day - b.day ||
      a.start - b.start
  )
}

function downloadICS(state) {
  const w = state.locked
  if (!w) return
  const date = new Date()
  const monday = new Date(date)
  const day = (date.getDay() + 6) % 7
  monday.setDate(date.getDate() - day + w.day + 7)
  monday.setHours(w.start, 0, 0, 0)
  const end = new Date(monday.getTime() + w.duration * 3600000)
  const stamp = d =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
      d.getDate()
    ).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(
      d.getMinutes()
    ).padStart(2, '0')}00`
  const escape = s =>
    String(s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n')
  const content = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PIT WALL SYNC//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${safeId()}@pitwall-sync`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(monday)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(`PIT WINDOW // ${state.squad}`)}`,
    `DESCRIPTION:${escape(
      `Locked team meeting\n${formatWindow(w)}\n${w.duration} hour(s)`
    )}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'pit-window.ics'
  a.click()
  URL.revokeObjectURL(url)
}

function TitleCircuitFrame() {
  const trackPath =
    'M 48,11 L 236,11 C 254,11 264,19 272,27 C 280,35 292,35 304,26 C 316,17 348,17 360,31 C 371,44 366,68 346,72 L 266,72 C 252,72 246,62 232,62 L 154,62 C 140,62 134,73 118,73 L 36,73 C 16,73 10,55 13,38 C 16,20 29,11 48,11 Z'

  return (
    <div className="circuit-title-shell" aria-label="PIT WALL // SYNC">
      <svg
        className="circuit-track-svg"
        viewBox="0 0 380 86"
        fill="none"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <filter id="f1-car-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Outer Kerb Hairline */}
        <path
          d={trackPath}
          stroke="var(--f1-red)"
          strokeOpacity="0.45"
          strokeWidth="9.5"
          strokeDasharray="6 6"
          strokeLinejoin="round"
        />

        {/* Tarmac Track Ribbon */}
        <path
          d={trackPath}
          stroke="var(--track-asphalt)"
          strokeWidth="7.5"
          strokeLinejoin="round"
        />

        {/* Inner Racing Centerline */}
        <path
          d={trackPath}
          stroke="var(--border-strong)"
          strokeWidth="1"
          strokeDasharray="3 4"
        />

        {/* DRS Activation Zone Accent */}
        <path
          d="M 62,11 L 196,11"
          stroke="var(--f1-green)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />

        {/* Checkered Start/Finish Gantry */}
        <g transform="translate(88, 6.5)">
          <rect x="0" y="0" width="2.2" height="4.5" fill="var(--text-main)" />
          <rect x="2.2" y="4.5" width="2.2" height="4.5" fill="var(--text-main)" />
          <rect x="4.4" y="0" width="2.2" height="4.5" fill="var(--text-main)" />
        </g>

        {/* Animated F1 Telemetry Car */}
        <g filter="url(#f1-car-glow)">
          <rect x="-5" y="-2.4" width="10" height="4.8" rx="2" fill="var(--f1-red)">
            <animateMotion dur="9s" repeatCount="indefinite" rotate="auto" path={trackPath} />
          </rect>
          <circle cx="2.5" cy="0" r="1.2" fill="#FFFFFF">
            <animateMotion dur="9s" repeatCount="indefinite" rotate="auto" path={trackPath} />
          </circle>
        </g>
      </svg>

      <div className="circuit-title-inner">
        <div className="brand-mark">
          <Flag size={16} />
        </div>
        <div className="circuit-title-copy">
          <div className="brand-title">
            PIT WALL <span>//</span> SYNC
          </div>
          <div className="brand-sub">TEAM SCHEDULE · HBTU KANPUR</div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [state, setState] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has('telemetry')) {
      const shared = decodeState(params.get('telemetry'))
      if (shared) return shared
    }
    try {
      const saved = localStorage.getItem(KEY)
      if (saved) {
        const ok = cleanState(JSON.parse(saved))
        if (ok) return ok
      }
    } catch {}
    return emptyState()
  })

  const [mode, setMode] = useState('edit')
  const [selected, setSelected] = useState('')
  const [filter, setFilter] = useState(0)
  const [addName, setAddName] = useState('')
  const [paintBusy, setPaintBusy] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [paintValue, setPaintValue] = useState(true)
  const [hover, setHover] = useState(null)
  const [toast, setToast] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [importBranch, setImportBranch] = useState('BS-MS')
  const [importName, setImportName] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [aiStatus, setAiStatus] = useState({ configured: null, model: 'gpt-4o-mini' })
  const importInput = useRef(null)
  const gridRef = useRef(null)
  const toastTimer = useRef(null)
  const lastTouch = useRef(0)
  const undoRef = useRef(null)
  const [undoable, setUndoable] = useState(false)
  const [aiMode, setAiMode] = useState(true)
  const [importError, setImportError] = useState('')
  const [aiResult, setAiResult] = useState(null)
  const [theme, setTheme] = useState(() => {
    try {
      const t = localStorage.getItem(THEME_KEY)
      if (t === 'light' || t === 'dark') return t
    } catch {}
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })

  const activeDrivers = state.drivers.filter(d => d.active)
  const selectedDriver = state.drivers.find(d => d.id === selected) || state.drivers[0]
  const windows = useMemo(() => getWindows(state.drivers), [state.drivers])
  const filteredWindows = windows.filter(w => w.duration >= filter)

  useEffect(() => {
    fetch('/api/ai/status')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data && typeof data.configured === 'boolean') {
          setAiStatus({ configured: data.configured, model: data.model || 'gpt-4o-mini' })
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {}
  }, [state])

  useEffect(() => {
    const stop = () => setDragging(false)
    window.addEventListener('mouseup', stop)
    window.addEventListener('touchend', stop)
    return () => {
      window.removeEventListener('mouseup', stop)
      window.removeEventListener('touchend', stop)
    }
  }, [])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'light' ? '#F4F5F7' : '#090A0D')
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {}
  }, [theme])

  useEffect(() => {
    const k = e => {
      if (e.key === 'Escape') {
        setShowImport(false)
        setAiResult(null)
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const notify = (msg, canUndo = false) => {
    setToast(msg)
    setUndoable(canUndo)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), canUndo ? 6000 : 2600)
  }

  const undo = () => {
    if (undoRef.current) {
      setState(undoRef.current)
      undoRef.current = null
      setToast('')
    }
  }

  const updateDriver = (id, fn) =>
    setState(prev => ({ ...prev, drivers: prev.drivers.map(d => (d.id === id ? fn(d) : d)) }))

  const addDriver = () => {
    const name = addName.trim()
    if (!name) {
      notify('Enter a driver name first')
      return
    }
    if (state.drivers.some(d => d.name.toLowerCase() === name.toLowerCase())) {
      notify('Driver name already exists')
      return
    }
    const driver = {
      id: safeId(),
      name: name.slice(0, 36),
      color: COLORS[state.drivers.length % COLORS.length],
      busy: [],
      active: true
    }
    setState(p => ({ ...p, drivers: [...p.drivers, driver] }))
    setSelected(driver.id)
    setMode('edit')
    setAddName('')
    setShowAdd(false)
  }

  const paintCell = (day, hour, value) => {
    if (mode === 'edit' && !selectedDriver) {
      notify('Add or select a driver to edit')
      return
    }
    if (mode === 'edit') {
      updateDriver(selectedDriver.id, d => ({
        ...d,
        busy: value
          ? [...new Set([...d.busy, slotKey(day, hour)])]
          : d.busy.filter(k => k !== slotKey(day, hour))
      }))
    } else {
      const busy = activeDrivers.filter(d => d.busy.includes(slotKey(day, hour)))
      if (value) {
        const target = busy.length ? busy[0] : activeDrivers[0]
        if (target) {
          updateDriver(target.id, d => ({
            ...d,
            busy: [...new Set([...d.busy, slotKey(day, hour)])]
          }))
        }
      } else {
        busy.forEach(d =>
          updateDriver(d.id, x => ({ ...x, busy: x.busy.filter(k => k !== slotKey(day, hour)) }))
        )
      }
    }
  }

  const cellStatus = (day, hour) => {
    const busy = activeDrivers.filter(d => d.busy.includes(slotKey(day, hour)))
    return {
      busy,
      free: activeDrivers.filter(d => !d.busy.includes(slotKey(day, hour))),
      count: busy.length
    }
  }

  const startPaint = (day, hour) => {
    if (mode === 'edit' && !selectedDriver) {
      notify('Select a driver before painting')
      return
    }
    const value = paintBusy
    setPaintValue(value)
    setDragging(true)
    paintCell(day, hour, value)
  }

  const enterPaint = (day, hour) => {
    if (dragging) paintCell(day, hour, paintValue)
  }

  const lockWindow = w => {
    setState(p => ({ ...p, locked: { day: w.day, hour: w.start, duration: w.duration } }))
    notify('Pit window locked')
  }

  const lockCell = (day, hour) => {
    const status = cellStatus(day, hour)
    if (status.count === 0) lockWindow({ day, start: hour, duration: 1 })
    else notify('Only CLEAR TRACK hours can be locked')
  }

  const clearLock = () => setState(p => ({ ...p, locked: null }))

  const shareLink = async () => {
    const encoded = encodeState(state)
    const url = `${window.location.origin}${window.location.pathname}?telemetry=${encodeURIComponent(
      encoded
    )}`
    try {
      await navigator.clipboard.writeText(url)
      notify('Shareable pit-wall link copied')
    } catch {
      window.prompt('Copy your squad link:', url)
    }
  }

  const copyBrief = async () => {
    const w = state.locked
    const link = `${window.location.origin}${window.location.pathname}?telemetry=${encodeURIComponent(
      encodeState(state)
    )}`
    const message = w
      ? `🏁 PIT WALL // SYNC\n${state.squad}\n\n🔒 LOCKED PIT WINDOW\n${formatWindow(w)} • ${
          w.duration
        } HR${w.duration > 1 ? 'S' : ''}\n\nJoin the squad's clear track: ${link}`
      : `🏁 PIT WALL // SYNC\n${state.squad}\n\nFind our common free slots and lock a pit window: ${link}`
    try {
      await navigator.clipboard.writeText(message)
      notify('Invite brief copied')
    } catch {
      window.prompt('Copy invite brief:', message)
    }
  }

  const loadSample = () => {
    const sample = makeSample()
    setState(sample)
    setSelected(sample.drivers[0].id)
    setMode('edit')
    notify('Demo squad loaded — telemetry live')
  }

  const uniqueName = n => {
    let out = n
    let i = 2
    while (state.drivers.some(d => d.name.toLowerCase() === out.toLowerCase())) {
      out = `${n.slice(0, 32)} ${i++}`
    }
    return out
  }

  const finishImport = (busy, msg) => {
    const name = uniqueName((importName.trim() || `${importBranch} Student`).slice(0, 36))
    const driver = {
      id: safeId(),
      name,
      color: COLORS[state.drivers.length % COLORS.length],
      active: true,
      busy
    }
    undoRef.current = state
    setState(prev => ({ ...prev, drivers: [...prev.drivers, driver], locked: null }))
    setSelected(driver.id)
    setMode('edit')
    setShowImport(false)
    setAiResult(null)
    setImportName('')
    notify(`${name}: ${msg}`, true)
  }

  const importTimetable = async file => {
    if (!file) return
    setImportBusy(true)
    setImportError('')
    try {
      if (aiMode) {
        setAiResult(
          await readTimetableWithAI(
            file,
            HBTU_BRANCHES.find(b => b.value === importBranch)?.label || importBranch
          )
        )
        return
      }
      const busy = await readBranchTimetable(file, importBranch)
      finishImport(busy, `${busy.length} occupied periods imported`)
    } catch (error) {
      let m = error?.message || 'Could not import this timetable'
      if (/failed to fetch|networkerror|load failed/i.test(m)) {
        m = 'Could not reach the AI service. Check internet, VPN/ad-blocker, then try again.'
      }
      setImportError(m)
      notify(m)
    } finally {
      setImportBusy(false)
      if (importInput.current) importInput.current.value = ''
    }
  }

  const reset = () => {
    if (
      state.drivers.length &&
      !window.confirm('Reset the whole track? All drivers and schedules will be removed.')
    ) {
      return
    }
    undoRef.current = state
    setState(emptyState())
    setSelected('')
    setMode('edit')
    notify('Track reset', true)
  }

  const setBusyKeys = (keys, on, msg) => {
    if (!selectedDriver) {
      notify('Add or select a driver first')
      return
    }
    undoRef.current = state
    updateDriver(selectedDriver.id, d => ({
      ...d,
      busy: on
        ? [...new Set([...d.busy, ...keys])]
        : d.busy.filter(k => !keys.includes(k))
    }))
    notify(msg, true)
  }

  const everyKey = DAYS.flatMap((_, d) => HOURS.map(h => slotKey(d, h)))
  const clearSchedule = () => setBusyKeys(everyKey, false, `${selectedDriver?.name}: schedule cleared`)
  const busyAll = () => setBusyKeys(everyKey, true, `${selectedDriver?.name}: marked busy all week`)
  const toggleKeys = (keys, label) => {
    const all = selectedDriver && keys.every(k => selectedDriver.busy.includes(k))
    setBusyKeys(keys, !all, `${label} ${all ? 'cleared' : 'marked busy'}`)
  }
  const toggleDay = d => toggleKeys(HOURS.map(h => slotKey(d, h)), DAYS[d])
  const toggleHour = h => toggleKeys(DAYS.map((_, d) => slotKey(d, h)), hourLabel(h))

  const clearEveryone = () => {
    if (!state.drivers.length || !window.confirm("Clear every driver's schedule?")) return
    undoRef.current = state
    setState(p => ({
      ...p,
      drivers: p.drivers.map(d => ({ ...d, busy: [] })),
      locked: null
    }))
    notify('All schedules cleared', true)
  }

  const activeCount = activeDrivers.length
  const lockedValid =
    state.locked &&
    Array.from(
      { length: state.locked.duration },
      (_, i) => cellStatus(state.locked.day, state.locked.hour + i).count
    ).every(c => c === 0)

  return (
    <div className="app-shell" onMouseUp={() => setDragging(false)}>
      {/* Minimalistic F1 Telemetry Bar */}
      <div className="topline">
        <span className="topline-pill">
          <span className="live-dot" /> LIVE TELEMETRY
        </span>
        <span className="topline-center">
          HBTU KANPUR <b>·</b> PIT WALL SCHEDULE ENGINE
        </span>
        <span className="mono topline-right">
          {aiStatus.configured === true
            ? `AI READY · ${aiStatus.model.toUpperCase()}`
            : aiStatus.configured === false
            ? 'PDF PARSER · LOCAL'
            : 'BUILD 01.26'}
        </span>
      </div>

      {/* Header with Racing Circuit Framing the Title */}
      <header className="header">
        <TitleCircuitFrame />

        <div className="squad-control">
          <span className="field-label">SQUAD IDENTIFIER</span>
          <input
            aria-label="Squad name"
            value={state.squad}
            maxLength={48}
            onChange={e => setState(p => ({ ...p, squad: e.target.value }))}
          />
        </div>

        <div className="header-actions">
          <button
            className="btn btn-ghost"
            onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
            aria-label="Toggle light or dark mode"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setImportError('')
              setShowImport(true)
            }}
          >
            <FileUp size={14} /> Import Timetable
          </button>
          <button className="btn btn-ghost" onClick={loadSample}>
            <Activity size={14} /> Demo Squad
          </button>
          <button className="btn btn-ghost" onClick={reset}>
            <RotateCcw size={14} /> Reset
          </button>
          <button className="btn btn-primary" onClick={shareLink}>
            <Share2 size={14} /> Share Link <ArrowUpRight size={13} />
          </button>
        </div>
      </header>

      {/* Locked Pit Window Banner */}
      {state.locked && (
        <div className={`locked-banner ${lockedValid ? '' : 'locked-invalid'}`}>
          <div className="lock-icon">
            <LockKeyhole size={15} />
          </div>
          <div className="locked-copy">
            <strong>LOCKED PIT WINDOW</strong>
            <span>
              {formatWindow(state.locked)} <i>·</i> {state.locked.duration} HR
              {state.locked.duration > 1 ? 'S' : ''} <i>·</i>{' '}
              {lockedValid ? 'CLEAR TRACK CONFIRMED' : 'AVAILABILITY CHANGED — REVIEW SLOT'}
            </span>
          </div>
          <button className="banner-link" onClick={shareLink}>
            Share slot <ArrowUpRight size={13} />
          </button>
          <button className="icon-btn" aria-label="Unlock pit window" onClick={clearLock}>
            <X size={15} />
          </button>
        </div>
      )}

      {/* Driver Roster Strip */}
      <section className="roster-panel">
        <div className="section-kicker">
          <Users size={13} /> DRIVER ROSTER
          <span className="count-pill">{state.drivers.length.toString().padStart(2, '0')}</span>
          <span className="roster-note">TOGGLE EYE TO BENCH A DRIVER</span>
        </div>

        <div className="roster-row">
          {state.drivers.map(d => (
            <div
              key={d.id}
              className={`driver-chip ${d.active ? '' : 'benched'}`}
              style={{ '--driver': d.color }}
            >
              <span className="driver-color" />
              <button
                className="driver-name"
                onClick={() => {
                  setSelected(d.id)
                  setMode('edit')
                }}
                title="Edit this driver's timetable"
              >
                {d.name}
              </button>
              <span className="driver-hours">{d.busy.length.toString().padStart(2, '0')}H</span>
              <button
                className="chip-action"
                aria-label={`${d.active ? 'Bench' : 'Activate'} ${d.name}`}
                title={d.active ? 'Bench driver' : 'Activate driver'}
                onClick={() => updateDriver(d.id, x => ({ ...x, active: !x.active }))}
              >
                {d.active ? <Eye size={13} /> : <EyeOff size={13} />}
              </button>
              <button
                className="chip-action delete"
                aria-label={`Remove ${d.name}`}
                title="Remove driver"
                onClick={() => {
                  setState(p => ({ ...p, drivers: p.drivers.filter(x => x.id !== d.id) }))
                  if (selected === d.id) {
                    setSelected(state.drivers.find(x => x.id !== d.id)?.id || '')
                  }
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}

          {showAdd ? (
            <form
              className="add-driver"
              onSubmit={e => {
                e.preventDefault()
                addDriver()
              }}
            >
              <input
                autoFocus
                value={addName}
                onChange={e => setAddName(e.target.value)}
                placeholder="Driver name"
                maxLength={36}
              />
              <button className="add-confirm" type="submit">
                <Check size={13} />
              </button>
              <button
                type="button"
                className="add-cancel"
                onClick={() => {
                  setShowAdd(false)
                  setAddName('')
                }}
              >
                <X size={13} />
              </button>
            </form>
          ) : (
            <button className="add-driver-btn" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> ADD DRIVER
            </button>
          )}

          <div className="roster-spacer" />
          <div className="roster-total">
            <span>ACTIVE</span>
            <b>{String(activeCount).padStart(2, '0')}</b>
            <span>/ {String(state.drivers.length).padStart(2, '0')}</span>
          </div>
        </div>
      </section>

      {/* Main Workspace */}
      <main className="workspace">
        {/* Sector 01: Weekly Timetable Matrix */}
        <section className="grid-panel panel">
          <div className="panel-head">
            <div>
              <div className="panel-eyebrow">01 / TRACK MAP</div>
              <h2>
                Weekly timetable{' '}
                <span className="live-tag">
                  <span className="live-dot" /> LIVE
                </span>
              </h2>
              <p>Mark lectures and labs, then lock a shared free pit window.</p>
            </div>
            <div className="mode-switch">
              <button
                className={mode === 'edit' ? 'selected' : ''}
                onClick={() => setMode('edit')}
              >
                <Gauge size={13} /> QUALIFYING
              </button>
              <button
                className={mode === 'combined' ? 'selected' : ''}
                onClick={() => setMode('combined')}
              >
                <Users size={13} /> RACE TELEMETRY
              </button>
            </div>
          </div>

          {mode === 'edit' && (
            <div className="edit-strip">
              <span className="edit-label">DRIVER</span>
              <div className="driver-select">
                {state.drivers.map(d => (
                  <button
                    key={d.id}
                    className={selectedDriver?.id === d.id ? 'active' : ''}
                    style={{ '--driver': d.color }}
                    onClick={() => setSelected(d.id)}
                  >
                    <span className="driver-color" />
                    {d.name}
                  </button>
                ))}
              </div>
              <div className="quick-actions">
                <button onClick={clearSchedule} title="Clear this driver's whole week">
                  <Eraser size={12} /> CLEAR
                </button>
                <button onClick={busyAll} title="Mark this driver busy all week">
                  <PaintBucket size={12} /> ALL BUSY
                </button>
              </div>
              <div className="paint-hint">
                <span className="paint-swatch" /> {paintBusy ? 'PAINT BUSY' : 'ERASE BUSY'}
                <button onClick={() => setPaintBusy(v => !v)} aria-label="Toggle paint or erase">
                  <RotateCcw size={12} />
                </button>
              </div>
            </div>
          )}

          {mode === 'combined' && (
            <div className="heatmap-note">
              <span className="flag-green" /> 0 BUSY
              <span className="flag-yellow" /> 1 BUSY
              <span className="flag-red" /> 2+ BUSY
              <button className="clear-all-btn" onClick={clearEveryone}>
                <Eraser size={12} /> CLEAR ALL
              </button>
              <span className="heatmap-tip">Click a clear cell to lock a 1-hour pit window.</span>
            </div>
          )}

          <div className="grid-wrap" ref={gridRef}>
            <div
              className={`timetable ${mode === 'edit' ? 'paint-mode' : ''}`}
              role="grid"
              aria-label="Weekly timetable Monday to Saturday from 8 AM to 8 PM"
            >
              <div className="corner-cell">
                <span>DAY / HR</span>
              </div>
              {HOURS.map(h => (
                <button
                  type="button"
                  key={h}
                  className="hour-head"
                  title={mode === 'edit' ? 'Toggle this hour all week' : undefined}
                  onClick={() => mode === 'edit' && toggleHour(h)}
                >
                  <span>{hourLabel(h)}</span>
                  <small>{h < 12 ? 'AM' : 'PM'}</small>
                </button>
              ))}

              {DAYS.map((day, d) => (
                <React.Fragment key={day}>
                  <button
                    type="button"
                    className="day-head"
                    title={mode === 'edit' ? 'Toggle this whole day' : undefined}
                    onClick={() => mode === 'edit' && toggleDay(d)}
                  >
                    <strong>{day}</strong>
                    <small>{['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d]}</small>
                  </button>

                  {HOURS.map(h => {
                    const st = cellStatus(d, h)
                    const isLocked =
                      state.locked &&
                      state.locked.day === d &&
                      h >= state.locked.hour &&
                      h < state.locked.hour + state.locked.duration
                    const isBusyEdit =
                      mode === 'edit' && selectedDriver?.busy.includes(slotKey(d, h))
                    const statusClass =
                      mode === 'edit'
                        ? isBusyEdit
                          ? 'busy-edit'
                          : 'free-edit'
                        : st.count === 0
                        ? 'clear'
                        : st.count === 1
                        ? 'yellow'
                        : 'red'
                    const tooltip =
                      mode === 'edit'
                        ? `${selectedDriver?.name || 'No driver'}: ${
                            isBusyEdit ? 'BUSY' : 'FREE'
                          }\nClick/drag to ${isBusyEdit ? 'clear' : 'mark busy'}`
                        : `FREE: ${st.free.map(x => x.name).join(', ') || '—'}\nBUSY: ${
                            st.busy.map(x => x.name).join(', ') || '—'
                          }\n${
                            st.count === 0
                              ? 'CLEAR TRACK'
                              : st.count === 1
                              ? 'YELLOW FLAG'
                              : 'RED FLAG'
                          }`

                    return (
                      <button
                        key={h}
                        role="gridcell"
                        aria-label={`${day} ${hourLabel(h)} ${tooltip.replace(/\n/g, '. ')}`}
                        title={tooltip}
                        className={`time-cell ${statusClass} ${isLocked ? 'cell-locked' : ''}`}
                        style={
                          mode === 'edit' && isBusyEdit ? { '--driver': selectedDriver?.color } : {}
                        }
                        onMouseDown={e => {
                          if (e.button !== 0 || Date.now() - lastTouch.current < 700) return
                          e.preventDefault()
                          if (mode === 'edit') {
                            const value = paintBusy
                            setPaintValue(value)
                            setDragging(true)
                            paintCell(d, h, value)
                          }
                        }}
                        onMouseEnter={() => {
                          setHover({ day: d, hour: h })
                          enterPaint(d, h)
                        }}
                        onTouchStart={() => {
                          lastTouch.current = Date.now()
                          if (mode === 'edit') startPaint(d, h)
                        }}
                        onTouchMove={e => {
                          const touch = e.touches[0]
                          const el = document.elementFromPoint(touch.clientX, touch.clientY)
                          const key = el?.closest?.('[data-slot]')?.dataset.slot
                          if (key) {
                            const [dd, hh] = key.split('-').map(Number)
                            enterPaint(dd, hh)
                          }
                        }}
                        onClick={e => {
                          if (mode === 'combined') lockCell(d, h)
                          else if (e.detail === 0) paintCell(d, h, !isBusyEdit)
                        }}
                        data-slot={slotKey(d, h)}
                      >
                        <span className="cell-inner">
                          {mode === 'combined' && st.count > 0 ? (
                            <span className="clash-number">{st.count}</span>
                          ) : mode === 'edit' && isBusyEdit ? (
                            <span className="busy-mark" />
                          ) : null}
                          {isLocked && <LockKeyhole size={10} className="cell-lock" />}
                        </span>
                      </button>
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="grid-foot">
            <div className="legend">
              <span>
                <i className="legend-box busy-legend" /> BUSY
              </span>
              <span>
                <i className="legend-box free-legend" /> FREE
              </span>
              <span>
                <i className="legend-box locked-legend" /> LOCKED
              </span>
            </div>
            <span className="grid-foot-note">
              <span className="live-dot" /> DRAG TO PAINT <b>·</b> TAP TO TOGGLE
            </span>
          </div>

          {hover && (
            <div className="hover-readout">
              <span className="readout-label">SECTOR INSPECT</span>
              <b>
                {prettyDay(hover.day)} / {hourLabel(hover.hour)}
              </b>
              <span>
                {mode === 'combined'
                  ? `${cellStatus(hover.day, hover.hour).free.length} free · ${
                      cellStatus(hover.day, hover.hour).busy.length
                    } busy`
                  : selectedDriver
                  ? `${selectedDriver.name} · ${
                      selectedDriver.busy.includes(slotKey(hover.day, hover.hour)) ? 'BUSY' : 'FREE'
                    }`
                  : 'Select driver'}
              </span>
            </div>
          )}
        </section>

        {/* Sector 02 & 03: Strategy & Pit Crew Dispatch */}
        <aside className="side-panel">
          <section className="panel windows-panel">
            <div className="panel-head side-head">
              <div>
                <div className="panel-eyebrow">02 / STRATEGY</div>
                <h2>Optimal pit windows</h2>
                <p>Longest shared windows first. Midday breaks rank higher.</p>
              </div>
              <div className="window-count">
                {filteredWindows.length.toString().padStart(2, '0')}
                <small>FOUND</small>
              </div>
            </div>

            <div className="filter-row">
              {[
                { label: 'ALL GAPS', value: 1 },
                { label: '1 HR+', value: 1 },
                { label: '2 HRS+', value: 2 },
                { label: '3 HRS+', value: 3 }
              ].map((f, i) => (
                <button
                  key={f.label}
                  className={filter === (i === 0 ? 0 : f.value) ? 'active' : ''}
                  onClick={() => setFilter(i === 0 ? 0 : f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="window-list">
              {filteredWindows.length ? (
                filteredWindows.slice(0, 8).map((w, i) => (
                  <div
                    key={`${w.day}-${w.start}`}
                    className={`window-item ${
                      state.locked?.day === w.day &&
                      state.locked?.hour === w.start &&
                      state.locked?.duration === w.duration
                        ? 'window-current'
                        : ''
                    }`}
                  >
                    <div className="rank">{String(i + 1).padStart(2, '0')}</div>
                    <div className="window-info">
                      <strong>{formatWindow(w)}</strong>
                      <span>
                        {w.duration} HR{w.duration > 1 ? 'S' : ''} CLEAR WINDOW <i>·</i>{' '}
                        {w.duration * 60} MIN
                      </span>
                    </div>
                    <button
                      className="window-lock"
                      title="Lock this pit window"
                      onClick={() => lockWindow(w)}
                    >
                      {state.locked?.day === w.day &&
                      state.locked?.hour === w.start &&
                      state.locked?.duration === w.duration ? (
                        <Check size={14} />
                      ) : (
                        <LockKeyhole size={13} />
                      )}
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty-windows">
                  <div className="empty-flag">
                    <AlertTriangle size={18} />
                  </div>
                  <strong>NO CLEAR TRACK</strong>
                  <span>Try yellow-flag slots or bench 1 driver to simulate a lighter squad.</span>
                  <button onClick={() => setMode('combined')}>
                    VIEW RACE TELEMETRY <ArrowUpRight size={12} />
                  </button>
                </div>
              )}
            </div>

            <div className="rank-foot">
              <span>
                <Activity size={12} /> ENGINE STATUS
              </span>
              <b className={activeCount ? 'status-ok' : 'status-warn'}>
                {activeCount ? 'ONLINE' : 'NO ACTIVE DRIVERS'}
              </b>
            </div>
          </section>

          <section className="panel action-panel">
            <div className="panel-eyebrow">03 / PIT CREW ACTIONS</div>
            <h3>Meeting dispatch</h3>
            <p>
              {state.locked
                ? 'The selected period is ready to send to the squad.'
                : 'Choose a clear period, then send the invite.'}
            </p>
            <button className="action-btn action-primary" onClick={shareLink}>
              <Link2 size={14} /> COPY SHAREABLE LINK <Copy size={13} />
            </button>
            <button className="action-btn" onClick={copyBrief}>
              <Clipboard size={14} /> COPY WHATSAPP / DISCORD BRIEF <ArrowUpRight size={13} />
            </button>
            <button
              className="action-btn"
              disabled={!state.locked}
              onClick={() => downloadICS(state)}
            >
              <CalendarDays size={14} /> DOWNLOAD .ICS INVITE <ArrowUpRight size={13} />
            </button>
            <div className="action-meta">
              <span>
                <span className="live-dot" /> LOCAL SCHEDULE ENGINE
              </span>
              <span>PDF / AI INGEST</span>
            </div>
          </section>
        </aside>
      </main>

      <footer className="footer">
        <div>
          <span className="footer-logo">
            PW<span>//</span>S
          </span>{' '}
          PIT WALL // SYNC <span className="footer-muted">· BUILT FOR HBTU KANPUR</span>
        </div>
        <div className="footer-right">
          SCHEDULE CONTROL / HBTU <span className="checkered" />
        </div>
      </footer>

      {/* Timetable Import Modal */}
      {showImport && (
        <div
          className="import-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-title"
        >
          <div className="import-dialog">
            <div className="import-dialog-top">
              <div>
                <div className="panel-eyebrow">SCHEDULE INGEST / HBTU</div>
                <h2 id="import-title">Import student timetable</h2>
              </div>
              <button
                className="icon-btn"
                onClick={() => setShowImport(false)}
                aria-label="Close import"
              >
                <X size={16} />
              </button>
            </div>

            <p className="import-description">
              Select your branch first. Only that branch&apos;s column from the official first-year
              timetable will be read and added to the track map.
            </p>

            <label className="import-field-label" htmlFor="import-branch">
              01 / SELECT BRANCH
            </label>
            <select
              id="import-branch"
              className="import-select"
              value={importBranch}
              onChange={e => setImportBranch(e.target.value)}
            >
              {HBTU_BRANCHES.map(b => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>

            <label className="import-field-label" htmlFor="import-name">
              02 / DRIVER NAME
            </label>
            <input
              id="import-name"
              className="import-name-input"
              value={importName}
              onChange={e => setImportName(e.target.value)}
              placeholder={`${importBranch} Student`}
              maxLength={36}
            />

            <div className="ai-switch">
              <button
                className={aiMode ? 'selected' : ''}
                onClick={() => {
                  setAiMode(true)
                  setAiResult(null)
                }}
              >
                <Sparkles size={12} /> AI SMART READ
              </button>
              <button
                className={!aiMode ? 'selected' : ''}
                onClick={() => {
                  setAiMode(false)
                  setAiResult(null)
                }}
              >
                <FileUp size={12} /> CLASSIC HBTU PDF
              </button>
            </div>

            {aiMode && !aiResult && (
              <div className="import-footnote">
                UNIVERSAL AI GATEWAY ·{' '}
                {aiStatus.configured === false
                  ? 'Add AI_API_KEY in .env to enable AI read.'
                  : `Connected to ${aiStatus.model} via /api/ai/read-timetable.`}
              </div>
            )}

            {aiResult ? (
              <div className="ai-preview">
                <div className="import-field-label">
                  AI READ {aiResult.classes.length} CLASSES · {classSlots(aiResult.classes).length}{' '}
                  BUSY HOURS
                </div>
                <div className="ai-list">
                  {[...aiResult.classes]
                    .sort((x, y) => x.day - y.day || x.s - y.s)
                    .map((c, i) => (
                      <div key={i} className="ai-row">
                        <b>{DAYS[c.day]}</b>
                        <span>
                          {fmt(c.s)}–{fmt(c.e)}
                        </span>
                        <em>{c.subject}</em>
                        {c.guessed && <i className="guess-tag">GUESSED</i>}
                      </div>
                    ))}
                </div>
                {aiResult.notes && <div className="import-footnote">{aiResult.notes}</div>}
                <div className="ai-actions">
                  <button
                    className="import-submit"
                    onClick={() =>
                      finishImport(
                        classSlots(aiResult.classes),
                        `${classSlots(aiResult.classes).length} busy hours added`
                      )
                    }
                  >
                    ADD TO TRACK <Check size={14} />
                  </button>
                  <button className="import-cancel" onClick={() => setAiResult(null)}>
                    DISCARD
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="import-source-note">
                  <FileUp size={16} />
                  <span>
                    <b>
                      {aiMode
                        ? 'Any timetable: PDF, screenshot or photo'
                        : 'Official HBTU ODD Semester 2026–27 PDF'}
                    </b>
                    <small>
                      {aiMode
                        ? 'AI reads it exactly and guesses missing periods'
                        : 'Searchable PDF · First-year timetable · Monday–Saturday'}
                    </small>
                  </span>
                </div>
                <input
                  ref={importInput}
                  type="file"
                  accept={
                    aiMode ? 'application/pdf,.pdf,image/png,image/jpeg,image/webp' : 'application/pdf,.pdf'
                  }
                  hidden
                  onChange={e => importTimetable(e.target.files?.[0])}
                />
                <button
                  className="import-submit"
                  disabled={importBusy}
                  onClick={() => importInput.current?.click()}
                >
                  {importBusy
                    ? aiMode
                      ? 'AI IS READING…'
                      : 'READING BRANCH COLUMN…'
                    : aiMode
                    ? 'SELECT FILE & READ WITH AI'
                    : 'SELECT PDF & IMPORT BRANCH'}{' '}
                  <ArrowUpRight size={14} />
                </button>
              </>
            )}

            {importError && (
              <div className="import-error" role="alert">
                ⚠ {importError}
              </div>
            )}

            <div className="import-footnote">
              {aiMode
                ? 'Guessed periods are tagged GUESSED — review before adding. The file is sent to the configured universal AI endpoint through the secured server; API credentials never reach this browser.'
                : 'Classes are mapped to the nearest hourly cells (the source timetable uses 50-minute periods). Imported schedules can be edited on the track map.'}
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="toast">
          <Check size={14} />
          {toast}
          {undoable && (
            <button className="toast-undo" onClick={undo}>
              UNDO
            </button>
          )}
        </div>
      )}
    </div>
  )
}