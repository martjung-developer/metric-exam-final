'use client'

import Script from 'next/script'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

type TurnstileWidget = {
  render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void }) => string
  reset: (widgetId?: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileWidget }
}

export type TurnstileHandle = { reset: () => void }

const SCRIPT_ID = 'cloudflare-turnstile-script'

const Turnstile = forwardRef<TurnstileHandle, { onToken: (token: string) => void }>(function Turnstile({ onToken }, ref) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!siteKey) { console.warn('NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set; Turnstile is disabled.') }
  }, [siteKey])

  useImperativeHandle(ref, () => ({
    reset() {
      onToken('')
      if (widgetIdRef.current) { window.turnstile?.reset(widgetIdRef.current) }
    },
  }), [onToken])

  function renderWidget() {
    if (!siteKey || !containerRef.current || !window.turnstile || widgetIdRef.current) { return }
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      callback: onToken,
      'expired-callback': () => onToken(''),
      'error-callback': () => onToken(''),
    })
  }

  useEffect(() => { renderWidget() })

  if (!siteKey) { return null }
  return <>
    <Script id={SCRIPT_ID} src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={renderWidget} />
    <div ref={containerRef} />
  </>
})

export default Turnstile
