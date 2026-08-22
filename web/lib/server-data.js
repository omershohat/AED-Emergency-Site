// ============================================================================
//  Server-side data loading for the pages that render on the server.
// ============================================================================
//  These run inside the Next.js server, not in the browser, so the HTML that
//  reaches the visitor already contains the text. Good for first paint and for
//  search engines.
//
//  Every function here degrades instead of throwing. If the api service is not
//  running, the landing page must still render with its built-in copy - a
//  marketing page that shows a stack trace because a database is down is worse
//  than one showing slightly stale text.
// ============================================================================
import { API_URL } from './config.js';

async function safeFetch(path, fallback) {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      // no-store: the admin can edit this copy at any moment, and a cached page
      // would keep serving the old text after they saved.
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

/** Editable copy for one page, merged over the built-in defaults. */
export async function getContent(pageKey, defaults = {}) {
  const data = await safeFetch(`/content/${pageKey}`, { blocks: {} });
  const blocks = { ...defaults };
  for (const [key, value] of Object.entries(data.blocks || {})) {
    // Only overwrite a default when the admin actually put something there.
    blocks[key] = {
      title: value.title || defaults[key]?.title || null,
      body: value.body || defaults[key]?.body || null,
      ctaLabel: value.ctaLabel || defaults[key]?.ctaLabel || null,
      ctaUrl: value.ctaUrl || defaults[key]?.ctaUrl || null,
    };
  }
  return blocks;
}

export async function getLinks(category) {
  return safeFetch(`/content/links/${category}`, []);
}

export async function getStats() {
  return safeFetch('/responders/stats', { responders: 0, aed_owners: 0, lora_owners: 0 });
}
