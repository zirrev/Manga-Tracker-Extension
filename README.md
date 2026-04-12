# AniList Manga Tracker

A Chrome extension that automatically tracks your manga reading progress on [AniList](https://anilist.co) as you read on supported sites.

**Supported sites:**
- [WeebCentral](https://weebcentral.com)
- [MangaDex](https://mangadex.org)
- [MangaPlus](https://mangaplus.shueisha.co.jp)

---

## Installation

This extension is loaded manually as an unpacked extension — it is not on the Chrome Web Store.

### 1. Download the extension

**Option A — Clone with Git:**
```bash
git clone https://github.com/zirrev/anilist_ext.git
```

**Option B — Download ZIP:**
1. Click the green **Code** button on this page
2. Select **Download ZIP**
3. Extract the ZIP to a folder on your computer

### 2. Load it into Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** using the toggle in the top-right corner
3. Click **Load unpacked**
4. Select the folder you cloned or extracted in Step 1
5. The **AniList Manga Tracker** extension will appear in your extensions list

### 3. Pin the extension (recommended)

1. Click the puzzle piece icon in the Chrome toolbar
2. Find **AniList Manga Tracker** and click the pin icon so it stays visible in the toolbar

---

## Setup

### Connect your AniList account

1. Click the extension icon in the toolbar
2. Click **Login with AniList**
3. You will be redirected to AniList to authorize the extension
4. After approving, you will be logged in and ready to track

---

## How it works

1. Open a supported manga site and navigate to a chapter
2. Click the extension icon — it will detect the manga title and chapter you are on
3. Click **Mark as Read** to sync your progress to AniList

The extension also shows your current AniList progress and score for the manga you are reading.

---

## Settings

Click the avatar icon in the extension popup, then select **Settings** to configure:

- **Show Progress** — display your AniList chapter progress in the popup
- **Show Score** — display your AniList score for the current manga
- **Show Sync Log** — show recent sync history at the bottom of the popup
- **Round profile picture** — crop your avatar to a circle in the header
- **Notifications** — toggle desktop notifications for sync success and errors

---

## Troubleshooting

**The extension doesn't detect a chapter on the page.**
Try clicking the refresh button (circular arrow) in the top-right of the popup. If it still doesn't detect anything, make sure you are on an actual chapter page, not a series/listing page.

**"Not found on AniList" appears.**
The manga may not be in your AniList library yet. Click **Add to List** in the popup to add it, then try again.

**Login doesn't complete.**
Make sure pop-ups are not blocked for `anilist.co` in Chrome. Try logging out and back in via the Settings page.
