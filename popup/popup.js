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

  // Avatar / account dropdown
  const avatarBtn        = $('avatar-btn');
  const avatarImg        = $('avatar-img');
  const avatarFallback   = $('avatar-fallback');
  const avatarDropdown   = $('avatar-dropdown');
  const dropdownUsername = $('dropdown-username');
  const dropdownSettings = $('dropdown-settings');
  const dropdownLogout   = $('dropdown-logout');

  // Detection
  const notOnSite       = $('not-on-site');
  const notChapter      = $('not-chapter');
  const chapterDetected = $('chapter-detected');
  const seriesPageEl    = $('series-page');
  const siteBadge       = $('site-badge');
  const seriesSiteBadge = $('series-site-badge');
  const detectedTitle   = $('detected-title');
  const detectedChapter = $('detected-chapter');
  const seriesTitle     = $('series-title');
  const seriesProgress  = $('series-progress');

  // Progress
  const progressLoading   = $('progress-loading');
  const progressNotFound  = $('progress-not-found');
  const progressData      = $('progress-data');
  const progressValue     = $('progress-value');
  const scoreValue        = $('score-value');
  const scoreRow          = $('score-row');
  const scoreEdit         = $('score-edit');
  const scoreInput        = $('score-input');
  const scoreResetBtn     = $('score-reset-btn');

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
      const name = authState.name || '';
      dropdownUsername.textContent = name || 'AniList User';
      if (authState.avatar) {
        avatarImg.src = authState.avatar;
        avatarImg.classList.remove('hidden');
        avatarFallback.classList.add('hidden');
      } else {
        avatarFallback.textContent = name ? name[0].toUpperCase() : '?';
        avatarFallback.classList.remove('hidden');
        avatarImg.classList.add('hidden');
      }
    } else {
      avatarFallback.textContent = '?';
      avatarFallback.classList.remove('hidden');
      avatarImg.classList.add('hidden');
      dropdownUsername.textContent = '';
    }
  }

  function applySettings() {
    if (!settings) return;
    const showProgress = settings['settings.popup.showProgress'] !== false;
    const showScore    = settings['settings.popup.showScore'] !== false;
    const showLog      = settings['settings.popup.showLog'] !== false;
    const avatarCircle = settings['settings.popup.avatarCircle'] === true;

    $('progress-panel').classList.toggle('hidden', !showProgress);
    scoreRow.classList.toggle('hidden', !showScore);
    logPanel.classList.toggle('hidden', !showLog);
    avatarImg.classList.toggle('avatar-circle', avatarCircle);
    avatarFallback.classList.toggle('avatar-circle', avatarCircle);
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
    const { site, isChapterPage, isSeriesPage, chapterInfo: info } = response || {};

    chapterInfo = info ? { ...info, isChapterPage } : null;

    if (!site) {
      showDetectionState('not-on-site');
      resetProgress();
      setMarkReadDisabled('No supported site detected');
      return;
    }

    // Series/chapter-select page: show manga name + progress in detection panel only
    if (isSeriesPage && info?.title) {
      showDetectionState('series-page');
      $('progress-panel').classList.add('hidden');
      $('action-row').classList.add('hidden');
      seriesSiteBadge.textContent = SITE_LABELS[site] || site;
      seriesTitle.textContent = info.title;
      seriesTitle.title = info.title;
      seriesProgress.textContent = '…';
      setMarkReadDisabled('Open a chapter to mark as read');
      loadSeriesProgress(info.title);
      return;
    }

    // Restore panels hidden on series pages
    $('action-row').classList.remove('hidden');
    applySettings();

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
    seriesPageEl.classList.toggle('hidden', state !== 'series-page');
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
      const currentProgress = listEntry?.progress ?? 0;
      progressValue.textContent = mangaMedia.chapters
        ? `Ch. ${currentProgress} / ${mangaMedia.chapters}`
        : `Ch. ${currentProgress} / Ongoing`;

      renderScore(listEntry?.score);

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

  // Load AniList progress for a series page (no current chapter being read)
  async function loadSeriesProgress(title) {
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
        seriesProgress.textContent = 'Not on AniList';
        showProgressState('not-found');
        return;
      }

      mangaMedia = result.media;
      listEntry  = result.listEntry;

      const currentProgress = listEntry?.progress ?? 0;
      const totalChapters   = mangaMedia.chapters;

      seriesProgress.textContent = totalChapters
        ? `Ch. ${currentProgress} / ${totalChapters}`
        : `Ch. ${currentProgress} / Ongoing`;

    } catch {
      seriesProgress.textContent = 'Error loading';
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
        progressValue.textContent = mangaMedia?.chapters
          ? `Ch. ${Math.floor(chapterInfo.chapter)} / ${mangaMedia.chapters}`
          : `Ch. ${Math.floor(chapterInfo.chapter)}`;
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
  // Score editing
  // ---------------------------------------------------------------------------

  function openScoreEdit() {
    if (!mangaMedia) return;
    const current = listEntry?.score;
    scoreInput.value = (current && current > 0) ? current : '';
    scoreValue.classList.add('hidden');
    scoreEdit.classList.remove('hidden');
    scoreInput.focus();
    scoreInput.select();
  }

  function closeScoreEdit() {
    scoreEdit.classList.add('hidden');
    scoreValue.classList.remove('hidden');
  }

  function renderScore(score) {
    if (score && score > 0) {
      scoreValue.textContent = `${score} / 10`;
    } else {
      scoreValue.textContent = '—';
    }
  }

  async function saveScore(score) {
    closeScoreEdit();
    scoreValue.textContent = '…';
    const result = await sendMessage({ type: 'SAVE_SCORE', mediaId: mangaMedia.id, score });
    if (result.success) {
      if (listEntry) listEntry.score = result.score;
      renderScore(result.score);
      showFeedback('Score saved!', 'success');
    } else {
      renderScore(listEntry?.score);
      showFeedback(result.error || 'Failed to save score.', 'error');
    }
  }

  scoreValue.addEventListener('click', openScoreEdit);

  scoreInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeScoreEdit(); return; }
    if (e.key !== 'Enter') return;
    const raw = parseFloat(scoreInput.value);
    if (isNaN(raw) || raw < 1 || raw > 10) {
      scoreInput.style.borderColor = 'var(--error)';
      setTimeout(() => { scoreInput.style.borderColor = ''; }, 800);
      return;
    }
    saveScore(raw);
  });

  scoreResetBtn.addEventListener('click', () => saveScore(0));

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

  // Avatar dropdown toggle
  avatarBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !avatarDropdown.classList.contains('hidden');
    avatarDropdown.classList.toggle('hidden', isOpen);
    avatarBtn.setAttribute('aria-expanded', String(!isOpen));
  });

  document.addEventListener('click', () => {
    avatarDropdown.classList.add('hidden');
    avatarBtn.setAttribute('aria-expanded', 'false');
  });

  dropdownSettings.addEventListener('click', () => {
    avatarDropdown.classList.add('hidden');
    chrome.runtime.openOptionsPage();
  });

  dropdownLogout.addEventListener('click', async () => {
    avatarDropdown.classList.add('hidden');
    await sendMessage({ type: 'AUTH_LOGOUT' });
    authState = { authenticated: false };
    renderAuth();
    showScreen('login');
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

  // Content script resolves chapter info asynchronously (1-3s after page load).
  // If the popup opened before that resolved, listen for the update and refresh.
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CHAPTER_INFO_UPDATE' && authState?.authenticated) {
      handleChapterInfo(message);
    }
  });
})();
