import React, { useRef, useState } from 'react'

const fmtSize = (bytes) => {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * UploadCard — a numbered document intake card. Empty state shows a dashed
 * dropzone (drag-and-drop or click); filled state swaps to a sage-ringed
 * file chip with name, size and a remove control. `optional` de-emphasises
 * the card (e.g. the award upload once an industry library is preloaded).
 * Icons are passed in (Lucide elements); unicode fallbacks keep it standalone.
 */
export function UploadCard({
  index,
  headerIcon = null,
  title,
  subtitle,
  accept,
  formats,
  file = null,
  optional = false,
  onFile,
  onRemove,
  uploadIcon = null,
  checkIcon = null,
  removeIcon = null,
}) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  const dragDepth = useRef(0)

  const stop = (e) => { e.preventDefault(); e.stopPropagation() }
  const openPicker = () => inputRef.current?.click()
  const handleEnter = (e) => { stop(e); dragDepth.current += 1; setOver(true) }
  const handleLeave = (e) => {
    stop(e)
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setOver(false)
  }
  const handleDrop = (e) => {
    stop(e); dragDepth.current = 0; setOver(false)
    const chosen = e.dataTransfer.files?.[0]
    if (chosen) onFile?.(chosen)
  }
  const handlePick = (e) => {
    const chosen = e.target.files?.[0]
    if (chosen) onFile?.(chosen)
    e.target.value = ''
  }

  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid',
        borderColor: file ? 'var(--sage-ring)' : 'var(--line)',
        borderRadius: 'var(--radius-3xl)',
        padding: '26px 26px 22px',
        position: 'relative',
        overflow: 'hidden',
        opacity: optional && !file ? 0.72 : 1,
        boxShadow: file ? 'var(--shadow-ready)' : 'none',
        transition: 'border-color var(--dur-med) ease, box-shadow var(--dur-med) ease, opacity var(--dur-med) ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 'var(--radius-md)', background: 'var(--hover-ink)',
            border: '1px solid var(--line)', display: 'grid', placeItems: 'center', color: 'var(--ink)',
          }}>
            {headerIcon}
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 500, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              {title}
              {optional && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--muted)' }}>
                  optional
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{subtitle}</div>
          </div>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 26, color: 'rgba(31,30,27,0.18)', fontWeight: 500, lineHeight: 1 }}>
          {index}
        </span>
      </div>

      <input ref={inputRef} type="file" accept={accept} onChange={handlePick} style={{ display: 'none' }} aria-label={`Choose ${title} file`} />

      {file ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: '13px 14px', background: 'var(--paper)' }}>
          <div style={{
            width: 38, height: 38, borderRadius: 'var(--radius-sm)', background: 'var(--sage-tint)',
            border: '1px solid var(--sage-ring)', display: 'grid', placeItems: 'center', color: 'var(--sage)', flexShrink: 0,
          }}>
            {checkIcon || <span style={{ fontWeight: 700 }}>✓</span>}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{fmtSize(file.size)} · ready</div>
          </div>
          <button
            onClick={onRemove}
            aria-label="Remove file"
            style={{
              display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 'var(--radius-xs)',
              border: '1px solid var(--line)', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', flexShrink: 0,
            }}
          >
            {removeIcon || <span>✕</span>}
          </button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={openPicker}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker() } }}
          onDragEnter={handleEnter}
          onDragOver={stop}
          onDragLeave={handleLeave}
          onDrop={handleDrop}
          style={{
            border: '1.5px dashed',
            borderColor: over ? 'var(--ochre)' : 'rgba(31,30,27,0.26)',
            borderStyle: over ? 'solid' : 'dashed',
            borderRadius: 'var(--radius-lg)',
            padding: '26px 18px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center',
            cursor: 'pointer',
            background: over ? 'var(--ochre-tint)' : 'rgba(20,22,28,0.02)',
            transition: 'border-color var(--dur-fast) ease, background var(--dur-fast) ease',
          }}
        >
          <span style={{ color: over ? 'var(--ochre)' : 'var(--muted)' }}>{uploadIcon || <span style={{ fontSize: 22 }}>⤒</span>}</span>
          <div style={{ fontSize: 14.5, fontWeight: 500 }}>{over ? 'Drop to upload' : 'Choose file or drop here'}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.06em' }}>{formats}</div>
        </div>
      )}
    </div>
  )
}
