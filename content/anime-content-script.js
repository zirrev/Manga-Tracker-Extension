// AniList Anime Tracker — Content Script
// Runs on: aniwatchtv.to, hianime.to
// Responsibilities: site/episode detection, credits detection, message passing

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Site detection
  // ---------------------------------------------------------------------------

  const ANIME_SITES = {
    ANIWATCHTV: 'aniwatchtv',
    HIANIME: 'hianime',
  };

  const SITE_PATTERNS = {
    [ANIME_SITES.ANIWATCHTV]: {
      domain: 'aniwatchtv.to',
      watchPattern: /aniwatchtv\.to\/watch\//,
    },
    [ANIME_SITES.HIANIME]: {
      domain: 'hianime.to',
      watchPattern: /hianime\.to\/watch\//,
    },
  };

  function detectSite(url) {
    for (const [key, config] of Object.entries(SITE_PATTERNS)) {
      if (url.includes(config.domain)) return key;
    }
    return null;
  }

  function isWatchPage(url, site) {
    return site ? SITE_PATTERNS[site].watchPattern.test(url) : false;
  }

  function isSeriesPageUrl(url, site) {
    if (!site) return false;
    return !isWatchPage(url, site);
  }

  // ---------------------------------------------------------------------------
  // DOM-based episode info extraction
  // ---------------------------------------------------------------------------

  function parseEpisodeInfoFromDOM() {
    let title = null;
    let episode = null;

    // Series title — try multiple selectors used across hianime/aniwatchtv
    const titleSelectors = [
      '.anisc-detail .film-name a',
      '.film-name a',
      'h2.film-name a',
      '.film-name',
      'h2.film-name',
      '.anime-name a',
      '.anime-name',
      '.item-title a',
      'h1',
    ];
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text) { title = text; break; }
      }
    }

    // Episode number — prefer data attribute on the active episode item
    const activeEpSelectors = [
      '.ep-item.active',
      '.episode-item.active',
      '.ssl-item.ep-item.active',
      '[class*="ep-item"][class*="active"]',
      '.ep-item[data-active="true"]',
    ];
    for (const sel of activeEpSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        // data-number or data-ep-num holds the episode number
        const num = el.dataset.number || el.dataset.epNum || el.dataset.ep;
        if (num && !isNaN(parseFloat(num))) {
          episode = parseFloat(num);
          break;
        }
        // Fallback: parse text
        const m = el.textContent.match(/(?:Episode|Ep\.?|#)\s*([\d.]+)/i)
               || el.textContent.match(/^([\d.]+)$/);
        if (m) { episode = parseFloat(m[1]); break; }
      }
    }

    // Fallback: parse episode from page <title>
    // Common formats: "Anime Title Episode N Watch Online", "Anime Title - Ep N"
    if (episode === null) {
      const titlePatterns = [
        /\bEpisode\s+([\d.]+)/i,
        /\bEp\.?\s*([\d.]+)/i,
        /\b[Ee][Pp]?([\d]+)\b/,
      ];
      for (const pattern of titlePatterns) {
        const m = document.title.match(pattern);
        if (m) { episode = parseFloat(m[1]); break; }
      }
    }

    // Fallback: parse title from page <title>
    if (!title) {
      // "Anime Title Episode N - Watch | SiteName" → extract before "Episode"
      const m = document.title.match(/^(.+?)\s+(?:Episode|Ep\.?\s*\d)/i);
      if (m) {
        title = m[1].trim();
      } else {
        // "Anime Title - Watch Online | SiteName" → take everything before first pipe/dash
        const m2 = document.title.match(/^(.+?)\s*[-|–]/);
        if (m2) title = m2[1].trim();
      }
    }

    // Fallback: episode from URL slug pattern like /watch/anime-name?ep=ID
    // The ep query param is an internal ID, not the number — skip it.
    // But some sites encode episode number in pathname like /watch/anime-ep-12
    if (episode === null) {
      const urlMatch = window.location.pathname.match(/[-_]ep(?:isode)?[-_]?(\d+)/i)
                    || window.location.pathname.match(/\/(\d+)\/?$/);
      if (urlMatch) episode = parseFloat(urlMatch[1]);
    }

    return { title, episode };
  }

  function extractSeriesTitleFromDOM() {
    const selectors = [
      '.anisc-detail .film-name a',
      '.film-name a',
      'h2.film-name a',
      '.film-name',
      'h1',
      '.anime-detail-name',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text) return text;
      }
    }
    // Derive from URL slug: /one-piece-100 → "one piece" (strip trailing ID)
    const slug = window.location.pathname.replace(/^\//, '').split('/')[0];
    if (slug) {
      return slug.replace(/-\d+$/, '').replace(/-/g, ' ').trim() || null;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Credits detection
  // ---------------------------------------------------------------------------

  // Fires when we detect the ending/credits segment has started.
  // Strategy 1: "Skip Ending" button appears or becomes visible in the DOM.
  // Strategy 2: Video element reaches 85% of duration (fallback).

  function isSkipEndingVisible() {
    // Broad net — different sites use different class names/text
    const candidates = document.querySelectorAll(
      '.skip-btn, [class*="skip"], [id*="skip"], button[class*="Skip"], .btn-skip'
    );
    for (const el of candidates) {
      if (!el.offsetParent) continue; // hidden
      const text = el.textContent.toLowerCase().trim();
      if (
        (text.includes('ending') || text.includes('credits') || text.includes('outro') || text === 'skip ed') &&
        text.includes('skip')
      ) {
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const site = detectSite(window.location.href);
  let currentEpisodeInfo = null;
  let creditsTriggered = false;
  let lastUrl = window.location.href;
  let skipBtnObserver = null;
  let videoCheckInterval = null;

  // ---------------------------------------------------------------------------
  // Credits watchers
  // ---------------------------------------------------------------------------

  function startCreditsWatchers() {
    stopCreditsWatchers();

    // Strategy 1: MutationObserver for Skip Ending button
    skipBtnObserver = new MutationObserver(() => {
      if (!creditsTriggered && isSkipEndingVisible()) {
        fireCreditsReached();
      }
    });
    skipBtnObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    // Check immediately in case button is already visible
    if (isSkipEndingVisible()) {
      fireCreditsReached();
      return;
    }

    // Strategy 2: Poll video element for 85%+ completion
    const VIDEO_THRESHOLD = 0.85;
    videoCheckInterval = setInterval(() => {
      if (creditsTriggered) { stopCreditsWatchers(); return; }

      // Check video in current document
      for (const video of document.querySelectorAll('video')) {
        if (video.duration > 0 && video.currentTime / video.duration >= VIDEO_THRESHOLD) {
          fireCreditsReached();
          return;
        }
      }

      // Check video inside same-origin iframes
      for (const iframe of document.querySelectorAll('iframe')) {
        try {
          const iframeDoc = iframe.contentDocument;
          if (!iframeDoc) continue;
          for (const video of iframeDoc.querySelectorAll('video')) {
            if (video.duration > 0 && video.currentTime / video.duration >= VIDEO_THRESHOLD) {
              fireCreditsReached();
              return;
            }
          }
        } catch {} // cross-origin iframe — not accessible
      }
    }, 5000);
  }

  function stopCreditsWatchers() {
    if (skipBtnObserver) { skipBtnObserver.disconnect(); skipBtnObserver = null; }
    if (videoCheckInterval) { clearInterval(videoCheckInterval); videoCheckInterval = null; }
  }

  function fireCreditsReached() {
    if (creditsTriggered) return;
    if (!currentEpisodeInfo?.title || currentEpisodeInfo.episode === null) return;
    creditsTriggered = true;
    stopCreditsWatchers();
    chrome.runtime.sendMessage({
      type: 'VIDEO_CREDITS_REACHED',
      title: currentEpisodeInfo.title,
      episode: currentEpisodeInfo.episode,
      siteKey: currentEpisodeInfo.siteKey,
    });
  }

  // ---------------------------------------------------------------------------
  // Episode info resolution
  // ---------------------------------------------------------------------------

  async function resolveEpisodeInfo() {
    const url = window.location.href;

    if (!isWatchPage(url, site)) {
      if (isSeriesPageUrl(url, site)) {
        const seriesTitle = extractSeriesTitleFromDOM();
        currentEpisodeInfo = {
          title: seriesTitle,
          episode: null,
          siteKey: site,
          isSeriesPage: true,
        };
      } else {
        currentEpisodeInfo = null;
      }
      notifyPopup();
      return;
    }

    const info = parseEpisodeInfoFromDOM();

    if (info.title || info.episode !== null) {
      currentEpisodeInfo = {
        title: info.title,
        episode: info.episode,
        siteKey: site,
      };
      notifyPopup();
      startCreditsWatchers();
    } else {
      currentEpisodeInfo = { title: null, episode: null, siteKey: site };
      notifyPopup();
    }
  }

  // ---------------------------------------------------------------------------
  // SPA navigation detection
  // ---------------------------------------------------------------------------

  function resetForNewPage() {
    creditsTriggered = false;
    currentEpisodeInfo = null;
    stopCreditsWatchers();
  }

  function checkUrlChange() {
    const url = window.location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      resetForNewPage();
      resolveEpisodeInfo();
    }
  }

  const navObserver = new MutationObserver(checkUrlChange);
  navObserver.observe(document.body, { childList: true, subtree: true });

  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args) { origPush(...args); setTimeout(checkUrlChange, 200); };
  history.replaceState = function (...args) { origReplace(...args); setTimeout(checkUrlChange, 200); };
  window.addEventListener('popstate', () => setTimeout(checkUrlChange, 200));

  // ---------------------------------------------------------------------------
  // Notify popup
  // Normalizes to the same message shape as the manga content script so that
  // popup.js can use GET_CHAPTER_INFO / CHAPTER_INFO_UPDATE for both media types.
  // The extra `mediaType: 'ANIME'` field tells the popup to use episode labels.
  // ---------------------------------------------------------------------------

  function buildNormalizedResponse() {
    const url = window.location.href;
    const watchPage = isWatchPage(url, site);
    const seriesPage = isSeriesPageUrl(url, site);

    // Normalize episodeInfo → chapterInfo shape
    const chapterInfo = currentEpisodeInfo
      ? {
          title: currentEpisodeInfo.title,
          chapter: currentEpisodeInfo.episode, // episode stored in chapter field
          siteKey: currentEpisodeInfo.siteKey,
          isSeriesPage: currentEpisodeInfo.isSeriesPage || false,
        }
      : null;

    return {
      chapterInfo,
      site,
      isChapterPage: watchPage,
      isSeriesPage: seriesPage,
      mediaType: 'ANIME',
    };
  }

  function notifyPopup() {
    chrome.runtime.sendMessage({
      type: 'CHAPTER_INFO_UPDATE',
      ...buildNormalizedResponse(),
    }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Message listener
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_CHAPTER_INFO') {
      sendResponse(buildNormalizedResponse());
      return false;
    }

    if (message.type === 'REFRESH_CHAPTER_INFO') {
      const url = window.location.href;
      resolveEpisodeInfo().then(async () => {
        if (!currentEpisodeInfo?.title && isSeriesPageUrl(url, site)) {
          await new Promise(r => setTimeout(r, 800));
          await resolveEpisodeInfo();
        }
        sendResponse(buildNormalizedResponse());
      });
      return true;
    }
  });

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  setTimeout(resolveEpisodeInfo, 1000);
  setTimeout(resolveEpisodeInfo, 3000);
})();
