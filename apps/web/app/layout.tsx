import type { Metadata, Viewport } from 'next';
import { NavLinks } from '../components/NavLinks';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Peakspan', template: '%s · Peakspan' },
  description: 'Lifelong training capacity, decided by a pure engine.',
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: { capable: true, title: 'Peakspan', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="top">
          <span className="brand">Peakspan</span>
          <NavLinks />
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
