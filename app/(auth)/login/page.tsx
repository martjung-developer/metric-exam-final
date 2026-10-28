// app/(auth)/login/page.tsx

'use client'

import { Suspense, useRef, useState, useEffect } from 'react'
import Image                       from 'next/image'
import Link                        from 'next/link'
import { useSearchParams }         from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, ArrowRight, AlertCircle, ArrowLeft, Loader2 } from 'lucide-react'
import { MoleculeBackground }      from '@/animations/auth/MoleculeBackground'
import { signInWithId } from '@/lib/services/auth'
import Turnstile, { type TurnstileHandle } from '@/components/auth/Turnstile'
import { detectRoleFromId, validateLoginId, getStaffPrefix }  from '@/lib/utils/auth'
import type { UserRole } from '@/lib/types/auth'
import styles from '../auth.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  student: 'Student',
  faculty: 'Faculty',
  admin:   'Department Admin',
}

// ── Variants ──────────────────────────────────────────────────────────────────

const cardAnim = {
  initial:    { opacity: 0, y: 18, scale: 0.97 },
  animate:    { opacity: 1, y: 0,  scale: 1    },
  transition: { duration: 0.42, ease: [0.34, 1.2, 0.64, 1] as const },
}

const fieldAnim = (delay = 0) => ({
  initial:    { opacity: 0, y: 8 },
  animate:    { opacity: 1, y: 0 },
  transition: { duration: 0.28, delay },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidRole(v: string | null): v is UserRole {
  return v === 'student' || v === 'faculty' || v === 'admin'
}

/**
 * Pre-resolve badge label (before the server confirms the actual role):
 *   Student ID  → "Student"
 *   Staff ID    → "Staff (PREFIX)"
 *   Unknown     → null
 */
function getPreResolveBadgeLabel(userId: string): string | null {
  const role = detectRoleFromId(userId)
  if (!role) { return null }
  if (role === 'student') { return 'Student' }
  const prefix = getStaffPrefix(userId)
  return prefix ? `Staff (${prefix})` : 'Staff'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  )
}

function LoginContent() {
  const searchParams = useSearchParams()
  const queryRole    = searchParams.get('role')
  const nextPath     = searchParams.get('next') ?? undefined
  const selectedRole = isValidRole(queryRole) ? queryRole : null

  const [userId,       setUserId]       = useState('')
  const [password,     setPassword]     = useState('')
  const [showPw,       setShowPw]       = useState(false)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [idError,      setIdError]      = useState<string | null>(null)
  const [detectedRole, setDetectedRole] = useState<UserRole | null>(null)
  const [badgeLabel,   setBadgeLabel]   = useState<string | null>(null)
  const [mismatch,     setMismatch]     = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const turnstileRef = useRef<TurnstileHandle>(null)

  // ── Real-time ID analysis ─────────────────────────────────────────────────
  useEffect(() => {
    const detected = detectRoleFromId(userId)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetectedRole(detected)
    setBadgeLabel(getPreResolveBadgeLabel(userId))
    setMismatch(
      detected !== null &&
      selectedRole !== null &&
      detected !== selectedRole,
    )
  }, [userId, selectedRole])

  function handleIdChange(value: string) {
    setUserId(value)
    setIdError(null)
    setError(null)
  }

  function validateIdOnBlur() {
    if (!userId.trim()) { return }
    const err = validateLoginId(userId)
    setIdError(err ?? null)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) { return }

    setError(null)
    setIdError(null)

    const idErr = validateLoginId(userId)
    if (idErr) { setIdError(idErr); return }
    if (!password) { setError('Please enter your password.'); return }

    // Mismatch: warn inline but do not block — server role is authoritative
    if (mismatch && detectedRole) {
      setError(
        `Your ID looks like a ${ROLE_LABELS[detectedRole]} ID` +
        (selectedRole ? `, not ${ROLE_LABELS[selectedRole]}` : '') +
        `. Signing in as ${ROLE_LABELS[detectedRole]}.`,
      )
      // intentional fall-through
    }

    setLoading(true)
    const result = await signInWithId(userId.trim(), password, captchaToken)
    setLoading(false)

    if (!result.success) {
      turnstileRef.current?.reset()
      const msg = result.error?.toLowerCase() ?? ''
      if (msg.includes('not found')) {
        setIdError('ID not found.')
      } else if (msg.includes('password')) {
        setError('Incorrect password.')
      } else {
        setError(result.error ?? 'Login failed.')
      }
      return
    }

    // Preserve ?next= so the proxy can resume the original destination
    const dest = nextPath ?? result.redirectTo ?? '/login'
    window.location.href = dest
  }

  return (
    <>
      <MoleculeBackground />

      <div className={styles.authPage}>
        <motion.div className={styles.card} {...cardAnim}>

          {/* ── Back + Logo ── */}
          <div className={styles.logoWrap} style={{ position: 'relative' }}>
            <Link href="/" className={styles.cardBackLink} aria-label="Back to role selection">
              <ArrowLeft size={13} strokeWidth={2} />
              Back
            </Link>
            <Image
              src="/images/metric-logo.png"
              alt="M.E.T.R.I.C."
              height={44}
              width={160}
              className={styles.logoImg}
              priority
              onError={(e) => {
                const parent = e.currentTarget.parentElement
                if (parent) {
                  parent.innerHTML = '<span class="logoTextFallback">M.E.T.R.I.C.</span>'
                }
              }}
            />
          </div>

          {/* ── Role hint pill ── */}
          {selectedRole && (
            <div className={styles.roleHintRow}>
              <span className={styles.roleHintLabel}>Signing in as</span>
              <span className={styles.roleHintPill} data-role={selectedRole}>
                {ROLE_LABELS[selectedRole]}
              </span>
              <Link href="/" className={styles.roleHintChange}>Change</Link>
            </div>
          )}

          <h1 className={styles.heading}>Welcome back</h1>
          <p className={styles.subheading}>Enter your credentials to access your account</p>

          {/* ── Error / mismatch banner ── */}
          <AnimatePresence>
            {error && (
              <motion.div
                className={`${styles.errorBanner} ${mismatch ? styles.errorBannerWarn : ''}`}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{ marginBottom: '0.75rem' }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>

            {/* ── ID Number ── */}
            <motion.div className={styles.fieldGroup} {...fieldAnim(0)}>
              <div className={styles.fieldRow}>
                <label className={styles.label} htmlFor="login-id">ID NUMBER</label>

                <AnimatePresence>
                  {badgeLabel && (
                    <motion.span
                      className={`${styles.detectedBadge} ${mismatch ? styles.detectedBadgeMismatch : ''}`}
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      transition={{ duration: 0.18 }}
                    >
                      {mismatch ? '⚠ ' : '✓ '}Detected: {badgeLabel}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              <input
                id="login-id"
                className={[
                  styles.input,
                  idError   ? styles.inputError    : '',
                  mismatch  ? styles.inputMismatch : '',
                ].join(' ')}
                type="text"
                placeholder="23-0249-605  or  SBIT-16113"
                value={userId}
                onChange={(e) => handleIdChange(e.target.value)}
                onBlur={validateIdOnBlur}
                autoComplete="username"
                spellCheck={false}
              />

              {idError && (
                <span className={styles.fieldError}>{idError}</span>
              )}

              {mismatch && detectedRole && !idError && (
                <span className={styles.fieldWarn}>
                  ID looks like {ROLE_LABELS[detectedRole]} — will sign in as {ROLE_LABELS[detectedRole]}.
                </span>
              )}
            </motion.div>

            {/* ── Password ── */}
            <motion.div className={styles.fieldGroup} {...fieldAnim(0.06)}>
              <div className={styles.fieldRow}>
                <label className={styles.label} htmlFor="login-password">Password</label>
                <Link href="/forgot-password" className={styles.forgotLink}>Forgot password?</Link>
              </div>
              <div className={styles.inputWrap}>
                <input
                  id="login-password"
                  className={styles.input}
                  type={showPw ? 'text' : 'password'}
                  placeholder="•••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className={styles.inputToggle}
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw
                    ? <EyeOff size={15} strokeWidth={2} />
                    : <Eye   size={15} strokeWidth={2} />}
                </button>
              </div>
            </motion.div>

            <Turnstile ref={turnstileRef} onToken={setCaptchaToken} />

            {/* ── Submit ── */}
            <motion.button
              type="submit"
              className={styles.submitBtn}
              disabled={loading || !captchaToken}
              whileHover={loading || !captchaToken ? {} : { y: -1 }}
              whileTap={loading  ? {} : { scale: 0.985 }}
            >
              {loading
                ? <><Loader2 size={15} className={styles.spinnerIcon} /> Signing in…</>
                : <> Log in <ArrowRight size={15} strokeWidth={2.5} /></>}
            </motion.button>

            <p className={styles.switchPrompt}>
              Don&apos;t have an account?{' '}
              <Link href="/signup" className={styles.switchLink}>Sign up</Link>
            </p>

          </form>
        </motion.div>
      </div>
    </>
  )
}

