// components/dashboard/admin/questionnaires/ParseSummary.tsx
// ─────────────────────────────────────────────────────────────────────────────
// CHANGES FROM PREVIOUS VERSION:
//   + Shows warning when questions have no correct_answer detected
//   + Shows scenario count when scenario text was detected
//   + Lucide icons instead of emoji characters
// ─────────────────────────────────────────────────────────────────────────────
'use client'

import { AlertCircle, AlertTriangle, CheckCircle2, Info, BookOpen } from 'lucide-react'
import type { ImportRow } from '@/lib/types/admin/questionnaires/questionnaires'
import type { QuestionType } from '@/lib/types/database'
import { TYPE_COLORS } from '@/lib/constants/admin/questionnaires/questionnaires.constants'
import styles from '@/app/(dashboard)/admin/questionnaires/questionnaires.module.css'

interface ParseSummaryProps {
  rows: ImportRow[]
}

export function ParseSummary({ rows }: ParseSummaryProps) {
  const mcq   = rows.filter((r) => r.question_type === 'multiple_choice').length
  const tf    = rows.filter((r) => r.question_type === 'true_false').length
  const sa    = rows.filter((r) => r.question_type === 'short_answer').length
  const other = rows.length - mcq - tf - sa

  // Warning: questions that need a correct_answer but don't have one
  const missingAnswer = rows.filter(
    (r) =>
      r._valid &&
      (r.question_type === 'multiple_choice' || r.question_type === 'true_false') &&
      !r.correct_answer.trim(),
  ).length

  // Info: questions with scenario text detected
  const withScenario = rows.filter((r) => r.scenario.trim().length > 0).length

  function pill(type: QuestionType, count: number, label: string) {
    if (count === 0) { return null }
    const c = TYPE_COLORS[type]
    return (
      <span
        key={type}
        style={{
          background:   c.bg,
          color:        c.color,
          border:       `1px solid ${c.border}`,
          padding:      '2px 10px',
          borderRadius: 20,
          fontSize:     '0.72rem',
          fontWeight:   700,
          display:      'inline-flex',
          alignItems:   'center',
          gap:          4,
        }}
      >
        {count} {label}
      </span>
    )
  }

  function answerStatus(row: ImportRow): { label: string; ok: boolean } {
    const answer = row.correct_answer.trim()
    const requiresAnswer = row.question_type === 'multiple_choice' || row.question_type === 'true_false'
    if (requiresAnswer && !answer) { return { label: 'Needs a correct answer', ok: false } }

    const answerLabel = answer.toUpperCase()
    if (['A', 'B', 'C', 'D'].includes(answerLabel)) {
      const answerOption = row[`option_${answerLabel.toLowerCase() as 'a' | 'b' | 'c' | 'd'}`]
      if (!answerOption.trim()) { return { label: `Review correct answer: option ${answerLabel} is empty`, ok: false } }
    }

    if (!row.question_text.trim()) { return { label: 'Needs review: question text is missing', ok: false } }
    if (row.question_type === 'multiple_choice' && [row.option_a, row.option_b, row.option_c, row.option_d].filter((choice) => choice.trim()).length < 2) {
      return { label: 'Needs review: fewer than 2 choices', ok: false }
    }
    if (!row._valid) {
      const issue = row._errors.find((error) => /duplicate question/i.test(error))
        ? 'Duplicate question'
        : row._errors[0] ?? 'Check this question'
      return { label: `Needs review: ${issue}`, ok: false }
    }
    return answer
      ? { label: `Correct answer detected: ${answer}`, ok: true }
      : { label: 'Ready for review', ok: true }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {/* Type breakdown */}
      <div className={styles.parseSummary}>
        <span className={styles.parseSummaryLabel}>Detected types:</span>
        <div className={styles.parseSummaryPills}>
          {pill('multiple_choice', mcq,  'MCQ')}
          {pill('true_false',      tf,   'T/F')}
          {pill('short_answer',    sa,   'Short')}
          {other > 0 && (
            <span style={{
              background:   '#f1f5f9',
              color:        '#64748b',
              border:       '1px solid #e2e8f0',
              padding:      '2px 10px',
              borderRadius: 20,
              fontSize:     '0.72rem',
              fontWeight:   700,
            }}>
              {other} Other
            </span>
          )}
        </div>
      </div>

      {/* Keep the detected question list visible directly below the type summary. */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '0.45rem 0.7rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '0.74rem', fontWeight: 700, color: '#475569' }}>
          Detected question items ({rows.length})
        </div>
        <ol aria-label="Detected question items" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 190, overflowY: 'auto' }}>
          {rows.map((row) => (
            <li key={`detected-${row._rowIndex}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '0.42rem 0.7rem', borderBottom: '1px solid #f1f5f9', fontSize: '0.72rem' }}>
              <span style={{ flexShrink: 0, color: '#94a3b8', fontWeight: 700 }}>Q{row._rowIndex}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#334155', overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>
                  {row.question_text || 'Question text missing'}
                </div>
                {(() => {
                  const status = answerStatus(row)
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, color: status.ok ? '#059669' : '#dc2626', fontWeight: 700 }}>
                      {status.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                      <span>{status.label}</span>
                    </div>
                  )
                })()}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Scenario info */}
      {withScenario > 0 && (
        <div style={{
          display:      'flex',
          alignItems:   'center',
          gap:          6,
          padding:      '0.4rem 0.7rem',
          background:   '#eff6ff',
          border:       '1px solid #bfdbfe',
          borderRadius: 8,
          fontSize:     '0.76rem',
          color:        '#1e40af',
        }}>
          <BookOpen size={13} style={{ flexShrink: 0 }} />
          <span>
            <strong>{withScenario}</strong> question{withScenario !== 1 ? 's' : ''} include
            a scenario / reading passage.
          </span>
        </div>
      )}

      {/* Missing-answer warning */}
      {missingAnswer > 0 && (
        <div style={{
          display:      'flex',
          alignItems:   'flex-start',
          gap:          6,
          padding:      '0.4rem 0.7rem',
          background:   '#fffbeb',
          border:       '1px solid #fde68a',
          borderRadius: 8,
          fontSize:     '0.76rem',
          color:        '#92400e',
        }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            <strong>{missingAnswer}</strong> MCQ / T-F question{missingAnswer !== 1 ? 's' : ''} have
            no correct answer detected. Review before importing, or mark them manually after.
          </span>
        </div>
      )}

      {/* All good */}
      {missingAnswer === 0 && rows.filter((r) => r._valid).length > 0 && (
        <div style={{
          display:      'flex',
          alignItems:   'center',
          gap:          6,
          padding:      '0.4rem 0.7rem',
          background:   '#f0fdf4',
          border:       '1px solid #bbf7d0',
          borderRadius: 8,
          fontSize:     '0.76rem',
          color:        '#15803d',
        }}>
          <Info size={13} style={{ flexShrink: 0 }} />
          <span>Correct answers detected for all auto-graded questions.</span>
        </div>
      )}
    </div>
  )
}
