// ============================================================================
//  CPR Instructions page — step-by-step guide for bystander resuscitation.
// ============================================================================
//  A SERVER component: purely informational, no client-side interactivity.
//  Two scenarios are covered: CPR with an AED, and without one.
//  All content is in Hebrew with RTL layout (inherited from the root layout).
//
//  Every step has an accompanying illustration stored in /public/images/cpr/.
//  Layout is responsive: images stack above text on mobile, side-by-side on
//  desktop — so the page works as a clear visual guide even on a phone.
// ============================================================================
import Image from 'next/image';

export const metadata = {
  title: 'הוראות החייאה | דפיברילטורים בשטח',
  description:
    'מדריך החייאה (CPR) צעד-אחר-צעד — עם דפיברילטור ובלעדיו. פעולות ראשונות, עיסויי חזה, ושימוש במכשיר AED.',
};

export default function CprPage() {
  return (
    <div>
      {/* ============ PAGE HEADER ============ */}
      <section className="border-b border-slate-200 bg-gradient-to-b from-white to-slate-50">
        <div className="mx-auto max-w-4xl px-4 py-12 text-center">
          <span className="mb-3 inline-block rounded-full bg-emergency-light px-3 py-1 text-sm font-semibold text-emergency">
            מדריך חירום · הצילו חיים
          </span>
          <h1 className="text-3xl font-extrabold leading-tight text-slate-900 sm:text-4xl">
            הוראות החייאה (CPR)
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-slate-600">
            דום לב פתאומי יכול לקרות בכל מקום. הידע והנכונות לפעול בדקות
            הראשונות הם ההבדל בין חיים למוות. מדריך זה מיועד לציבור הרחב —
            גם אם מעולם לא עברתם הכשרה.
          </p>
        </div>
      </section>

      {/* ============ SECTION 1: IMMEDIATE ACTIONS ============ */}
      <section className="mx-auto max-w-4xl px-4 py-12">
        <SectionHeading
          icon="⏱️"
          title="פעולות מיידיות — &quot;חלון הזהב&quot;"
          subtitle="ב-4 הדקות הראשונות לאחר דום לב, הסיכוי להציל חיים הוא הגבוה ביותר. כל דקה שעוברת ללא טיפול מפחיתה את הסיכוי בכ-10%."
        />

        <div className="mt-6 space-y-4">
          <StepCard
            number={1}
            title="וודאו שהמקום בטוח"
            description="לפני שנוגעים בנפגע — הסתכלו סביב. האם יש סכנה לכם? (תנועה, חשמל, שריפה). אם המקום מסוכן — הרחיקו את הנפגע או חכו לכוחות ההצלה."
            image="/images/cpr/scene-safety.jpg"
            imageAlt="איור: סריקת הסביבה לפני גישה לנפגע"
          />
          <StepCard
            number={2}
            title="בדקו הכרה"
            description="טפחו בעדינות על הכתפיים ושאלו בקול רם: &quot;אתה שומע אותי?&quot;. אם אין תגובה — הנפגע מחוסר הכרה."
            image="/images/cpr/check-response.jpg"
            imageAlt="איור: בדיקת הכרה של נפגע"
          />
          <StepCard
            number={3}
            title="קראו מיד לעזרה — חייגו 101"
            description="חייגו 101 (מד&quot;א) או בקשו ממישהו ספציפי לחייג. הפעילו רמקול כדי שתוכלו לקבל הוראות תוך כדי מתן טיפול. בקשו גם שמישהו יביא דפיברילטור (AED) אם יש בסביבה."
            image="/images/cpr/call-emergency.jpg"
            imageAlt="איור: חיוג לשירותי חירום 101"
          />
        </div>
      </section>

      {/* ============ SECTION 2: CPR WITHOUT AED ============ */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-12">
          <SectionHeading
            icon="🫁"
            title="החייאה ללא דפיברילטור"
            subtitle="עיסוי לב-ריאה (CPR) שומר על זרימת דם למוח ולאיברים חיוניים עד הגעת צוות רפואי. גם ללא הכשרה — עיסוי חזה בלבד מציל חיים."
          />

          <div className="mt-6 space-y-4">
            <StepCard
              number={1}
              title="שכבו את הנפגע על גב, על משטח קשה"
              description="ודאו שהנפגע שוכב על הגב על משטח קשיח ושטוח (רצפה, מדרכה). מיטה או ספה רכות מדי ויבלעו את כוח הלחיצה."
              image="/images/cpr/lay-flat.jpg"
              imageAlt="איור: השכבת נפגע על משטח קשה"
            />
            <StepCard
              number={2}
              title="מיקום ידיים — מרכז החזה"
              description="הניחו את בסיס כף היד (העקב) על מרכז עצם החזה (בין הפטמות). שלבו את היד השנייה מעל, נעלו אצבעות. הכתפיים ישירות מעל הידיים, מרפקים נעולים וישרים."
              image="/images/cpr/chest-compressions.jpg"
              imageAlt="איור: מיקום ידיים נכון לעיסוי חזה"
            />
            <StepCard
              number={3}
              title="לחצו חזק ומהר"
              description="לחצו לעומק של לפחות 5 ס&quot;מ (אבל לא יותר מ-6 ס&quot;מ). קצב: 100-120 לחיצות בדקה — קצב של השיר &quot;Stayin' Alive&quot;. אפשרו לחזה לעלות חזרה לגמרי בין לחיצה ללחיצה."
              image="/images/cpr/push-hard-fast.jpg"
              imageAlt="איור: לחיצות חזה חזקות ומהירות"
            />
            <StepCard
              number={4}
              title="הנשמות (אם אתם מיומנים)"
              description="אם עברתם הכשרה — כל 30 לחיצות תנו 2 הנשמות: הטו את הראש לאחור, הרימו את הסנטר, צבטו את האף ונשפו לתוך הפה למשך שנייה. אם לא עברתם הכשרה — המשיכו בלחיצות חזה בלבד, ללא הפסקה."
              image="/images/cpr/rescue-breaths.jpg"
              imageAlt="איור: הנשמה מפה לפה"
            />
            <StepCard
              number={5}
              title="אל תפסיקו!"
              description="המשיכו בלחיצות עד שמגיע צוות מד&quot;א, הנפגע מתחיל לנשום או לזוז, או שהגיע דפיברילטור. אם אתם מתעייפים — בקשו ממישהו להחליף אתכם כל 2 דקות."
              image="/images/cpr/dont-stop.jpg"
              imageAlt="איור: החלפת מציל להמשך לחיצות ללא הפסקה"
            />
          </div>
        </div>
      </section>

      {/* ============ SECTION 3: CPR WITH AED ============ */}
      <section className="mx-auto max-w-4xl px-4 py-12">
        <SectionHeading
          icon="⚡"
          title="החייאה עם דפיברילטור (AED)"
          subtitle="דפיברילטור (AED) הוא מכשיר שמנתח את קצב הלב ומספק שוק חשמלי אם צריך. הוא מדבר אליכם ומנחה כל צעד — אי אפשר לטעות."
        />

        <div className="mt-6 space-y-4">
          <StepCard
            number={1}
            title="הפעילו את המכשיר מיד"
            description="לחצו על כפתור ההפעלה (או פתחו את המכסה — חלק מהמכשירים נדלקים אוטומטית). המכשיר יתחיל לדבר אליכם עם הוראות קוליות. הקשיבו ופעלו לפיהן."
            accent
            image="/images/cpr/aed-device.jpg"
            imageAlt="איור: מכשיר דפיברילטור (AED) פתוח ומוכן לשימוש"
          />
          <StepCard
            number={2}
            title="חשפו את החזה והדביקו את הפדים"
            description="הסירו בגדים מהחזה. הדביקו את שני הפדים (אלקטרודות) לפי התמונות שעליהם: פד אחד מתחת לעצם הבריח הימנית, פד שני מתחת לבית השחי השמאלי. ודאו שהפדים צמודים היטב ושהעור יבש."
            accent
            image="/images/cpr/pad-placement.jpg"
            imageAlt="איור: מיקום הדבקת פדים על החזה"
          />
          <StepCard
            number={3}
            title="הפסיקו לחיצות — אל תיגעו בנפגע"
            description="המכשיר מנתח את קצב הלב. חשוב מאוד לא לגעת בנפגע בזמן הניתוח — כל מגע עלול לשבש את הקריאה. ודאו שאף אחד אחר לא נוגע."
            accent
            image="/images/cpr/stand-clear.jpg"
            imageAlt="איור: הרחקת ידיים מהנפגע בזמן ניתוח קצב הלב"
          />
          <StepCard
            number={4}
            title="שוק חשמלי — אם המכשיר ממליץ"
            description="אם המכשיר מודיע &quot;מומלץ שוק&quot; — ודאו שאף אחד לא נוגע ולחצו על כפתור השוק (הכפתור המהבהב). מכשירים אוטומטיים לחלוטין יספקו את השוק בעצמם. אם המכשיר אומר &quot;שוק לא מומלץ&quot; — המשיכו מיד בלחיצות חזה."
            accent
            image="/images/cpr/shock-button.jpg"
            imageAlt="איור: לחיצה על כפתור השוק במכשיר AED"
          />
          <StepCard
            number={5}
            title="חזרו מיד ללחיצות חזה"
            description="מיד אחרי השוק (או אם לא ניתן שוק) — חזרו ללחיצות חזה ברצף של 2 דקות. המכשיר יודיע כשהגיע הזמן לניתוח נוסף. המשיכו לפעול לפי ההוראות הקוליות עד הגעת צוות מד&quot;א."
            accent
            image="/images/cpr/resume-compressions.jpg"
            imageAlt="איור: חזרה ללחיצות חזה אחרי שוק"
          />
        </div>
      </section>

      {/* ============ BOTTOM CTA ============ */}
      <section className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-4xl px-4 py-12 text-center">
          <h2 className="text-2xl font-bold text-slate-900">
            כל שנייה קובעת
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-600">
            שמרו את הדף הזה. שתפו אותו. ביום שתצטרכו — תדעו מה לעשות.
          </p>
          <p className="mt-6 text-sm text-slate-400">
            תוכן זה מבוסס על הנחיות האגודה האמריקנית ללב (AHA) ומד&quot;א ישראל.
            הוא מיועד לציבור הרחב ואינו מחליף הכשרת עזרה ראשונה.
          </p>
        </div>
      </section>
    </div>
  );
}

// ===========================================================================
//  Sub-components
// ===========================================================================

/** Section heading with emoji icon, title, and subtitle. */
function SectionHeading({ icon, title, subtitle }) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
        <span className="text-3xl" aria-hidden="true">{icon}</span>
        <span dangerouslySetInnerHTML={{ __html: title }} />
      </h2>
      {subtitle && (
        <p className="mt-2 max-w-3xl leading-relaxed text-slate-600">
          {subtitle}
        </p>
      )}
    </div>
  );
}

/**
 * A numbered step card with optional accent border and illustration image.
 *
 * Layout (RTL-aware, responsive):
 *   Mobile  → illustration stacks ABOVE the text content
 *   Desktop → illustration sits beside the text (md:flex-row)
 */
function StepCard({ number, title, description, accent = false, image = null, imageAlt = '' }) {
  return (
    <div
      className={`card overflow-hidden ${
        accent ? 'border-s-4 border-s-emergency' : ''
      }`}
    >
      <div className={`flex flex-col gap-5 ${image ? 'md:flex-row md:items-center' : ''}`}>
        {/* Illustration */}
        {image && (
          <div className="flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-50 md:w-48">
            <Image
              src={image}
              alt={imageAlt}
              width={400}
              height={300}
              className="h-auto w-full object-contain"
            />
          </div>
        )}

        {/* Text content */}
        <div className="flex flex-1 gap-4">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold ${
              accent
                ? 'bg-emergency-light text-emergency'
                : 'bg-slate-100 text-slate-700'
            }`}
          >
            {number}
          </span>
          <div>
            <h3 className="font-bold text-slate-900">{title}</h3>
            <p className="mt-1 leading-relaxed text-slate-600">{description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
