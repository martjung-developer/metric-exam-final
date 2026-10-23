import Link from 'next/link'
import { createElement } from 'react'

export default function UnauthorizedPage() {
  return createElement(
    'main',
    {
      style: {
        display: 'flex',
        minHeight: '100vh',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1rem',
        padding: '1.5rem',
        textAlign: 'center',
      },
    },
    createElement('h1', { style: { fontSize: '2rem', fontWeight: 700 } }, 'Access Denied'),
    createElement(
      'p',
      { style: { color: '#666' } },
      "You don't have permission to view this page.",
    ),
    createElement(
      Link,
      { href: '/auth/login', style: { color: '#3b82f6', textDecoration: 'underline' } },
      'Back to login',
    ),
  )
}
