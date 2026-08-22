// ============================================================================
//  The distress-call flow diagram (Requirement #4)
// ============================================================================
//  Hand-written inline SVG rather than an image file, because:
//    * it stays sharp at any size and in print,
//    * the Hebrew inside it is real text - selectable, and readable by a screen
//      reader - not pixels,
//    * there is no asset to load, so it cannot arrive after the page does.
//
//  The flow reads RIGHT TO LEFT, like the rest of the site: the casualty is on
//  the right, the responder on the left, and the two channels run in parallel
//  between them.
// ============================================================================

const LORA = '#7c3aed';
const CELL = '#0891b2';
const RED = '#dc2626';
const GREEN = '#16a34a';

/** One rounded box with a title and a subtitle. */
function Node({ x, y, w, h, fill, stroke, title, subtitle, emoji }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="14" fill={fill} stroke={stroke} strokeWidth="2" />
      {emoji && (
        <text x={x + w / 2} y={y + 26} textAnchor="middle" fontSize="18">{emoji}</text>
      )}
      <text
        x={x + w / 2} y={y + (emoji ? 48 : 34)}
        textAnchor="middle" fontSize="15" fontWeight="700" fill="#0f172a"
      >
        {title}
      </text>
      {subtitle && (
        <text x={x + w / 2} y={y + (emoji ? 68 : 54)} textAnchor="middle" fontSize="12.5" fill="#475569">
          {subtitle}
        </text>
      )}
    </g>
  );
}

export default function WorkflowDiagram() {
  return (
    // The wrapper scrolls horizontally on a phone instead of shrinking the
    // labels to an unreadable size.
    <div className="overflow-x-auto">
      <svg
        viewBox="0 0 860 400"
        className="h-auto w-full min-w-[680px]"
        role="img"
        aria-label="תרשים זרימה: קריאת מצוקה עוברת בשני ערוצים מקבילים - רשת LoRa בתדר 433MHz, וערוץ סלולרי בהודעת SMS - עד למתנדב הקרוב שמגיע עם דפיברילטור"
      >
        {/* arrowheads, defined once and referenced by every line */}
        <defs>
          {[['ah-lora', LORA], ['ah-cell', CELL], ['ah-red', RED], ['ah-green', GREEN]].map(([id, color]) => (
            <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          ))}
        </defs>

        {/* ---- the casualty, on the right ---- */}
        <Node x={670} y={150} w={170} h={100} fill="#fee2e2" stroke={RED}
          emoji="🆘" title="דום לב בשטח" subtitle="חלון הזהב: 0-4 דקות" />

        {/* ======================= upper branch: LoRa ======================= */}
        <Node x={430} y={30} w={190} h={92} fill="#ede9fe" stroke={LORA}
          emoji="📟" title="מכשיר LoRa אישי" subtitle="שידור נקודת GPS ב-433MHz" />
        <Node x={190} y={30} w={190} h={92} fill="#ede9fe" stroke={LORA}
          emoji="🕸️" title="רשת Meshtastic" subtitle="ההודעה קופצת בין מכשירים" />

        {/* casualty -> LoRa device -> mesh -> responder */}
        <path d="M 670 180 L 620 90" fill="none" stroke={LORA} strokeWidth="2.5" markerEnd="url(#ah-lora)" />
        <path d="M 430 76 L 380 76" fill="none" stroke={LORA} strokeWidth="2.5" markerEnd="url(#ah-lora)" />
        <path d="M 190 90 L 150 165" fill="none" stroke={LORA} strokeWidth="2.5" markerEnd="url(#ah-lora)" />

        <text x={525} y={140} textAnchor="middle" fontSize="12.5" fontWeight="600" fill={LORA}>
          ללא צורך בקליטה סלולרית
        </text>

        {/* ======================= lower branch: cellular =================== */}
        <Node x={430} y={278} w={190} h={92} fill="#cffafe" stroke={CELL}
          emoji="📱" title="טלפון סלולרי" subtitle="יש קליטה ברשת" />
        <Node x={190} y={278} w={190} h={92} fill="#cffafe" stroke={CELL}
          emoji="✉️" title="הודעת SMS" subtitle="מיקום + מספר הטלפון של הנפגע" />

        <path d="M 670 220 L 620 324" fill="none" stroke={CELL} strokeWidth="2.5" markerEnd="url(#ah-cell)" />
        <path d="M 430 324 L 380 324" fill="none" stroke={CELL} strokeWidth="2.5" markerEnd="url(#ah-cell)" />
        <path d="M 190 310 L 150 235" fill="none" stroke={CELL} strokeWidth="2.5" markerEnd="url(#ah-cell)" />

        {/* ---- the responder, on the left, where both branches arrive ---- */}
        <Node x={20} y={150} w={170} h={100} fill="#dcfce7" stroke={GREEN}
          emoji="🚴" title="המתנדב הקרוב" subtitle="ניווט במסלולי אופניים" />

        {/* the radius rule, written on the diagram so it is not folklore */}
        <text x={430} y={200} textAnchor="middle" fontSize="13" fontWeight="700" fill="#0f172a">
          המערכת דוגמת מתנדבים ברדיוס שהוגדר
        </text>
        <text x={430} y={222} textAnchor="middle" fontSize="12.5" fill="#475569">
          ומעדיפה את מי שנושא דפיברילטור וזמין לתקשורת
        </text>
      </svg>
    </div>
  );
}
