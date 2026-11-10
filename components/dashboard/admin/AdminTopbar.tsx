// components/dashboard/admin/AdminTopbar.tsx
//
// FIXED:
//  - Shows real avatar image from profiles.avatar_url (not just initials)
//  - Falls back to initials if no avatar
//  - Subscribes to realtime profile changes so avatar updates instantly
//  - Correctly fetches full_name + avatar_url in one query

'use client'

import { useEffect, useState } from 'react'
import Image                   from 'next/image'
import Link                    from 'next/link'
import { usePathname } from 'next/navigation'
import { Search, Bell, Settings, ChevronDown, GraduationCap, UserCircle2, LogOut } from 'lucide-react'
import { useUser } from '@/lib/context/AuthContext'
import { useUnreadCount }      from '@/lib/hooks/notifications/useUnreadCount'
import { useRealtimeNotificationAlerts } from '@/lib/hooks/notifications/useRealtimeNotificationAlerts'
import ThemeToggleButton from '@/components/shared/dashboard/ThemeToggleButton'
import styles                  from './AdminTopbar.module.css'

function getInitials(name: string | null): string {
  if (!name) {return 'FA'}
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export default function AdminTopbar() {
  const { profile, user } = useUser()
  const [search,      setSearch]      = useState('')
  const [menuOpen,    setMenuOpen]    = useState(false)
  const pathname = usePathname()
  const userId = user?.id ?? null
  const facultyName = profile?.full_name ?? 'Faculty'
  const avatarUrl = profile?.avatar_url ?? null
  const unreadCount = useUnreadCount(userId)
  useRealtimeNotificationAlerts(userId)
  const initials    = getInitials(profile?.full_name ?? null)
  const inFaculty = pathname.startsWith('/faculty')
  const notificationHref = inFaculty ? '/faculty/notifications' : '/admin/notifications'
  const settingsHref = inFaculty ? '/faculty/settings' : '/admin/settings'
  const roleLabel = inFaculty ? 'Faculty' : 'Admin'

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target) { return }
      if (!target.closest('[data-topbar-profile-menu="admin"]')) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('click', onDocClick)
      return () => document.removeEventListener('click', onDocClick)
    }
  }, [menuOpen])

  async function handleLogout() {
    window.location.href = '/api/auth/signout'
  }

  return (
    <header className={styles.topbar}>

      {/* ── Left: search ── */}
      <div className={styles.left}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}><Search size={14} /></span>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Search students, exams, programs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Right: actions ── */}
      <div className={styles.right}>

        <span className={styles.rolePill}>
          <GraduationCap size={11} />
          {roleLabel}
        </span>

        <ThemeToggleButton className={styles.iconBtn} />

        <Link
          href={notificationHref}
          prefetch={false}
          className={styles.iconBtn}
          title={unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'Notifications'}
          aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
        >
          <Bell size={15} />
          {unreadCount > 0 && (
            <span className={styles.notifDot} aria-hidden="true">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Link>

        <Link href={settingsHref} prefetch={false} className={styles.iconBtn} title="Settings">
          <Settings size={15} />
        </Link>

        {/* Avatar — image or initials fallback */}
        <div className={styles.profileMenuWrap} data-topbar-profile-menu="admin">
        <button
          className={styles.avatarBtn}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <div className={styles.avatarCircle}>
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={facultyName ?? 'Avatar'}
                width={32}
                height={32}
                className={styles.avatarImg}
                unoptimized
              />
            ) : (
              initials
            )}
          </div>
          <span className={styles.avatarName}>{facultyName ?? 'Faculty'}</span>
          <ChevronDown size={12} className={styles.avatarChevron} />
        </button>
          {menuOpen && (
            <div className={styles.profileMenu} role="menu">
              <Link href={settingsHref} className={styles.profileMenuItem} role="menuitem" onClick={() => setMenuOpen(false)}>
                <UserCircle2 size={14} /> Account Settings
              </Link>
              <button type="button" className={`${styles.profileMenuItem} ${styles.profileMenuDanger}`} onClick={handleLogout} role="menuitem">
                <LogOut size={14} /> Logout
              </button>
            </div>
          )}
        </div>

      </div>
    </header>
  )
}
