// Site-specific URL parsers and chapter detection logic

export const SITES = {
  WEEBCENTRAL: 'weebcentral',
  MANGADEX: 'mangadex',
  MANGAPLUS: 'mangaplus',
};

export const SITE_CONFIG = {
  [SITES.WEEBCENTRAL]: {
    name: 'WeebCentral',
    domains: ['weebcentral.com'],
    // WeebCentral uses UUID-based chapter IDs: /chapters/{uuid}
    // Series pages: /series/{id}
    chapterUrlPattern: /weebcentral\.com\/chapters\/([A-Z0-9]+)/i,
    seriesUrlPattern: /weebcentral\.com\/series\/([A-Z0-9]+)/i,
  },
  [SITES.MANGADEX]: {
    name: 'MangaDex',
    domains: ['mangadex.org'],
    // MangaDex chapter URLs: /chapter/{uuid}
    chapterUrlPattern: /mangadex\.org\/chapter\/([0-9a-f-]{36})/,
  },
  [SITES.MANGAPLUS]: {
    name: 'MangaPlus',
    domains: ['mangaplus.shueisha.co.jp'],
    // MangaPlus chapter URLs: /viewer/{chapter_id}
    chapterUrlPattern: /mangaplus\.shueisha\.co\.jp\/viewer\/(\d+)/,
  },
};

/**
 * Detect which supported site the URL belongs to.
 * @param {string} url
 * @returns {string|null} Site key or null if unsupported
 */
export function detectSite(url) {
  for (const [siteKey, config] of Object.entries(SITE_CONFIG)) {
    if (config.domains.some(domain => url.includes(domain))) {
      return siteKey;
    }
  }
  return null;
}

/**
 * Check if the URL is a chapter page (not just a series/browse page).
 * @param {string} url
 * @param {string} site
 * @returns {boolean}
 */
export function isChapterPage(url, site) {
  const config = SITE_CONFIG[site];
  if (!config) return false;
  return config.chapterUrlPattern.test(url);
}

/**
 * Extract raw ID from URL (UUID for MangaDex/WeebCentral, numeric for MangaPlus).
 * @param {string} url
 * @param {string} site
 * @returns {string|null}
 */
export function extractChapterId(url, site) {
  const config = SITE_CONFIG[site];
  if (!config) return null;
  const match = url.match(config.chapterUrlPattern);
  return match ? match[1] : null;
}

/**
 * Parse chapter info from the page DOM — used as the primary source for
 * WeebCentral/MangaPlus where URLs are opaque IDs, and as fallback elsewhere.
 *
 * @param {Document} doc
 * @param {string} site
 * @returns {{ title: string|null, chapter: number|null }}
 */
export function parseMangaInfoFromDOM(doc, site) {
  let title = null;
  let chapter = null;

  if (site === SITES.WEEBCENTRAL) {
    // WeebCentral page title format: "Series Name - Chapter N | WeebCentral"
    // Breadcrumb: <a> tags in a nav/breadcrumb element
    const breadcrumbs = doc.querySelectorAll('nav a, .breadcrumb a, [aria-label="breadcrumb"] a');
    for (const crumb of breadcrumbs) {
      const text = crumb.textContent.trim();
      if (text && !text.toLowerCase().includes('home') && !text.toLowerCase().includes('chapter')) {
        title = title || text;
      }
    }

    // Try page <title>
    if (!title) {
      const pageTitle = doc.title;
      const titleMatch = pageTitle.match(/^(.+?)\s*[-–|]\s*(?:Chapter|Ch\.?)\s*[\d.]+/i);
      if (titleMatch) title = titleMatch[1].trim();
    }

    // Try h1/h2 for series name
    if (!title) {
      const heading = doc.querySelector('h1, h2, .series-name, .manga-title');
      if (heading) title = heading.textContent.trim();
    }
  }

  if (site === SITES.MANGAPLUS) {
    // MangaPlus: series title and chapter in page header
    const titleEl = doc.querySelector('.title-detail-view-title, .title-name, h1.title');
    if (titleEl) title = titleEl.textContent.trim();

    const chapterEl = doc.querySelector('.episode-title, .chapter-title, .viewer-title h1');
    if (chapterEl) {
      const chMatch = chapterEl.textContent.match(/(?:Chapter|Ch\.?|#)\s*([\d.]+)/i);
      if (chMatch) chapter = parseFloat(chMatch[1]);
    }
  }

  // Generic chapter extraction from page title / visible headings (fallback for all sites)
  if (chapter === null) {
    const sources = [
      doc.title,
      doc.querySelector('h1')?.textContent,
      doc.querySelector('h2')?.textContent,
      doc.querySelector('.reader-header, .chapter-header, .viewer-header')?.textContent,
    ];

    for (const source of sources) {
      if (!source) continue;
      const match = source.match(/(?:Chapter|Ch\.?|Episode|Ep\.?)\s*([\d.]+)/i);
      if (match) {
        chapter = parseFloat(match[1]);
        break;
      }
    }
  }

  return { title, chapter };
}

/**
 * Normalize a manga title for AniList search:
 * lowercase, strip punctuation/extra spaces, trim.
 * @param {string} title
 * @returns {string}
 */
export function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
