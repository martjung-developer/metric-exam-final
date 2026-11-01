// app/(dashboard)/student/help/page.tsx
// Orchestrator only — calls hooks, composes components, contains ZERO business logic.

'use client'

import React, { useCallback, useState } from 'react'
import { Check, Clock, Copy, MapPin, Navigation } from 'lucide-react'
import { useUser }          from '@/lib/context/AuthContext'
import { useFaqs }          from '@/lib/hooks/student/help/useFaqs'
import { useSubmitTicket }  from '@/lib/hooks/student/help/useSubmitTicket'
import {
  HelpHero,
  CategoryGrid,
  FaqAccordion,
  ContactChannels,
  TicketForm,
} from '@/components/dashboard/student/help'
import styles from './help.module.css'

export default function StudentHelpPage() {
  const [mapLoaded, setMapLoaded] = useState(false)
  const [addressCopied, setAddressCopied] = useState(false)
  // ── Auth ────────────────────────────────────────────────────────────────────
  const { user } = useUser()

  // ── FAQ state ────────────────────────────────────────────────────────────────
  const {
    filteredFaqs,
    categoriesWithCounts,
    loading,
    search,
    activeCategory,
    openFaqId,
    setSearch,
    setActiveCategory,
    toggleFaq,
  } = useFaqs()

  // ── Ticket state ─────────────────────────────────────────────────────────────
  const {
    form,
    formErrors,
    submitting,
    submitSuccess,
    submitError,
    setField,
    submit,
  } = useSubmitTicket(user?.id ?? null)

  // ── Handlers ─────────────────────────────────────────────────────────────────

  // Hero search → also clears category
  const handleSearchChange = useCallback(
    (value: string) => setSearch(value),
    [setSearch],
  )

  const handleSearchClear = useCallback(
    () => setSearch(''),
    [setSearch],
  )

  // Program pill → sets search to program name, resets category to 'programs'
  const handleProgramPill = useCallback(
    (program: string) => {
      setSearch(program)
      setActiveCategory('programs')
    },
    [setSearch, setActiveCategory],
  )

  const handleClearFilters = useCallback(() => {
    setSearch('')
    setActiveCategory('all')
  }, [setSearch, setActiveCategory])

  async function handleCopyAddress() {
    try {
      await navigator.clipboard.writeText('Galo-Gatuslao-Rizal Streets, Bacolod City, Philippines, 6100')
      setAddressCopied(true)
      window.setTimeout(() => setAddressCopied(false), 2000)
    } catch {
      
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>

      {/* ── Hero with search ── */}
      <HelpHero
        search={search}
        onSearchChange={handleSearchChange}
        onSearchClear={handleSearchClear}
        onProgramPillClick={handleProgramPill}
      />

      <div className={styles.body}>

        {/* ── Category filter strip ── */}
        <CategoryGrid
          categories={categoriesWithCounts}
          activeCategory={activeCategory}
          loading={loading}
          onSelect={setActiveCategory}
        />

        {/* ── FAQ accordion ── */}
        <FaqAccordion
          faqs={filteredFaqs}
          categories={categoriesWithCounts}
          loading={loading}
          search={search}
          activeCategory={activeCategory}
          openFaqId={openFaqId}
          onToggle={toggleFaq}
          onClearFilters={handleClearFilters}
        />

        {/* ── Contact channels ── */}
        <ContactChannels />

        <article className={styles.visitCard}>
          <div className={styles.visitMapColumn}>
            {!mapLoaded && <div className={styles.visitMapSkeleton} aria-hidden="true" />}
            <iframe
              src="https://www.google.com/maps?q=La+Consolacion+College+Bacolod&output=embed"
              title="La Consolacion College Bacolod map"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
              onLoad={() => setMapLoaded(true)}
            />
          </div>
          <div className={styles.visitInfo}>
            <span className={styles.visitBadge}><MapPin size={14} /> CAMPUS</span>
            <h2 className={styles.sectionTitle}>La Consolacion College Bacolod</h2>
            <div className={styles.visitDetails}>
              <p className={styles.contactDesc}><MapPin size={16} className={styles.sectionIcon} />Galo-Gatuslao-Rizal Streets, Bacolod City, Philippines, 6100</p>
              <p className={styles.contactDesc}><Clock size={16} className={styles.sectionIcon} />Mon-Fri, 8 AM - 5 PM</p>
            </div>
            <div className={styles.visitActions}>
              <a
                className={styles.submitBtn}
                href="https://www.google.com/maps/search/?api=1&query=La+Consolacion+College+Bacolod"
                target="_blank"
                rel="noopener noreferrer"
              ><Navigation size={15} />Get directions</a>
              <button className={styles.ghostBtn} type="button" onClick={() => { void handleCopyAddress() }}>
                {addressCopied ? <Check size={15} /> : <Copy size={15} />}
                {addressCopied ? 'Copied' : 'Copy address'}
              </button>
            </div>
          </div>
        </article>

        {/* ── Support ticket form ── */}
        <TicketForm
          form={form}
          formErrors={formErrors}
          submitting={submitting}
          submitSuccess={submitSuccess}
          submitError={submitError}
          setField={setField}
          onSubmit={submit}
        />

      </div>
    </div>
  )
}
