# AniList Manga Tracker — Product Requirements Document

**Version:** 1.0
**Status:** Draft
**Date:** April 10, 2026
**Platform:** Google Chrome Extension (Manifest V3)
**Target Users:** Manga readers who track their progress on AniList

---

## 1. Overview

### 1.1 Problem Statement

Manga readers who use AniList to track their reading progress must manually update their chapter count after each reading session. This is tedious, easy to forget, and leads to inaccurate tracking. Readers lose the habit of logging, causing their AniList to fall out of sync with their actual progress.

### 1.2 Proposed Solution

A Chrome extension that monitors the user's active manga reading tab, automatically detects the current manga title and chapter number, and updates AniList progress — either automatically when the reader scrolls past 80% of a chapter, or manually via the extension popup.

### 1.3 Goals

- Eliminate manual AniList chapter updates for manga readers
- Support the most popular manga reading sites with priority on WeebCentral
- Provide a clean, informative popup showing reading status and AniList data
- Respect user control with a manual override button and configurable settings

### 1.4 Non-Goals

- Tracking anime (manga only)
- Supporting sites beyond the three listed in scope
- Background syncing or periodic polling of AniList
- Building a custom reading list UI — AniList is the source of truth

---

## 2. Scope & Supported Sites

WeebCentral is the highest priority site and must be fully functional in the MVP.

| Site | URL | Priority | MVP |
|------|-----|----------|-----|
| WeebCentral | weebcentral.com | P0 (Highest) | ✅ |
| MangaDex | mangadex.org | P1 | ✅ |
| MangaPlus | mangaplus.shueisha.co.jp | P1 | ✅ |

---

## 3. User Stories

### 3.1 Authentication

- As a user, I want to log in to my AniList account via OAuth so the extension can update my list securely.
- As a user, I want to stay logged in across browser sessions so I don't have to re-authenticate every time.
- As a user, I want to log out and disconnect the extension from my AniList account.

### 3.2 Chapter Detection

- As a user reading on WeebCentral, MangaDex, or MangaPlus, I want the extension to automatically detect the manga title and chapter number I'm currently reading.
- As a user, I want chapter detection to use the page URL as the primary source, falling back to page text only if the URL doesn't contain enough information.

### 3.3 Progress Updates

- As a user, I want my AniList progress to automatically update after I scroll past 80% of a chapter, so I don't need to do anything manually.
- As a user, I want a "Mark as Read" button in the popup so I can manually trigger an update at any point.
- As a user, I want to be prompted to add a manga to my AniList if it isn't already on my list, rather than having it added silently.

### 3.4 Popup UI

- As a user, I want the extension popup to show me: the currently detected manga title and chapter, my AniList progress, my score/rating for that manga, and a recent sync log.
- As a user, I want to be able to hide or show individual sections of the popup from a settings panel.

### 3.5 Notifications

- As a user, I want to optionally receive a browser notification when a chapter is successfully synced to AniList.
- As a user, I want to optionally receive a notification when a sync fails so I know something went wrong.
- As a user, I want to control notification settings from within the extension.

---

## 4. Functional Requirements

### 4.1 Authentication & Authorization

| ID | Feature | Description | Priority |
|----|---------|-------------|----------|
| F-01 | OAuth Login | Extension opens an AniList OAuth flow in a new tab/popup. On success, stores the access token securely via `chrome.storage.local`. | P0 |
| F-02 | Persistent Session | Access token persists across browser restarts. Extension detects expired tokens and prompts re-authentication. | P0 |
| F-03 | Logout | User can disconnect AniList account. Clears all stored tokens and cached data. | P1 |

### 4.2 Chapter Detection

| ID | Feature | Description | Priority |
|----|---------|-------------|----------|
| F-04 | URL Parsing | Content script parses the active tab URL to extract manga title slug and chapter number. Each supported site has a dedicated URL parser. | P0 |
| F-05 | DOM Fallback | If URL parsing fails to return a chapter number, the content script scans visible page text for patterns like "Chapter 45" or "Ch. 45" as a fallback. | P1 |
| F-06 | Title Matching | The extracted title is normalized (lowercased, punctuation stripped) and matched to an AniList entry using the AniList GraphQL search API. | P0 |
| F-07 | Site Detection | The extension activates only on supported domains. The browser action badge/icon updates to indicate active vs. inactive state. | P0 |

### 4.3 Progress Tracking

| ID | Feature | Description | Priority |
|----|---------|-------------|----------|
| F-08 | Scroll Threshold | Content script tracks scroll depth. When the user scrolls past 80% of the page height, the chapter is flagged as read and an update is triggered. | P0 |
| F-09 | Manual Mark as Read | Popup includes a "Mark as Read" button that immediately triggers an AniList update for the currently detected chapter. | P0 |
| F-10 | Duplicate Prevention | Extension checks current AniList progress before updating. Does not re-submit if the chapter is already marked as read. | P0 |
| F-11 | Add to List Prompt | If the manga is not on the user's AniList, the extension prompts: "This manga is not in your list. Add it?" with options to add or dismiss. | P1 |

### 4.4 Popup UI

| ID | Feature | Description | Priority |
|----|---------|-------------|----------|
| F-12 | Current Detection Display | Shows detected manga title and chapter number from the active tab. Shows a placeholder if no supported site is active. | P0 |
| F-13 | AniList Progress | Shows the user's current progress on that manga from AniList (e.g., Ch. 44 / 120). | P0 |
| F-14 | Score Display | Shows the user's AniList score/rating for the manga if set. | P1 |
| F-15 | Sync Log | Shows a log of recent sync events (e.g., "Ch. 44 synced 5 min ago"). Stores last 10 entries locally. | P1 |
| F-16 | Settings Panel | A settings gear icon opens a panel where the user can toggle visibility of each popup section (progress, score, log) and configure notifications. | P1 |

### 4.5 Notifications

| ID | Feature | Description | Priority |
|----|---------|-------------|----------|
| F-17 | Success Notification | Optionally shows a Chrome notification when a chapter is successfully synced. Disabled by default. Configurable in settings. | P1 |
| F-18 | Error Notification | Optionally shows a notification when a sync fails (e.g., network error, API error). Configurable independently from success notifications. | P1 |

---

## 5. Technical Architecture

### 5.1 Extension Structure (Manifest V3)

```
├── manifest.json                  # Permissions, content scripts, service worker
├── background/
│   └── service-worker.js          # OAuth flow, AniList API calls, storage
├── content/
│   └── content-script.js          # URL parsing, scroll tracking, DOM fallback
├── popup/
│   ├── popup.html
│   └── popup.js                   # Extension popup UI
├── settings/
│   ├── settings.html
│   └── settings.js                # Settings panel
└── utils/
    ├── anilist.js                  # AniList GraphQL query/mutation helpers
    └── sites.js                   # Site-specific URL parsers
```

### 5.2 AniList Integration

The extension uses the AniList GraphQL API (`https://graphql.anilist.co`). Key operations:

- **Search manga by title** — `Media` query with `type: MANGA, search: <title>`
- **Get user's list entry** — `MediaList` query for a specific media ID
- **Update progress** — `SaveMediaListEntry` mutation with `mediaId` and `progress`
- **OAuth endpoint** — `https://anilist.co/api/v2/oauth/authorize`

### 5.3 Chapter Detection Logic

Priority order for chapter detection:

1. Extract chapter number from URL using a site-specific regex pattern
2. If URL yields no chapter, scan document title and visible heading text for "Chapter N" or "Ch. N" pattern
3. If still unresolved, show "Chapter not detected" in popup — do not attempt an update

### 5.4 Scroll Tracking

A content script listens to the `scroll` event on each supported page. It calculates:

```
scrollDepth = (scrollY + window.innerHeight) / document.body.scrollHeight
```

When `scrollDepth >= 0.80` for the first time on a given chapter URL, it sends a message to the service worker to trigger an AniList update. The triggered state resets on navigation to a new chapter URL.

### 5.5 Storage Schema

`chrome.storage.local` keys:

| Key | Type | Description |
|-----|------|-------------|
| `auth.accessToken` | string | AniList OAuth access token |
| `auth.userId` | number | AniList user ID |
| `settings.notifications.success` | boolean | Show notification on successful sync |
| `settings.notifications.error` | boolean | Show notification on sync failure |
| `settings.popup.showProgress` | boolean | Show progress panel in popup |
| `settings.popup.showScore` | boolean | Show score in popup |
| `settings.popup.showLog` | boolean | Show sync log in popup |
| `syncLog` | array | Last 10 sync events `{ title, chapter, timestamp, status }` |

---

## 6. Site-Specific Implementation Notes

### 6.1 WeebCentral (P0)

WeebCentral is the primary supported site and the first to be implemented. The URL structure should be reverse-engineered to identify the manga slug and chapter number segments. The content script must handle WeebCentral's reader page structure for both scroll tracking and DOM fallback.

### 6.2 MangaDex (P1)

MangaDex uses structured URLs in the format `/chapter/{uuid}`. Because UUIDs don't embed chapter numbers, the content script must additionally call the MangaDex public API (`api.mangadex.org`) to resolve the chapter number and manga title from the chapter UUID.

### 6.3 MangaPlus (P1)

MangaPlus uses numeric IDs in URLs. Chapter number and title may need to be extracted from the page DOM since the URL structure may not directly include a human-readable chapter number. DOM fallback is expected to be the primary path for MangaPlus.

---

## 7. UX & Design Guidelines

### 7.1 Popup Layout

The popup should be compact (max 380px wide). Suggested section layout from top to bottom:

1. **Header** — Extension name, AniList login status, settings gear icon
2. **Detection Panel** — Currently detected manga title + chapter number
3. **Progress Panel** — AniList progress (e.g., Ch. 44 / 120) and score
4. **Mark as Read Button** — Prominent CTA, disabled if manga not detected or already up to date
5. **Sync Log** — Collapsible list of recent events

### 7.2 States to Handle

| State | Expected Behavior |
|-------|-------------------|
| Not on a supported site | Show message indicating extension is inactive |
| On a supported site, not logged in | Show AniList login CTA |
| Manga not found on AniList | Show search result + Add to List prompt |
| Already up to date | "Mark as Read" button disabled with tooltip |
| Sync in progress | Loading spinner on button |
| Sync error | Inline error message in popup |

---

## 8. Required Chrome Permissions

| Permission | Reason |
|------------|--------|
| `storage` | Store OAuth tokens, settings, and sync log |
| `identity` | Manage the OAuth flow with AniList |
| `activeTab` | Read the URL and DOM of the current tab |
| `scripting` | Inject content scripts for scroll tracking |
| `notifications` | Show optional sync success/error notifications |
| `host_permissions` | Required for weebcentral.com, mangadex.org, mangaplus.shueisha.co.jp, and graphql.anilist.co |

---

## 9. Out of Scope & Future Considerations

### 9.1 Out of Scope for V1

- Anime tracking
- Background sync / periodic AniList polling
- Support for sites outside WeebCentral, MangaDex, MangaPlus
- Offline queue (retrying failed syncs when connectivity returns)
- Custom scroll threshold configuration

### 9.2 Future Enhancements

- **Offline sync queue** — Queue updates when offline, retry on reconnect
- **Configurable scroll threshold** — Let users set their own read percentage (e.g., 70%, 90%)
- **Additional site support** — MangaFox, Webtoon, etc.
- **Auto-complete on final chapter** — Automatically mark manga as "Completed" when the last chapter is read
- **Rating prompt** — After finishing a manga, prompt the user to set a score
- **Reading stats** — Weekly/monthly summary of chapters read

---

## 10. Open Questions

- **WeebCentral URL structure** — Needs investigation to confirm the exact URL pattern for manga slug and chapter number extraction before development begins.
- **MangaDex API rate limits** — The MangaDex public API may impose rate limits. Need to confirm chapter UUID resolution calls will remain within acceptable limits during normal reading.
- **AniList title matching accuracy** — Fuzzy matching between a site's manga slug and AniList titles may produce incorrect results for some titles. A disambiguation UI may be needed.
- **OAuth redirect URI** — AniList OAuth requires a registered redirect URI. This must be set up via an AniList API client registration at anilist.co/settings/developer before implementation.
