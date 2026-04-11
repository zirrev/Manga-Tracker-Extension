// AniList Manga Tracker — Settings page

(async function () {
  'use strict';

  const SETTING_KEYS = {
    'toggle-show-progress':  'settings.popup.showProgress',
    'toggle-show-score':     'settings.popup.showScore',
    'toggle-show-log':       'settings.popup.showLog',
    'toggle-avatar-circle':  'settings.popup.avatarCircle',
    'toggle-notify-success': 'settings.notifications.success',
    'toggle-notify-error':   'settings.notifications.error',
  };

  const feedbackEl = document.getElementById('feedback');

  // ---------------------------------------------------------------------------
  // Load initial state
  // ---------------------------------------------------------------------------

  const [authResult, settingsResult] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'AUTH_STATUS' }),
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }),
  ]);

  renderAuth(authResult);
  applySettings(settingsResult);

  // ---------------------------------------------------------------------------
  // Auth display
  // ---------------------------------------------------------------------------

  function renderAuth(auth) {
    const loggedInEl  = document.getElementById('auth-info');
    const loggedOutEl = document.getElementById('auth-logged-out');
    const nameEl      = document.getElementById('auth-user-name');

    if (auth.authenticated) {
      loggedInEl.classList.remove('hidden');
      loggedOutEl.classList.add('hidden');
      nameEl.textContent = auth.name || 'AniList User';
    } else {
      loggedInEl.classList.add('hidden');
      loggedOutEl.classList.remove('hidden');
    }
  }

  // ---------------------------------------------------------------------------
  // Logout
  // ---------------------------------------------------------------------------

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'AUTH_LOGOUT' });
    renderAuth({ authenticated: false });
    showFeedback('Disconnected from AniList.', 'success');
  });

  // Login from settings page
  document.getElementById('login-btn-settings').addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'AUTH_LOGIN' });
    if (result.success) {
      const auth = await chrome.runtime.sendMessage({ type: 'AUTH_STATUS' });
      renderAuth(auth);
      showFeedback('Connected to AniList!', 'success');
    } else {
      showFeedback('Login failed: ' + (result.error || 'Unknown'), 'error');
    }
  });

  // ---------------------------------------------------------------------------
  // Settings toggles
  // ---------------------------------------------------------------------------

  // Settings that default to false (opt-in) rather than true (opt-out)
  const OPT_IN_KEYS = new Set([
    'settings.notifications.success',
    'settings.notifications.error',
    'settings.popup.avatarCircle',
  ]);

  function applySettings(settings) {
    for (const [toggleId, storageKey] of Object.entries(SETTING_KEYS)) {
      const el = document.getElementById(toggleId);
      if (!el) continue;
      el.checked = OPT_IN_KEYS.has(storageKey)
        ? settings[storageKey] === true
        : settings[storageKey] !== false;
    }
  }

  // Attach change listeners
  for (const [toggleId, storageKey] of Object.entries(SETTING_KEYS)) {
    const el = document.getElementById(toggleId);
    if (!el) continue;
    el.addEventListener('change', async () => {
      await chrome.runtime.sendMessage({
        type: 'SET_SETTINGS',
        settings: { [storageKey]: el.checked },
      });
      showFeedback('Settings saved.', 'success');
    });
  }

  // ---------------------------------------------------------------------------
  // Feedback
  // ---------------------------------------------------------------------------

  let feedbackTimeout = null;

  function showFeedback(message, type = 'success') {
    feedbackEl.textContent = message;
    feedbackEl.className = `feedback ${type}`;
    feedbackEl.classList.remove('hidden');
    clearTimeout(feedbackTimeout);
    feedbackTimeout = setTimeout(() => feedbackEl.classList.add('hidden'), 3000);
  }
})();
