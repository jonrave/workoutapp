import type { Metadata } from 'next';
import { NavLinks } from '../components/NavLinks';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Peakspan', template: '%s · Peakspan' },
  description: 'Lifelong training capacity, decided by a pure engine.',
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
