// AniList GraphQL API helpers

export const ANILIST_API_URL = 'https://graphql.anilist.co';
export const ANILIST_OAUTH_URL = 'https://anilist.co/api/v2/oauth/authorize';

// ---------------------------------------------------------------------------
// Queries & Mutations
// ---------------------------------------------------------------------------

const SEARCH_MANGA_QUERY = `
  query SearchManga($search: String!) {
    Media(search: $search, type: MANGA, isAdult: false) {
      id
      title {
        romaji
        english
        native
        userPreferred
      }
      chapters
      status
      coverImage {
        medium
        color
      }
      siteUrl
      mediaListEntry {
        id
        status
        progress
        score
      }
    }
  }
`;

// Returns multiple results so we can pick the best match (e.g. prefer the one
// the user is already tracking when there are similarly-named manga).
const SEARCH_MANGA_PAGE_QUERY = `
  query SearchMangaAll($search: String!) {
    Page(perPage: 10) {
      media(search: $search, type: MANGA, isAdult: false) {
        id
        title {
          romaji
          english
          native
          userPreferred
        }
        chapters
        status
        coverImage {
          medium
          color
        }
        siteUrl
        mediaListEntry {
          id
          status
          progress
          score
        }
      }
    }
  }
`;

const GET_MEDIA_LIST_ENTRY_QUERY = `
  query GetMediaListEntry($mediaId: Int!, $userId: Int!) {
    MediaList(mediaId: $mediaId, userId: $userId) {
      id
      status
      progress
      score
    }
  }
`;

const GET_VIEWER_QUERY = `
  query GetViewer {
    Viewer {
      id
      name
      avatar {
        medium
      }
    }
  }
`;

const SAVE_MEDIA_LIST_ENTRY_MUTATION = `
  mutation SaveMediaListEntry($mediaId: Int!, $progress: Int!, $status: MediaListStatus) {
    SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) {
      id
      status
      progress
    }
  }
`;

const SAVE_SCORE_MUTATION = `
  mutation SaveScore($mediaId: Int!, $score: Float!) {
    SaveMediaListEntry(mediaId: $mediaId, score: $score) {
      id
      score
    }
  }
`;

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------

/**
 * Execute a GraphQL query/mutation against the AniList API.
 * @param {string} query
 * @param {object} variables
 * @param {string} accessToken
 * @returns {Promise<object>} Parsed response data
 */
async function graphql(query, variables = {}, accessToken = null) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const response = await fetch(ANILIST_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();

  if (json.errors) {
    const msg = json.errors.map(e => e.message).join(', ');
    throw new Error(`AniList API error: ${msg}`);
  }

  return json.data;
}

// ---------------------------------------------------------------------------
// Public API helpers
// ---------------------------------------------------------------------------

/**
 * Get the authenticated user's profile.
 * @param {string} accessToken
 * @returns {Promise<{ id: number, name: string, avatar: { medium: string } }>}
 */
export async function getCurrentUser(accessToken) {
  const data = await graphql(GET_VIEWER_QUERY, {}, accessToken);
  return data.Viewer;
}

/**
 * Search for a manga by title.
 * Returns null if nothing found.
 * @param {string} title
 * @param {string} [accessToken]
 * @returns {Promise<object|null>}
 */
export async function searchManga(title, accessToken = null) {
  try {
    const data = await graphql(SEARCH_MANGA_QUERY, { search: title }, accessToken);
    return data.Media || null;
  } catch {
    return null;
  }
}

/**
 * Search for manga by title and return all results (up to 10).
 * Used to disambiguate when multiple manga share a similar name.
 * @param {string} title
 * @param {string} [accessToken]
 * @returns {Promise<object[]>} Array of Media objects (may be empty)
 */
export async function searchMangaAll(title, accessToken = null) {
  try {
    const data = await graphql(SEARCH_MANGA_PAGE_QUERY, { search: title }, accessToken);
    return data.Page?.media || [];
  } catch {
    return [];
  }
}

/**
 * Given an array of AniList Media results for the same search term, pick the
 * best match using two heuristics in order:
 *
 * 1. Prefer results the user is already tracking (mediaListEntry != null).
 * 2. If a chapterHint is provided (e.g. the chapter page we're currently on),
 *    eliminate results whose known chapter count is less than the hint —
 *    a one-shot with 1 chapter cannot be the manga you're reading at ch. 150.
 * 3. Fall back to the first result if nothing else differentiates.
 *
 * @param {object[]} results   Array from searchMangaAll
 * @param {number|null} chapterHint  Current chapter being read, or null
 * @returns {object|null}
 */
export function pickBestMedia(results, chapterHint = null) {
  if (!results || results.length === 0) return null;
  if (results.length === 1) return results[0];

  // Apply chapter-count filter first: drop results whose total chapters are
  // known AND less than the current chapter (they can't possibly be right).
  let candidates = results;
  if (chapterHint != null && chapterHint > 0) {
    const compatible = results.filter(m => m.chapters == null || m.chapters >= chapterHint);
    if (compatible.length > 0) candidates = compatible;
  }

  // Among remaining candidates prefer the one(s) the user is tracking.
  const tracked = candidates.filter(m => m.mediaListEntry != null);
  if (tracked.length === 1) return tracked[0];
  if (tracked.length > 1) {
    // Multiple tracked — still apply chapter-count tiebreaker if available.
    // Prefer ongoing (chapters == null) over finished series when ambiguous.
    const ongoing = tracked.filter(m => m.chapters == null);
    if (ongoing.length === 1) return ongoing[0];
    return tracked[0]; // give up and take first tracked
  }

  // Nothing tracked — best we can do is first candidate.
  return candidates[0];
}

/**
 * Get the user's MediaList entry for a specific manga.
 * Returns null if the manga is not in the list.
 * @param {number} userId
 * @param {number} mediaId
 * @param {string} accessToken
 * @returns {Promise<object|null>}
 */
export async function getMediaListEntry(userId, mediaId, accessToken) {
  try {
    const data = await graphql(GET_MEDIA_LIST_ENTRY_QUERY, { mediaId, userId }, accessToken);
    return data.MediaList || null;
  } catch {
    return null;
  }
}

/**
 * Update the user's progress for a manga.
 * If the entry doesn't exist yet, status defaults to CURRENT.
 * @param {number} mediaId
 * @param {number} progress  Chapter number to set
 * @param {string} accessToken
 * @param {string} [status]  AniList MediaListStatus (optional override)
 * @returns {Promise<object>}
 */
export async function updateProgress(mediaId, progress, accessToken, status = 'CURRENT') {
  const data = await graphql(
    SAVE_MEDIA_LIST_ENTRY_MUTATION,
    { mediaId, progress, status },
    accessToken
  );
  return data.SaveMediaListEntry;
}

/**
 * Update the user's score for a manga entry.
 * @param {number} mediaId
 * @param {number} score  Score value (respects the user's AniList scoring format)
 * @param {string} accessToken
 * @returns {Promise<object>}
 */
export async function updateScore(mediaId, score, accessToken) {
  const data = await graphql(SAVE_SCORE_MUTATION, { mediaId, score }, accessToken);
  return data.SaveMediaListEntry;
}

/**
 * Build the AniList OAuth authorization URL.
 * @param {string} clientId  AniList application client ID
 * @param {string} redirectUri
 * @returns {string}
 */
export function buildOAuthUrl(clientId, redirectUri) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
  });
  return `${ANILIST_OAUTH_URL}?${params.toString()}`;
}
