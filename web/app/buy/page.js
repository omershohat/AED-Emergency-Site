// ============================================================================
//  Commercial / marketing section (Requirements #13, #14)
// ============================================================================
//  The links are NOT hardcoded here - they come from the external_links table,
//  which the admin edits from the panel. Adding a fourth vendor is a form
//  submission, not a code change.
// ============================================================================
import Link from 'next/link';
import { getContent, getLinks } from '@/lib/server-data';

const DEFAULTS = {
  intro: {
    title: 'רכישת ציוד LoRa',
    body: 'כדי להיות זמינים גם ללא קליטה סלולרית, נדרש מכשיר LoRa שעובד בתדר 433MHz - התדר החופשי לשימוש בישראל.',
  },
};

export const metadata = {
  title: 'ציוד LoRa 433MHz | דפיברילטורים בשטח',
};

export default async function BuyPage() {
  const [content, vendors, mdaLinks, learn] = await Promise.all([
    getContent('buy', DEFAULTS),
    getLinks('BUY_LORA'),
    getLinks('OFFICIAL_MAP'),
    getLinks('LEARN'),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-extrabold text-slate-900">{content.intro.title}</h1>
      <p className="mt-3 max-w-3xl text-lg leading-relaxed text-slate-700">{content.intro.body}</p>

      {/* The 433MHz emphasis requirement #14 asks for - stated once, loudly,
          at the top, instead of being buried in each card. */}
      <div className="mt-6 rounded-2xl border-2 border-lora bg-lora-light p-5">
        <h2 className="flex items-center gap-2 text-xl font-bold text-lora">
          <span aria-hidden="true">📡</span>
          שימו לב לתדר: <span className="ltr-num">433MHz</span>
        </h2>
        <p className="mt-2 leading-relaxed text-slate-700">
          אותו דגם מכשיר נמכר בכמה תדרים (<span className="ltr-num">433 / 868 / 915MHz</span>).
          מכשיר בתדר אחר <strong>לא יתחבר</strong> לרשת המש הישראלית ולא יקבל קריאות מצוקה.
          לפני הזמנה - ודאו שכתוב במפורש <span className="ltr-num font-semibold">433MHz</span>.
        </p>
      </div>

      {/* ---------------- vendors (requirement #14: at least 3) ------------- */}
      <h2 className="mt-10 text-2xl font-bold text-slate-900">היכן קונים</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {vendors.map((link) => (
          <article key={link.id} className="card flex flex-col">
            <div className="text-sm font-semibold text-slate-500">{link.vendor}</div>
            <h3 className="mt-1 text-lg font-bold text-slate-900">{link.label}</h3>
            {link.frequencyNote && (
              <span className="mt-2 inline-block w-fit rounded-full bg-lora-light px-3 py-1 text-xs font-semibold text-lora">
                {link.frequencyNote}
              </span>
            )}
            <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-600">{link.description}</p>
            <a
              href={link.url} target="_blank" rel="noopener noreferrer"
              className="btn-secondary mt-4 w-full"
            >
              לאתר היצרן ↗
            </a>
          </article>
        ))}

        {vendors.length === 0 && (
          <p className="text-slate-500">
            לא נמצאו ספקים. ודאו ששרת הרישום פועל, או הוסיפו ספקים מפאנל הניהול.
          </p>
        )}
      </div>

      {/* ---------------- learn more ---------------- */}
      {learn.length > 0 && (
        <>
          <h2 className="mt-10 text-2xl font-bold text-slate-900">להעמיק בטכנולוגיה</h2>
          <ul className="mt-4 space-y-2">
            {learn.map((link) => (
              <li key={link.id} className="card">
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-900 hover:text-emergency">
                  {link.label} ↗
                </a>
                {link.description && <p className="mt-1 text-sm text-slate-600">{link.description}</p>}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* ---------------- MDA (requirement #13, repeated here on purpose) --- */}
      {mdaLinks[0] && (
        <div className="card mt-10 border-r-4 border-r-emergency">
          <h2 className="text-xl font-bold text-slate-900">{mdaLinks[0].label}</h2>
          <p className="mt-1 text-slate-600">{mdaLinks[0].description}</p>
          <a href={mdaLinks[0].url} target="_blank" rel="noopener noreferrer" className="btn-primary mt-4">
            למפה הרשמית של מד״א ↗
          </a>
        </div>
      )}

      <div className="mt-10 text-center">
        <p className="text-slate-600">כבר יש לכם מכשיר?</p>
        <Link href="/register" className="btn-primary mt-3">להרשמה למערך המתנדבים</Link>
      </div>
    </div>
  );
}
