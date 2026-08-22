// ============================================================================
//  Root layout - wraps every page in the application.
// ============================================================================
//  Requirement #2 lives on the very first line of the markup:
//      lang="he"  tells the browser and screen readers this is Hebrew
//      dir="rtl"  flips the whole document to right-to-left
//
//  Because the direction is declared HERE, and every component uses Tailwind's
//  logical utilities (ps-/pe-/ms-/me-/text-start) instead of left/right, not a
//  single page needs its own RTL handling.
// ============================================================================
import './globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export const metadata = {
  title: 'דפיברילטורים בשטח | מיזם התנדבותי',
  description:
    'מיפוי דפיברילטורים ניידים בזמן אמת, עם ערוץ תקשורת LoRa בתדר 433MHz לאזורים ללא קליטה סלולרית.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <body className="flex min-h-screen flex-col font-sans">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
