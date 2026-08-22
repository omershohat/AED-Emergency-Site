'use client';
// ============================================================================
//  Site header. Mobile-first (Requirement #7): the links collapse into a
//  toggle below the `md` breakpoint and sit in a row above it.
// ============================================================================
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const NAV = [
  { href: '/', label: 'ראשי' },
  { href: '/emergency', label: 'קריאת מצוקה', highlight: true },
  { href: '/cpr', label: 'הוראות החייאה' },
  { href: '/simulator', label: 'סימולטור' },
  { href: '/register', label: 'הרשמה' },
  { href: '/buy', label: 'ציוד LoRa' },
];

export default function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
          <span className="text-2xl" aria-hidden="true">❤️‍🩹</span>
          <span className="leading-tight">
            דפיברילטורים בשטח
            <span className="block text-xs font-normal text-slate-500">מיזם התנדבותי</span>
          </span>
        </Link>

        {/* Desktop navigation */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <NavLink key={item.href} item={item} active={pathname === item.href} />
          ))}
          <Link href="/admin" className="ms-2 rounded-lg px-3 py-2 text-sm text-slate-500 hover:text-slate-900">
            ניהול
          </Link>
        </nav>

        {/* Mobile toggle. aria-expanded tells a screen reader whether the menu
            is open - an icon alone communicates nothing to it. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-slate-300 p-2 md:hidden"
          aria-expanded={open}
          aria-label="תפריט"
        >
          <span className="block h-0.5 w-5 bg-slate-800" />
          <span className="mt-1 block h-0.5 w-5 bg-slate-800" />
          <span className="mt-1 block h-0.5 w-5 bg-slate-800" />
        </button>
      </div>

      {open && (
        <nav className="border-t border-slate-200 bg-white px-4 pb-3 md:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`block rounded-lg px-3 py-3 ${
                item.highlight ? 'font-semibold text-emergency' : 'text-slate-700'
              }`}
            >
              {item.label}
            </Link>
          ))}
          <Link href="/admin" onClick={() => setOpen(false)} className="block px-3 py-3 text-slate-500">
            ניהול
          </Link>
        </nav>
      )}
    </header>
  );
}

function NavLink({ item, active }) {
  return (
    <Link
      href={item.href}
      className={`rounded-lg px-3 py-2 text-sm transition ${
        item.highlight
          ? 'font-semibold text-emergency hover:bg-emergency-light'
          : 'text-slate-700 hover:bg-slate-100'
      } ${active ? 'bg-slate-100' : ''}`}
    >
      {item.label}
    </Link>
  );
}
