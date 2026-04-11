// AniList Manga Tracker — Service Worker (Manifest V3)
// Handles: OAuth, AniList API calls, storage management, notifications

import { getCurrentUser, searchManga, getMediaListEntry, updateProgress, updateScore } from '../utils/anilist.js';
import { ANILIST_CLIENT_ID } from '../config.js';
const MAX_SYNC_LOG_ENTRIES = 10;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function getStorage(keys) {
  return chrome.storage.local.get(keys);
}

async function setStorage(items) {
  return chrome.storage.local.set(items);
}

async function getToken() {
  const { 'auth.accessToken': token } = await getStorage(['auth.accessToken']);
  return token || null;
}

async function getUserId() {
  const { 'auth.userId': userId } = await getStorage(['auth.userId']);
  return userId || null;
}

async function getSettings() {
  const defaults = {
    'settings.notifications.success': false,
    'settings.notifications.error': false,
    'settings.popup.showProgress': true,
    'settings.popup.showScore': true,
    'settings.popup.showLog': true,
    'settings.popup.avatarCircle': false,
  };
  const stored = await getStorage(Object.keys(defaults));
  return { ...defaults, ...stored };
}

// ---------------------------------------------------------------------------
// Sync log
// ---------------------------------------------------------------------------

async function appendSyncLog(entry) {
  const { syncLog = [] } = await getStorage(['syncLog']);
  const updated = [
    { ...entry, timestamp: Date.now() },
    ...syncLog,
  ].slice(0, MAX_SYNC_LOG_ENTRIES);
  await setStorage({ syncLog: updated });
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

async function launchOAuthFlow() {
  const redirectUri = chrome.identity.getRedirectURL();

  // AniList's implicit grant does not accept redirect_uri as a URL param —
  // passing it causes an error page before the login renders. Chrome's identity
  // API intercepts the chromiumapp.org redirect automatically, so we omit it.
  const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${ANILIST_CLIENT_ID}&response_type=token`;

  console.log('[AniList Auth] Redirect URI (must be registered on AniList):', redirectUri);
  console.log('[AniList Auth] Auth URL:', authUrl);

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      async (responseUrl) => {
        if (chrome.runtime.lastError) {
          console.error('[AniList Auth] launchWebAuthFlow error:', chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!responseUrl) {
          reject(new Error('OAuth cancelled'));
          return;
        }

        // AniList uses implicit grant — token is in the URL hash
        // chrome.identity strips the fragment, so we parse from the full URL
        // The token appears after #access_token= in the redirect URL
        const hashIndex = responseUrl.indexOf('#');
        if (hashIndex === -1) {
          reject(new Error('No token in redirect URL'));
          return;
        }

        const hash = responseUrl.slice(hashIndex + 1);
        const params = new URLSearchParams(hash);
        const accessToken = params.get('access_token');

        if (!accessToken) {
          reject(new Error('access_token not found in redirect URL'));
          return;
        }

        try {
          const user = await getCurrentUser(accessToken);
          await setStorage({
            'auth.accessToken': accessToken,
            'auth.userId': user.id,
            'auth.userName': user.name,
            'auth.userAvatar': user.avatar?.medium || null,
          });
          resolve({ accessToken, user });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

async function logout() {
  await chrome.storage.local.remove([
    'auth.accessToken',
    'auth.userId',
    'auth.userName',
    'auth.userAvatar',
  ]);
}

// ---------------------------------------------------------------------------
// Chapter update logic
// ---------------------------------------------------------------------------

/**
 * Attempt to sync a chapter to AniList.
 * Returns { success, alreadyUpToDate, notInList, mediaId, progress, error? }
 */
async function syncChapter({ title, chapter, siteKey }) {
  const token = await getToken();
  const userId = await getUserId();

  if (!token || !userId) {
    return { success: false, error: 'not_authenticated' };
  }

  const chapterInt = Math.floor(chapter);

  // 1. Find manga on AniList
  const media = await searchManga(title, token);
  if (!media) {
    return { success: false, error: 'not_found', title };
  }

  // 2. Get current list entry
  const listEntry = await getMediaListEntry(userId, media.id, token);

  // 3. Duplicate prevention — don't update if already at or past this chapter
  if (listEntry && listEntry.progress >= chapterInt) {
    return {
      success: false,
      alreadyUpToDate: true,
      mediaId: media.id,
      currentProgress: listEntry.progress,
    };
  }

  // 4. Prompt if not in list (handled by popup via notInList flag)
  if (!listEntry) {
    return {
      success: false,
      notInList: true,
      media,
      chapter: chapterInt,
      title,
    };
  }

  // 5. Perform the update
  try {
    await updateProgress(media.id, chapterInt, token);
    await appendSyncLog({
      title,
      chapter: chapterInt,
      status: 'success',
      siteKey,
    });
    return { success: true, mediaId: media.id, progress: chapterInt, title };
  } catch (err) {
    await appendSyncLog({
      title,
      chapter: chapterInt,
      status: 'error',
      error: err.message,
      siteKey,
    });
    return { success: false, error: err.message };
  }
}

/**
 * Add a manga to the user's AniList and update progress.
 */
async function addToListAndSync({ mediaId, chapter, title, siteKey }) {
  const token = await getToken();
  if (!token) return { success: false, error: 'not_authenticated' };

  try {
    await updateProgress(mediaId, Math.floor(chapter), token, 'CURRENT');
    await appendSyncLog({ title, chapter: Math.floor(chapter), status: 'success', siteKey });
    return { success: true, mediaId, progress: Math.floor(chapter), title };
  } catch (err) {
    await appendSyncLog({ title, chapter: Math.floor(chapter), status: 'error', error: err.message, siteKey });
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

async function showNotification(title, message, type = 'success') {
  const settings = await getSettings();
  const key = type === 'success' ? 'settings.notifications.success' : 'settings.notifications.error';
  if (!settings[key]) return;

  chrome.notifications.create({
    type: 'basic',
    iconUrl: '../icons/icon48.png',
    title,
    message,
  });
}

// ---------------------------------------------------------------------------
// MangaDex chapter resolution
// ---------------------------------------------------------------------------

async function resolveMangaDexChapter(chapterId) {
  try {
    const res = await fetch(`https://api.mangadex.org/chapter/${chapterId}?includes[]=manga`);
    const json = await res.json();

    if (json.result !== 'ok') return null;

    const attrs = json.data.attributes;
    const chapter = parseFloat(attrs.chapter);

    // Find the manga title from the relationships
    const mangaRel = json.data.relationships.find(r => r.type === 'manga');
    let title = null;
    if (mangaRel?.attributes) {
      title =
        mangaRel.attributes.title?.en ||
        mangaRel.attributes.title?.['ja-ro'] ||
        Object.values(mangaRel.attributes.title || {})[0] ||
        null;
    }

    return { chapter, title, chapterId };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Badge helper
// ---------------------------------------------------------------------------

function setBadge(text, color = '#2B2D42') {
  chrome.action.setBadgeText({ text });
  if (text) chrome.action.setBadgeBackgroundColor({ color });
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('[service-worker] unhandled error:', err);
    sendResponse({ error: err.message });
  });
  return true; // keep message channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    // ---- Auth ----
    case 'AUTH_LOGIN': {
      try {
        const result = await launchOAuthFlow();
        return { success: true, user: result.user };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    case 'AUTH_LOGOUT': {
      await logout();
      return { success: true };
    }

    case 'AUTH_STATUS': {
      const token = await getToken();
      if (!token) return { authenticated: false };
      const { 'auth.userName': name, 'auth.userAvatar': avatar, 'auth.userId': userId } =
        await getStorage(['auth.userName', 'auth.userAvatar', 'auth.userId']);
      return { authenticated: true, name, avatar, userId };
    }

    // ---- Chapter detection + sync (from content script) ----
    case 'SCROLL_THRESHOLD_REACHED': {
      const { title, chapter, siteKey, tabId } = message;
      const result = await syncChapter({ title, chapter, siteKey });

      if (result.success) {
        setBadge('✓', '#02A9FF');
        await showNotification(
          'AniList Updated',
          `${title} — Ch. ${Math.floor(chapter)} synced`
        );
      } else if (result.error) {
        setBadge('!', '#E63946');
        await showNotification('Sync Failed', result.error || 'Unknown error', 'error');
      }

      return result;
    }

    // ---- Manual mark as read (from popup) ----
    case 'MARK_AS_READ': {
      const { title, chapter, siteKey } = message;
      const result = await syncChapter({ title, chapter, siteKey });

      if (result.success) {
        await showNotification('AniList Updated', `${title} — Ch. ${Math.floor(chapter)} synced`);
      } else if (result.error && !result.alreadyUpToDate && !result.notInList) {
        await showNotification('Sync Failed', result.error, 'error');
      }

      return result;
    }

    // ---- Add to list + sync ----
    case 'ADD_TO_LIST': {
      const result = await addToListAndSync(message);
      if (result.success) {
        await showNotification(
          'Added to AniList',
          `${message.title} added and Ch. ${message.chapter} synced`
        );
      }
      return result;
    }

    // ---- AniList data fetch (for popup) ----
    case 'GET_MANGA_INFO': {
      const { title } = message;
      const token = await getToken();
      const userId = await getUserId();

      if (!token || !userId) return { error: 'not_authenticated' };

      const media = await searchManga(title, token);
      if (!media) return { error: 'not_found' };

      const listEntry = await getMediaListEntry(userId, media.id, token);
      return { media, listEntry };
    }

    // ---- Sync log ----
    case 'GET_SYNC_LOG': {
      const { syncLog = [] } = await getStorage(['syncLog']);
      return { syncLog };
    }

    // ---- Settings ----
    case 'GET_SETTINGS': {
      return getSettings();
    }

    case 'SET_SETTINGS': {
      await setStorage(message.settings);
      return { success: true };
    }

    // ---- MangaDex chapter resolution ----
    case 'RESOLVE_MANGADEX_CHAPTER': {
      const result = await resolveMangaDexChapter(message.chapterId);
      return result || { error: 'resolution_failed' };
    }

    // ---- Score update ----
    case 'SAVE_SCORE': {
      const { mediaId, score } = message;
      const token = await getToken();
      if (!token) return { error: 'not_authenticated' };
      try {
        const entry = await updateScore(mediaId, score, token);
        return { success: true, score: entry.score };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    // ---- Badge reset ----
    case 'CLEAR_BADGE': {
      setBadge('');
      return { success: true };
    }

    default:
      return { error: `Unknown message type: ${message.type}` };
  }
}

// Clear badge when user opens the popup
chrome.action.onClicked.addListener(() => {
  setBadge('');
});
