// AniList Manga Tracker — Content Script
// Runs on: weebcentral.com, mangadex.org, mangaplus.shueisha.co.jp
// Responsibilities: site/chapter detection, scroll tracking, message passing

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Site detection helpers (inline — content scripts can't import ES modules)
  // ---------------------------------------------------------------------------

  const SITES = {
    WEEBCENTRAL: 'weebcentral',
    MANGADEX: 'mangadex',
    MANGAPLUS: 'mangaplus',
  };

  const SITE_PATTERNS = {
    [SITES.WEEBCENTRAL]: {
      domain: 'weebcentral.com',
      chapterPattern: /weebcentral\.com\/chapters\/([A-Z0-9]+)/i,
    },
    [SITES.MANGADEX]: {
      domain: 'mangadex.org',
      chapterPattern: /mangadex\.org\/chapter\/([0-9a-f-]{36})/,
    },
    [SITES.MANGAPLUS]: {
      domain: 'mangaplus.shueisha.co.jp',
      chapterPattern: /mangaplus\.shueisha\.co\.jp\/viewer\/(\d+)/,
    },
  };

  function detectSite(url) {
    for (const [key, config] of Object.entries(SITE_PATTERNS)) {
      if (url.includes(config.domain)) return key;
    }
    return null;
  }

  function isChapterPage(url, site) {
    return site ? SITE_PATTERNS[site].chapterPattern.test(url) : false;
  }

  function extractChapterId(url, site) {
    const match = url.match(SITE_PATTERNS[site]?.chapterPattern);
    return match ? match[1] : null;
  }

  // ---------------------------------------------------------------------------
  // DOM-based info extraction
  // ---------------------------------------------------------------------------

  function parseMangaInfoFromDOM(site) {
    let title = null;
    let chapter = null;

    if (site === SITES.WEEBCENTRAL) {
      // WeebCentral page title format: "Chapter N | Series Name | Weeb Central"
      // Extract both chapter number AND series name from the title in one pass.
      const ptMatch = document.title.match(/Chapter\s+([\d.]+)\s*\|\s*(.+?)\s*\|/i);
      if (ptMatch) {
        chapter = parseFloat(ptMatch[1]);
        title = ptMatch[2].trim();
      }

      // Fallback 1: any <a> inside the reader header that links back to /series/
      // WeebCentral reader typically has a back-link like: <a href="/series/01J...">Series Name</a>
      if (!title) {
        const seriesLink = document.querySelector('a[href*="/series/"]');
        if (seriesLink) title = seriesLink.textContent.trim();
      }

      // Fallback 2: h1.text-2xl (confirmed selector from WeebCentral's own scraper)
      if (!title) {
        const h1 = document.querySelector('h1.text-2xl, h1');
        if (h1) title = h1.textContent.trim();
      }

      // Fallback 3: any nav/breadcrumb link that isn't "home" or a chapter reference
      if (!title) {
        const crumbs = document.querySelectorAll('nav a, .breadcrumb a, [aria-label="breadcrumb"] a');
        for (const crumb of crumbs) {
          const text = crumb.textContent.trim();
          if (text && !/home|chapter|ch\./i.test(text)) { title = text; break; }
        }
      }
    }

    if (site === SITES.MANGAPLUS) {
      const titleEl = document.querySelector(
        '.title-detail-view-title, .title-name, h1.title, .series-title'
      );
      if (titleEl) title = titleEl.textContent.trim();

      const chEl = document.querySelector(
        '.episode-title, .chapter-title, .viewer-title h1, .viewer-chapter-title'
      );
      if (chEl) {
        const m = chEl.textContent.match(/(?:Chapter|Ch\.?|Episode|#)\s*([\d.]+)/i);
        if (m) chapter = parseFloat(m[1]);
      }
    }

    // Generic chapter number extraction from common sources
    if (chapter === null) {
      const sources = [
        document.title,
        document.querySelector('h1')?.textContent,
        document.querySelector('h2')?.textContent,
        document.querySelector('.reader-header, .chapter-header, .viewer-header, .chapter-title')
          ?.textContent,
      ];
      for (const src of sources) {
        if (!src) continue;
        const m = src.match(/(?:Chapter|Ch\.?|Episode|Ep\.?)\s*([\d.]+)/i);
        if (m) { chapter = parseFloat(m[1]); break; }
      }
    }

    return { title, chapter };
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const site = detectSite(window.location.href);
  let currentChapterInfo = null; // { title, chapter, siteKey, chapterId }
  let scrollTriggered = false;
  let lastUrl = window.location.href;
  let mangaDexResolved = false;

  // ---------------------------------------------------------------------------
  // Chapter info resolution
  // ---------------------------------------------------------------------------

  async function resolveChapterInfo() {
    const url = window.location.href;

    if (!isChapterPage(url, site)) {
      currentChapterInfo = null;
      notifyPopup();
      return;
    }

    const chapterId = extractChapterId(url, site);

    if (site === SITES.MANGADEX && chapterId) {
      // For MangaDex we need to call the API to resolve title + chapter number
      if (!mangaDexResolved) {
        try {
          const result = await chrome.runtime.sendMessage({
            type: 'RESOLVE_MANGADEX_CHAPTER',
            chapterId,
          });
          if (result && !result.error) {
            currentChapterInfo = {
              title: result.title,
              chapter: result.chapter,
              siteKey: site,
              chapterId,
            };
            mangaDexResolved = true;
            notifyPopup();
            return;
          }
        } catch {}
      }
      // Fallback: try DOM
    }

    // WeebCentral + MangaPlus + DOM fallback
    const domInfo = parseMangaInfoFromDOM(site);

    console.log('[AniList Tracker] page title:', document.title);
    console.log('[AniList Tracker] detected:', domInfo);

    if (domInfo.title || domInfo.chapter) {
      currentChapterInfo = {
        title: domInfo.title,
        chapter: domInfo.chapter,
        siteKey: site,
        chapterId,
      };
      notifyPopup();
    } else {
      currentChapterInfo = { title: null, chapter: null, siteKey: site, chapterId };
      notifyPopup();
    }
  }

  // ---------------------------------------------------------------------------
  // Scroll tracking
  // ---------------------------------------------------------------------------

  const SCROLL_THRESHOLD = 0.80;

  function getScrollDepth() {
    const scrollY = window.scrollY || window.pageYOffset;
    const windowH = window.innerHeight;
    const docH = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight
    );
    if (docH <= windowH) return 1; // page shorter than viewport
    return (scrollY + windowH) / docH;
  }

  function handleScroll() {
    if (scrollTriggered) return;
    if (!currentChapterInfo?.title || currentChapterInfo.chapter === null) return;

    const depth = getScrollDepth();
    if (depth >= SCROLL_THRESHOLD) {
      scrollTriggered = true;
      chrome.runtime.sendMessage({
        type: 'SCROLL_THRESHOLD_REACHED',
        ...currentChapterInfo,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // URL change detection (SPA navigation)
  // ---------------------------------------------------------------------------

  function resetForNewPage() {
    scrollTriggered = false;
    mangaDexResolved = false;
    currentChapterInfo = null;
  }

  function checkUrlChange() {
    const url = window.location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      resetForNewPage();
      resolveChapterInfo();
    }
  }

  // Observer for SPA route changes
  const observer = new MutationObserver(checkUrlChange);
  observer.observe(document.body, { childList: true, subtree: true });

  // Also hook pushState/replaceState
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    originalPushState(...args);
    setTimeout(checkUrlChange, 200);
  };
  history.replaceState = function (...args) {
    originalReplaceState(...args);
    setTimeout(checkUrlChange, 200);
  };

  window.addEventListener('popstate', () => setTimeout(checkUrlChange, 200));

  // ---------------------------------------------------------------------------
  // Notify popup of current state
  // ---------------------------------------------------------------------------

  function notifyPopup() {
    chrome.runtime.sendMessage({
      type: 'CHAPTER_INFO_UPDATE',
      chapterInfo: currentChapterInfo,
      site,
      isChapterPage: isChapterPage(window.location.href, site),
    }).catch(() => {}); // popup may not be open — ignore
  }

  // ---------------------------------------------------------------------------
  // Message listener — popup can request current info
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_CHAPTER_INFO') {
      sendResponse({
        chapterInfo: currentChapterInfo,
        site,
        isChapterPage: isChapterPage(window.location.href, site),
      });
    }
    return false;
  });

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  window.addEventListener('scroll', handleScroll, { passive: true });

  // Wait briefly for SPA pages to render before first parse
  setTimeout(resolveChapterInfo, 1000);

  // Re-try after a longer delay for slow-loading pages (WeebCentral reader)
  setTimeout(resolveChapterInfo, 3000);
})();
