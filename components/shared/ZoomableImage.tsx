'use client'

import Image from 'next/image'
import { Minus, Plus, RotateCcw, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import styles from './ZoomableImage.module.css'

interface ZoomableImageProps {
  src: string
  alt: string
  className?: string
}

interface Point {
  x: number
  y: number
}

interface PointerPosition extends Point {
  pointerType: string
}

interface PinchState {
  distance: number
  scale: number
  offset: Point
  midpoint: Point
}

const MAX_FIT_MULTIPLIER = 5

export function ZoomableImage({ src, alt, className }: ZoomableImageProps) {
  const [open, setOpen] = useState(false)
  const [fitScale, setFitScale] = useState(1)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const viewerImageRef = useRef<HTMLImageElement | null>(null)
  const pointersRef = useRef<Map<number, PointerPosition>>(new Map())
  const dragOriginRef = useRef<{ pointerId: number; point: Point; offset: Point } | null>(null)
  const pinchRef = useRef<PinchState | null>(null)
  const lastTouchTapRef = useRef(0)

  const clampOffset = useCallback((next: Point, nextScale: number): Point => {
    const stage = stageRef.current
    const image = viewerImageRef.current
    if (!stage || !image) {return next}

    const halfOverflowX = Math.max(0, (image.naturalWidth * nextScale - stage.clientWidth) / 2)
    const halfOverflowY = Math.max(0, (image.naturalHeight * nextScale - stage.clientHeight) / 2)
    return {
      x: Math.min(halfOverflowX, Math.max(-halfOverflowX, next.x)),
      y: Math.min(halfOverflowY, Math.max(-halfOverflowY, next.y)),
    }
  }, [])

  const zoomAt = useCallback((nextScale: number, point?: Point) => {
    const stage = stageRef.current
    if (!stage) {return}

    const safeScale = Math.min(fitScale * MAX_FIT_MULTIPLIER, Math.max(fitScale, nextScale))
    const center = { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }
    const anchor = point ?? center
    setOffset((current) => clampOffset({
      x: anchor.x - center.x - ((anchor.x - center.x - current.x) * safeScale) / scale,
      y: anchor.y - center.y - ((anchor.y - center.y - current.y) * safeScale) / scale,
    }, safeScale))
    setScale(safeScale)
  }, [clampOffset, fitScale, scale])

  const fitImage = useCallback(() => {
    const stage = stageRef.current
    const image = viewerImageRef.current
    if (!stage || !image?.naturalWidth || !image.naturalHeight) {return}

    const nextFitScale = Math.min(
      stage.clientWidth / image.naturalWidth,
      stage.clientHeight / image.naturalHeight,
      1,
    )
    setFitScale(nextFitScale)
    setScale(nextFitScale)
    setOffset({ x: 0, y: 0 })
  }, [])

  useEffect(() => {
    if (!open) {return}
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    fitImage()

    const resizeObserver = new ResizeObserver(fitImage)
    if (stageRef.current) {resizeObserver.observe(stageRef.current)}
    window.addEventListener('resize', fitImage)

    return () => {
      document.body.style.overflow = previousOverflow
      resizeObserver.disconnect()
      window.removeEventListener('resize', fitImage)
      triggerRef.current?.focus()
      // This Map is initialized once and cleared in place, never replaced.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      pointersRef.current.clear()
      dragOriginRef.current = null
      pinchRef.current = null
      setIsDragging(false)
    }
  }, [fitImage, open])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // Stop the exam's window-level navigation and restricted-shortcut listeners.
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }

    const key = event.key
    if (key === '+' || key === '=') {
      event.preventDefault()
      zoomAt(scale * 1.2)
    } else if (key === '-') {
      event.preventDefault()
      zoomAt(scale / 1.2)
    } else if (key === '0') {
      event.preventDefault()
      fitImage()
    } else if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault()
      const step = 48
      setOffset((current) => clampOffset({
        x: current.x + (key === 'ArrowLeft' ? step : key === 'ArrowRight' ? -step : 0),
        y: current.y + (key === 'ArrowUp' ? step : key === 'ArrowDown' ? -step : 0),
      }, scale))
    } else if (key === 'Tab') {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable?.length) {
        event.preventDefault()
        dialogRef.current?.focus()
      } else {
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) {return}
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
    zoomAt(scale * factor, { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === 'mouse') {return}
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      pointerType: event.pointerType,
    })
    const points = [...pointersRef.current.values()]
    if (points.length >= 2) {
      const [first, second] = points
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      pinchRef.current = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        scale,
        offset,
        midpoint,
      }
      dragOriginRef.current = null
    } else {
      dragOriginRef.current = {
        pointerId: event.pointerId,
        point: { x: event.clientX, y: event.clientY },
        offset,
      }
    }
    setIsDragging(true)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) {return}
    const previous = pointersRef.current.get(event.pointerId)
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      pointerType: previous?.pointerType ?? event.pointerType,
    })
    const points = [...pointersRef.current.values()]
    const stageRect = stageRef.current?.getBoundingClientRect()

    if (points.length >= 2 && pinchRef.current && stageRect) {
      const [first, second] = points
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      const startMidpoint = {
        x: pinchRef.current.midpoint.x - stageRect.left,
        y: pinchRef.current.midpoint.y - stageRect.top,
      }
      const currentMidpoint = { x: midpoint.x - stageRect.left, y: midpoint.y - stageRect.top }
      const nextScale = Math.min(
        fitScale * MAX_FIT_MULTIPLIER,
        Math.max(fitScale, pinchRef.current.scale * distance / Math.max(1, pinchRef.current.distance)),
      )
      const center = { x: stageRect.width / 2, y: stageRect.height / 2 }
      const worldAnchor = {
        x: (startMidpoint.x - center.x - pinchRef.current.offset.x) / pinchRef.current.scale,
        y: (startMidpoint.y - center.y - pinchRef.current.offset.y) / pinchRef.current.scale,
      }
      setScale(nextScale)
      setOffset(clampOffset({
        x: currentMidpoint.x - center.x - worldAnchor.x * nextScale,
        y: currentMidpoint.y - center.y - worldAnchor.y * nextScale,
      }, nextScale))
      return
    }

    const origin = dragOriginRef.current
    if (origin?.pointerId === event.pointerId) {
      setOffset(clampOffset({
        x: origin.offset.x + event.clientX - origin.point.x,
        y: origin.offset.y + event.clientY - origin.point.y,
      }, scale))
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const pointer = pointersRef.current.get(event.pointerId)
    pointersRef.current.delete(event.pointerId)
    if (pointer?.pointerType === 'touch') {
      const now = Date.now()
      if (now - lastTouchTapRef.current < 300) {
        zoomAt(scale <= fitScale * 1.05 ? fitScale * 2 : fitScale)
        lastTouchTapRef.current = 0
      } else {
        lastTouchTapRef.current = now
      }
    }
    const remaining = [...pointersRef.current.entries()]
    pinchRef.current = null
    if (remaining.length === 1) {
      const [pointerId, point] = remaining[0]
      dragOriginRef.current = { pointerId, point: { x: point.x, y: point.y }, offset }
    } else {
      dragOriginRef.current = null
    }
    if (remaining.length === 0) {setIsDragging(false)}
  }

  function closeViewer() {
    setOpen(false)
  }

  return (
    <span className={styles.inlineWrap}>
      <Image
        className={className}
        src={src}
        alt={alt}
        width={1200}
        height={800}
        unoptimized
        onClick={(event) => {
          triggerRef.current = event.currentTarget
          setOpen(true)
        }}
        role="button"
        tabIndex={0}
        aria-label={`Enlarge image: ${alt}`}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            triggerRef.current = event.currentTarget
            setOpen(true)
          }
        }}
      />
      <button
        ref={triggerRef}
        type="button"
        className={styles.enlargeButton}
        aria-label={`Enlarge image: ${alt}`}
        onClick={(event) => {
          triggerRef.current = event.currentTarget
          setOpen(true)
        }}
      >
        <Plus size={15} aria-hidden="true" />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-label={`Image viewer: ${alt}`}
          ref={dialogRef}
          tabIndex={-1}
          onClick={(event) => { if (event.target === event.currentTarget) {closeViewer()} }}
          onKeyDown={handleKeyDown}
        >
          <div className={styles.viewer}>
            <div className={styles.toolbar}>
              <span className={styles.zoomValue}>{fitScale > 0 ? `${Math.round(scale / fitScale * 100)}%` : '100%'}</span>
              <div className={styles.controls}>
                <button type="button" className={styles.controlButton} aria-label="Zoom out" onClick={() => zoomAt(scale / 1.2)}>
                  <Minus size={18} aria-hidden="true" />
                </button>
                <button type="button" className={styles.controlButton} aria-label="Fit image to screen" onClick={fitImage}>
                  <RotateCcw size={17} aria-hidden="true" />
                </button>
                <button type="button" className={styles.controlButton} aria-label="Zoom in" onClick={() => zoomAt(scale * 1.2)}>
                  <Plus size={18} aria-hidden="true" />
                </button>
                <button type="button" className={styles.controlButton} aria-label="Close image viewer" onClick={closeViewer}>
                  <X size={19} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div
              ref={stageRef}
              className={`${styles.stage} ${isDragging ? styles.grabbing : ''}`}
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onDoubleClick={() => zoomAt(scale <= fitScale * 1.05 ? fitScale * 2 : fitScale)}
            >
              <Image
                ref={viewerImageRef}
                className={styles.viewerImage}
                src={src}
                alt={alt}
                width={1200}
                height={800}
                unoptimized
                draggable={false}
                onLoad={fitImage}
                style={{ transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
              />
            </div>
            <span className={styles.keyboardHelp}>Drag to move · Wheel or +/- to zoom · 0 to fit · Esc to close</span>
          </div>
        </div>,
        document.body,
      )}
    </span>
  )
}
