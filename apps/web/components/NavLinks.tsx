'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/today', label: 'Today' },
  { href: '/log', label: 'Log' },
  { href: '/levers', label: 'Levers' },
  { href: '/plan', label: 'Plan' },
  { href: '/blocks', label: 'Blocks' },
  { href: '/trends', label: 'Trends' },
  { href: '/chat', label: 'Chat' },
  { href: '/dinner', label: 'Dinner' },
  { href: '/onboarding', label: 'Intake' },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
            {label}
          </Link>
        );
      })}
    </>
  );
}
