import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Peakspan',
  description: 'Lifelong training capacity, decided by a pure engine.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="top">
          <span className="brand">Peakspan</span>
          <Link href="/today">Today</Link>
          <Link href="/log">Log</Link>
          <Link href="/levers">Levers</Link>
          <Link href="/plan">Plan</Link>
          <Link href="/blocks">Blocks</Link>
          <Link href="/trends">Trends</Link>
          <Link href="/onboarding">Intake</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
