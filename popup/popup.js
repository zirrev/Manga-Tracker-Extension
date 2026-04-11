// AniList Manga Tracker — Popup

(async function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------

  const $ = id => document.getElementById(id);

  const loginScreen     = $('login-screen');
  const mainScreen      = $('main-screen');
  const loginBtn        = $('login-btn');
  const settingsBtn     = $('settings-btn');
  const authStatus      = $('auth-status');

  // Detection
  const notOnSite       = $('not-on-site');
  const notChapter      = $('not-chapter');
  const chapterDetected = $('chapter-detected');
  const siteBadge       = $('site-badge');
  const detectedTitle   = $('detected-title');
  const detectedChapter = $('detected-chapter');

  // Progress
  const progressLoading   = $('progress-loading');
  const progressNotFound  = $('progress-not-found');
  const progressData      = $('progress-data');
  const progressValue     = $('progress-value');
  const scoreValue        = $('score-value');
  const scoreRow          = $('score-row');

  // Actions
  const markReadBtn     = $('mark-read-btn');
  const markReadText    = $('mark-read-text');
  const markReadSpinner = $('mark-read-spinner');
  const feedbackEl      = $('feedback');

  // Add-to-list prompt
  const addToListBtn    = $('add-to-list-btn');
  const addToListPrompt = $('add-to-list-prompt');
  const confirmAddBtn   = $('confirm-add-btn');
  const dismissAddBtn   = $('dismiss-add-btn');

  // Sync log
  const logToggle       = $('log-toggle');
  const logList         = $('log-list');
  const logEmpty        = $('log-empty');
  const logPanel        = $('log-panel');

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let authState    = null; // { authenticated, name, userId, avatar }
  let chapterInfo  = null; // { title, chapter, siteKey, isChapterPage }
  let mangaMedia   = null; // AniList Media object
  let listEntry    = null; // AniList MediaList entry
  let pendingAdd   = null; // { mediaId, title, chapter, siteKey } — waiting for add-to-list confirm
  let settings     = null;

  const SITE_LABELS = {
    weebcentral: 'WeebCentral',
    mangadex: 'MangaDex',
    mangaplus: 'MangaPlus',
  };

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  await init();

  async function init() {
    [authState, settings] = await Promise.all([
      sendMessage({ type: 'AUTH_STATUS' }),
      sendMessage({ type: 'GET_SETTINGS' }),
    ]);

    renderAuth();

    if (authState.authenticated) {
      showScreen('main');
      await loadCurrentTab();
    } else {
      showScreen('login');
    }

    applySettings();
  }

  // ---------------------------------------------------------------------------
  // Screen helpers
  // ---------------------------------------------------------------------------

  function showScreen(name) {
    loginScreen.classList.toggle('hidden', name !== 'login');
    mainScreen.classList.toggle('hidden', name !== 'main');
  }

  function renderAuth() {
    if (authState.authenticated) {
      authStatus.textContent = authState.name || 'Logged in';
    } else {
      authStatus.textContent = 'Not logged in';
    }
  }

  function applySettings() {
    if (!settings) return;
    const showProgress = settings['settings.popup.showProgress'] !== false;
    const showScore    = settings['settings.popup.showScore'] !== false;
    const showLog      = settings['settings.popup.showLog'] !== false;

    $('progress-panel').classList.toggle('hidden', !showProgress);
    scoreRow.classList.toggle('hidden', !showScore);
    logPanel.classList.toggle('hidden', !showLog);
  }

  // ---------------------------------------------------------------------------
  // Tab + chapter info
  // ---------------------------------------------------------------------------

  async function loadCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Ask content script for current chapter info
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CHAPTER_INFO' });
      handleChapterInfo(response);
    } catch {
      // Content script not injected on this page
      handleChapterInfo({ site: null, isChapterPage: false, chapterInfo: null });
    }
  }

  function handleChapterInfo(response) {
    const { site, isChapterPage, chapterInfo: info } = response || {};

    chapterInfo = info ? { ...info, isChapterPage } : null;

    if (!site) {
      showDetectionState('not-on-site');
      resetProgress();
      setMarkReadDisabled('No supported site detected');
      return;
    }

    if (!isChapterPage || !info) {
      showDetectionState('not-chapter');
      resetProgress();
      setMarkReadDisabled('Navigate to a chapter page');
      return;
    }

    // Show detected info
    showDetectionState('detected');
    siteBadge.textContent = SITE_LABELS[site] || site;
    detectedTitle.textContent = info.title || 'Unknown title';
    detectedTitle.title = info.title || '';
    detectedChapter.textContent = info.chapter != null ? `Chapter ${info.chapter}` : 'Chapter ?';

    if (info.title) {
      loadMangaProgress(info.title, info.chapter);
    } else {
      resetProgress();
      setMarkReadDisabled('Chapter title not detected');
    }
  }

  function showDetectionState(state) {
    notOnSite.classList.toggle('hidden', state !== 'not-on-site');
    notChapter.classList.toggle('hidden', state !== 'not-chapter');
    chapterDetected.classList.toggle('hidden', state !== 'detected');
  }

  // ---------------------------------------------------------------------------
  // Progress loading
  // ---------------------------------------------------------------------------

  async function loadMangaProgress(title, currentChapter) {
    showProgressState('loading');

    try {
      const result = await sendMessage({ type: 'GET_MANGA_INFO', title });

      if (result.error === 'not_authenticated') {
        showScreen('login');
        return;
      }

      if (result.error === 'not_found' || !result.media) {
        mangaMedia = null;
        listEntry = null;
        showProgressState('not-found');
        setMarkReadDisabled('Manga not on AniList');
        return;
      }

      mangaMedia = result.media;
      listEntry  = result.listEntry;

      // Display progress
      const totalChapters = mangaMedia.chapters ?? '?';
      const currentProgress = listEntry?.progress ?? 0;
      progressValue.textContent = `Ch. ${currentProgress} / ${totalChapters}`;

      const score = listEntry?.score;
      if (score && score > 0) {
        scoreValue.textContent = `${score} / 10`;
      } else {
        scoreValue.textContent = '—';
      }

      showProgressState('data');

      // Determine mark-as-read button state
      if (currentChapter == null) {
        setMarkReadDisabled('Chapter not detected');
      } else if (listEntry && listEntry.progress >= Math.floor(currentChapter)) {
        setMarkReadDisabled('Already up to date');
      } else {
        setMarkReadEnabled();
      }

    } catch (err) {
      showProgressState('not-found');
      setMarkReadDisabled('Error loading data');
    }
  }

  function showProgressState(state) {
    progressLoading.classList.toggle('hidden', state !== 'loading');
    progressNotFound.classList.toggle('hidden', state !== 'not-found');
    progressData.classList.toggle('hidden', state !== 'data');
    addToListPrompt.classList.add('hidden');
  }

  function resetProgress() {
    mangaMedia = null;
    listEntry = null;
    showProgressState('loading');
    progressLoading.classList.add('hidden');
  }

  // ---------------------------------------------------------------------------
  // Mark as Read
  // ---------------------------------------------------------------------------

  function setMarkReadEnabled() {
    markReadBtn.disabled = false;
    markReadBtn.title = '';
    markReadText.textContent = 'Mark as Read';
  }

  function setMarkReadDisabled(reason) {
    markReadBtn.disabled = true;
    markReadBtn.title = reason;
    markReadText.textContent = 'Mark as Read';
  }

  function setMarkReadLoading(loading) {
    markReadBtn.disabled = loading;
    markReadText.classList.toggle('hidden', loading);
    markReadSpinner.classList.toggle('hidden', !loading);
  }

  markReadBtn.addEventListener('click', async () => {
    if (!chapterInfo?.title || chapterInfo.chapter == null) return;

    setMarkReadLoading(true);
    hideFeedback();

    const result = await sendMessage({
      type: 'MARK_AS_READ',
      title: chapterInfo.title,
      chapter: chapterInfo.chapter,
      siteKey: chapterInfo.siteKey,
    });

    setMarkReadLoading(false);

    if (result.success) {
      showFeedback(`Ch. ${Math.floor(chapterInfo.chapter)} synced to AniList!`, 'success');
      setMarkReadDisabled('Already up to date');
      if (progressData && !progressData.classList.contains('hidden')) {
        const totalChapters = mangaMedia?.chapters ?? '?';
        progressValue.textContent = `Ch. ${Math.floor(chapterInfo.chapter)} / ${totalChapters}`;
      }
      await loadSyncLog();
    } else if (result.alreadyUpToDate) {
      showFeedback('Already up to date on AniList.', 'success');
      setMarkReadDisabled('Already up to date');
    } else if (result.notInList) {
      // Show add-to-list prompt
      pendingAdd = {
        mediaId: result.media?.id,
        title: chapterInfo.title,
        chapter: chapterInfo.chapter,
        siteKey: chapterInfo.siteKey,
      };
      addToListPrompt.classList.remove('hidden');
    } else {
      showFeedback(result.error || 'Sync failed.', 'error');
    }
  });

  // ---------------------------------------------------------------------------
  // Add to list prompt
  // ---------------------------------------------------------------------------

  addToListBtn.addEventListener('click', () => {
    addToListPrompt.classList.remove('hidden');
  });

  confirmAddBtn.addEventListener('click', async () => {
    if (!pendingAdd) return;
    addToListPrompt.classList.add('hidden');
    setMarkReadLoading(true);

    const result = await sendMessage({ type: 'ADD_TO_LIST', ...pendingAdd });
    setMarkReadLoading(false);
    pendingAdd = null;

    if (result.success) {
      showFeedback('Added to AniList and synced!', 'success');
      setMarkReadDisabled('Already up to date');
      await loadMangaProgress(chapterInfo.title, chapterInfo.chapter);
      await loadSyncLog();
    } else {
      showFeedback(result.error || 'Failed to add.', 'error');
    }
  });

  dismissAddBtn.addEventListener('click', () => {
    addToListPrompt.classList.add('hidden');
    pendingAdd = null;
  });

  // ---------------------------------------------------------------------------
  // Feedback banner
  // ---------------------------------------------------------------------------

  let feedbackTimeout = null;

  function showFeedback(message, type = 'success') {
    feedbackEl.textContent = message;
    feedbackEl.className = `feedback ${type}`;
    feedbackEl.classList.remove('hidden');
    clearTimeout(feedbackTimeout);
    feedbackTimeout = setTimeout(hideFeedback, 4000);
  }

  function hideFeedback() {
    feedbackEl.classList.add('hidden');
  }

  // ---------------------------------------------------------------------------
  // Sync log
  // ---------------------------------------------------------------------------

  async function loadSyncLog() {
    const { syncLog = [] } = await sendMessage({ type: 'GET_SYNC_LOG' });
    renderSyncLog(syncLog);
  }

  function renderSyncLog(entries) {
    if (!entries.length) {
      logEmpty.classList.remove('hidden');
      return;
    }
    logEmpty.classList.add('hidden');

    // Remove existing entries (keep logEmpty)
    logList.querySelectorAll('.log-entry').forEach(el => el.remove());

    entries.forEach(entry => {
      const el = document.createElement('div');
      el.className = 'log-entry';

      const timeAgo = formatTimeAgo(entry.timestamp);
      const chStr = entry.chapter != null ? `Ch. ${entry.chapter}` : '';

      el.innerHTML = `
        <span class="log-dot ${entry.status}"></span>
        <div class="log-entry-info">
          <div class="log-entry-title">${escapeHtml(entry.title || 'Unknown')}</div>
          <div class="log-entry-detail">${chStr} · ${timeAgo}</div>
        </div>
      `;
      logList.appendChild(el);
    });
  }

  // Collapsible log
  logToggle.addEventListener('click', () => {
    const expanded = logToggle.getAttribute('aria-expanded') === 'true';
    logToggle.setAttribute('aria-expanded', String(!expanded));
    logList.classList.toggle('hidden', expanded);
  });

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage
      ? chrome.runtime.openOptionsPage()
      : chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
  });

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  loginBtn.addEventListener('click', async () => {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Connecting…';

    const result = await sendMessage({ type: 'AUTH_LOGIN' });
    if (result.success) {
      authState = await sendMessage({ type: 'AUTH_STATUS' });
      renderAuth();
      showScreen('main');
      await loadCurrentTab();
    } else {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Login with AniList';
      showFeedback('Login failed: ' + (result.error || 'Unknown error'), 'error');
      loginScreen.querySelector('.login-card').appendChild(feedbackEl);
    }
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function sendMessage(msg) {
    return chrome.runtime.sendMessage(msg);
  }

  function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Load sync log on open
  await loadSyncLog();
})();
