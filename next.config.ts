// next.config.ts
import withBundleAnalyzer from '@next/bundle-analyzer'
import type { NextConfig } from 'next'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require('next-pwa')

const supabaseStorageHost = (() => {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!rawUrl) {
    return undefined
  }
  try {
    return new URL(rawUrl).hostname
  } catch {
    return undefined
  }
})()

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  allowedDevOrigins: ['*.ngrok-free.dev'],

  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
    remotePatterns: [
      {
        protocol: 'https' as const,
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.pexels.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'upload.wikimedia.org',
        pathname: '/**',
      },
      ...(supabaseStorageHost ? [{
        protocol: 'https',
        hostname: supabaseStorageHost,
        pathname: '/storage/v1/object/public/**',
      }] : []),
    ],
  },

  turbopack: {
    root: __dirname,
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },

  serverExternalPackages: ['mammoth', 'bcryptjs'],

  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'framer-motion',
      'recharts',
      'three',
    ],
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }]
  },
}

const pwaConfig = withPWA({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
})

export default withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})(pwaConfig(nextConfig))
