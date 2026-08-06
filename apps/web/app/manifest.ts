import type { MetadataRoute } from 'next';

/**
 * PWA manifest: installable to the home screen, opening straight into Today —
 * the daily loop is one tap. No offline service worker: every page is a
 * function of the live event log and today's date, so a stale cache would
 * show a stale decision.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Peakspan',
    short_name: 'Peakspan',
    description: 'Lifelong training capacity, decided by a pure engine.',
    start_url: '/today',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#2563eb',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
