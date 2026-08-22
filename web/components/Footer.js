// ============================================================================
//  Footer. A server component - it has no state and no browser API, so there
//  is no reason to ship its JavaScript to the client.
// ============================================================================
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <h3 className="mb-2 font-bold text-slate-900">דפיברילטורים בשטח</h3>
          <p className="text-sm leading-relaxed text-slate-600">
            מיזם התנדבותי (Pro Bono) למיפוי דפיברילטורים ניידים בזמן אמת,
            עם ערוץ תקשורת גיבוי ברשת LoRa בתדר 433MHz.
          </p>
        </div>

        <div>
          <h3 className="mb-2 font-bold text-slate-900">ניווט</h3>
          <ul className="space-y-1 text-sm text-slate-600">
            <li><Link href="/register" className="hover:text-slate-900">הרשמה למערך המתנדבים</Link></li>
            <li><Link href="/emergency" className="hover:text-slate-900">קריאת מצוקה פעילה</Link></li>
            <li><Link href="/simulator" className="hover:text-slate-900">סימולטור</Link></li>
            <li><Link href="/buy" className="hover:text-slate-900">רכישת ציוד LoRa</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="mb-2 font-bold text-slate-900">חשוב לדעת</h3>
          <p className="text-sm leading-relaxed text-slate-600">
            האתר אינו תחליף לחיוג <span className="ltr-num font-semibold">101</span> למד״א.
            בכל מקרה חירום — חייגו קודם כול למוקד.
          </p>
        </div>
      </div>

      <div className="border-t border-slate-200 py-4 text-center text-xs text-slate-500">
        פרויקט גמר בפיתוח WEB — המכללה האקדמית אפקה
      </div>
    </footer>
  );
}
