'use client';
// ============================================================================
//  Admin panel (Requirements #3, #12)
// ============================================================================
//  Three jobs on one screen:
//    * the registration database - search, edit, activate/deactivate, delete,
//    * the marketing copy        - edited here, rendered by the public pages,
//    * the external links        - the MDA map and the LoRa vendors.
//
//  Every request from this page goes through api.* with auth:true, so it
//  carries the Bearer token and renews it silently when it expires.
// ============================================================================
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import RespondersTab from './RespondersTab';
import ContentTab from './ContentTab';
import LinksTab from './LinksTab';

const TABS = [
  { id: 'responders', label: 'מאגר המתנדבים' },
  { id: 'content', label: 'תוכן שיווקי' },
  { id: 'links', label: 'קישורים חיצוניים' },
];

export default function AdminPage() {
  const { admin, logout } = useAuth();
  const [tab, setTab] = useState('responders');

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900">פאנל ניהול</h1>
          <p className="mt-1 text-slate-600">
            מחובר/ת כ־<strong>{admin.displayName || admin.username}</strong>
          </p>
        </div>
        <button type="button" onClick={logout} className="btn-secondary">
          התנתקות
        </button>
      </header>

      {/* role="tablist" and aria-selected let a screen reader announce this as
          a tab strip rather than as three unrelated buttons. */}
      <div role="tablist" className="mt-6 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-xl px-4 py-3 text-sm font-semibold transition ${
              tab === t.id
                ? 'border-b-2 border-b-emergency text-emergency'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="py-6">
        {tab === 'responders' && <RespondersTab />}
        {tab === 'content' && <ContentTab />}
        {tab === 'links' && <LinksTab />}
      </div>
    </div>
  );
}
