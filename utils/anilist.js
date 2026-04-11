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
