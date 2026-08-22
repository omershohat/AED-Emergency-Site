// ============================================================================
//  Landing page (Requirements #4, #13)
// ============================================================================
//  A SERVER component: it fetches the admin-editable copy on the server and
//  sends finished HTML. There is no useState and no event handler on this page,
//  so none of its JavaScript needs to reach the browser.
// ============================================================================
import Link from 'next/link';
import WorkflowDiagram from '@/components/WorkflowDiagram';
import { getContent, getLinks, getStats } from '@/lib/server-data';

// The copy the page falls back to when the api service is unreachable, so the
// landing page is never empty.
const DEFAULTS = {
  hero: {
    title: 'דפיברילטורים בשטח - מיזם התנדבותי',
    body: 'דום לב בשטח הוא מרוץ נגד הזמן: חלון הזהב למתן שוק חשמלי הוא 0-4 דקות. אנחנו ממפים דפיברילטורים ניידים בזמן אמת, ומגייסים את מי שנמצא הכי קרוב.',
    ctaLabel: 'להצטרפות למערך המתנדבים',
    ctaUrl: '/register',
  },
  lora_explainer: {
    title: 'מה זה LoRa בשלוש שורות',
    body: 'LoRa היא טכנולוגיית רדיו לטווח ארוך ובהספק נמוך, שמשדרת בישראל בתדר 433MHz.\n'
      + 'מכשירי Meshtastic מעבירים הודעה ביניהם בקפיצות (mesh), כך שהיא מגיעה גם ללא רשת סלולרית.\n'
      + 'קריאת מצוקה מגיעה כך למכשיר של המתנדב הקרוב, מצפצפת ומהבהבת - גם באמצע הטבע.',
  },
  how_it_works: {
    title: 'איך קריאת מצוקה מגיעה למתנדב',
    body: 'שני מסלולים במקביל: ערוץ LoRa/Meshtastic שמעביר את נקודת ה-GPS דרך רשת המש, וערוץ סלולרי ששולח SMS עם המיקום ומספר הטלפון של הנפגע.',
  },
};

export default async function HomePage() {
  // Three independent requests, so they are started together with Promise.all
  // instead of one after another.
  const [content, mdaLinks, stats] = await Promise.all([
    getContent('home', DEFAULTS),
    getLinks('OFFICIAL_MAP'),
    getStats(),
  ]);

  const mda = mdaLinks[0];

  return (
    <div>
      {/* ================= HERO ================= */}
      <section className="border-b border-slate-200 bg-gradient-to-b from-white to-slate-50">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 md:grid-cols-2 md:py-16">
          <div>
            <span className="mb-3 inline-block rounded-full bg-emergency-light px-3 py-1 text-sm font-semibold text-emergency">
              Pro Bono · מיזם ללא מטרות רווח
            </span>
            <h1 className="text-3xl font-extrabold leading-tight text-slate-900 sm:text-4xl">
              {content.hero.title}
            </h1>
            <p className="mt-4 text-lg leading-relaxed text-slate-700">
              {content.hero.body}
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={content.hero.ctaUrl || '/register'} className="btn-primary">
                {content.hero.ctaLabel || 'להצטרפות למערך המתנדבים'}
              </Link>
              <Link href="/simulator" className="btn-secondary">
                להרצת הסימולטור
              </Link>
            </div>
          </div>

          {/* Live counters straight from the SQL database */}
          <div className="grid grid-cols-3 gap-3">
            <Stat value={stats.responders} label="מתנדבים רשומים" />
            <Stat value={stats.aed_owners} label="נושאי דפיברילטור" />
            <Stat value={stats.lora_owners} label="מכשירי LoRa" />
          </div>
        </div>
      </section>

      {/* ============ THE THREE-LINE LoRa EXPLAINER (req #4) ============ */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-2xl font-bold text-slate-900">{content.lora_explainer.title}</h2>
        <ol className="mt-4 space-y-3">
          {/* The admin stores the explainer as three lines separated by a
              newline; splitting keeps the numbering in the markup rather than
              baked into the text. */}
          {(content.lora_explainer.body || '').split('\n').filter(Boolean).map((line, i) => (
            <li key={i} className="flex gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-lora-light font-bold text-lora">
                {i + 1}
              </span>
              <p className="leading-relaxed text-slate-700">{line}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ================= THE FLOW DIAGRAM (req #4) ================= */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-12">
          <h2 className="text-2xl font-bold text-slate-900">{content.how_it_works.title}</h2>
          <p className="mt-2 max-w-3xl leading-relaxed text-slate-600">{content.how_it_works.body}</p>
          <div className="mt-8">
            <WorkflowDiagram />
          </div>
        </div>
      </section>

      {/* ================= MDA LINK (req #13) ================= */}
      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="card flex flex-col items-start justify-between gap-4 border-r-4 border-r-emergency sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {mda?.label || 'מפת הדפיברילטורים הקבועים של מד״א'}
            </h2>
            <p className="mt-1 max-w-2xl text-slate-600">
              {mda?.description
                || 'מפה רשמית של מד״א ובה מיקומי הדפיברילטורים הציבוריים הקבועים בישראל. המערכת שלנו משלימה אותה במכשירים הניידים שנמצאים בשטח.'}
            </p>
          </div>
          <a
            href={mda?.url || 'https://defi.co.il/#/map'}
            target="_blank"
            // noopener protects against the opened page reaching back through
            // window.opener; noreferrer stops the Referer header leaking.
            rel="noopener noreferrer"
            className="btn-primary shrink-0"
          >
            למפה הרשמית של מד״א ↗
          </a>
        </div>
      </section>

      {/* ================= CLOSING CTA ================= */}
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <CtaCard
            href="/register"
            title="יש לכם דפיברילטור נייד?"
            body="ההרשמה לוקחת דקה, ללא סיסמה וללא פתיחת חשבון. רק שם, נייד, ואם יש - מזהה LoRa."
            cta="להרשמה"
          />
          <CtaCard
            href="/buy"
            title="רוצים להיות זמינים גם ללא קליטה?"
            body="מכשיר LoRa בתדר 433MHz עולה עשרות בודדות של דולרים ומחבר אתכם לרשת המש."
            cta="לרכישת ציוד"
          />
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label }) {
  return (
    <div className="card text-center">
      {/* Digits must stay left-to-right even on a right-to-left page. */}
      <div className="ltr-num text-3xl font-extrabold text-slate-900">{value}</div>
      <div className="mt-1 text-xs leading-tight text-slate-600">{label}</div>
    </div>
  );
}

function CtaCard({ href, title, body, cta }) {
  return (
    <Link href={href} className="card transition hover:-translate-y-0.5 hover:shadow-md">
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-2 leading-relaxed text-slate-600">{body}</p>
      <span className="mt-4 inline-block font-semibold text-emergency">{cta} ←</span>
    </Link>
  );
}
