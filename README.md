# Homebase

A personal PWA for household management — Finance, Jazz's health, Weight, Garage (vehicle flips), Documents, Passwords, and now **Builds** (construction/renovation project tracking) — all synced to your own Google Sheet, with photos and files stored in your Google Drive.

## What works right now

**Finance**: add expense/income/transfer entries with category/store auto-fill and conditional fields (car, project, given-to, car-insurance split); tap any entry to view it full-screen and Edit, Duplicate, or Delete; adding a category or store opens its own dedicated page (with an icon picker for categories, and a photo upload for store logos); categories & stores manager; day-grouped search with range/type filters; recurring entries (generated automatically both by the app and by a daily Apps Script trigger, so they still fire even when the app's closed); a full Reports page with charts, drill-down, and a monthly/weekly emailed summary.

**Jazz**: log health issues (type, severity, status, description, medication + cost, vet visit + cost, up to 6 photos); issue threads with follow-up updates and resolve; Jazz's own weigh-ins; mini report.

**Weight**: Nassim/Safia toggle, latest reading with change-since-last, a trend chart with 3M/6M/1Y/All time range filters, full history.

**Garage**: add a vehicle (photos, ownership doc, full details); vehicle detail with correctly computed Total Spent and Profit; add a cost with repair subtypes; Mark as Sold flow; All Repairs cross-vehicle log; Owned + Flips reports with clickable charts and drill-down.

**Documents**: folders backed by real Google Drive storage, each with a cover image, icon, and a list of files (photos or PDFs) with editable names and type badges.

**Passwords**: a shared list between you and Safia (site, username, password, notes) — excluded from the automatic Sheet backups and edit-history tabs that everything else gets, since there's no reason to keep old passwords around once changed.

**Builds** *(new)*: track construction/renovation projects — a top-level **project** (e.g. "Backyard") containing one or more **sub-projects** (e.g. "Garage," "Fence"), each with its own **expenses**. Specifically:
- Budgets are optional at both the project and sub-project level — leave them blank to just track spend, or set one to see a progress bar.
- Each sub-project is tagged **DIY**, **Contractor**, or **Mixed**. Contractor and Mixed sub-projects get a contractor-tracking card: company name, scope, contract total, amount paid, and a phase checklist (default: Permit → Foundation → Framing → Roofing → Complete) that you can reorder, delete from, or add custom phases to. Tapping a phase marks it current and auto-completes everything before it.
- Expenses can be tagged with a **category** (its own list, managed in Settings → Build categories — rename anytime, delete only once unused, otherwise hide/restore) and a **store**, picked from the same Stores list Finance uses (same logos, same "add new store" flow).
- Photos can be attached at every level — project cover photos, sub-project photos, and expense receipts — all uploading to Drive the same way Documents and vehicle photos do.
- Expense icons are auto-detected from the description (e.g. "garage door opener" → a garage icon, "electrician" → a bolt icon), falling back to the category's icon, with a manual picker to override.
- New Google Sheet tabs: **Builds**, **SubBuilds**, **BuildExpenses**, **BuildCategories** — kept intentionally separate from the older, simpler **Projects** tab (which is still just a flat tag list used by Finance's "House maintenance" category and isn't related to this feature).

**Settings**: paste your Google Sheet Web App URL under **Sync & data** to turn sync on — this now covers every section above, each writing to its own tab in your Sheet. Also includes a Cars & Projects manager (for Finance's conditional fields), a Garage Expense & Repair Types manager, a Build Categories manager, an Issue Types manager for Jazz, a "Force full resync" option for rebuilding your Sheet from scratch, and quick links to the Finance and Jazz reports.

## How sync actually works

- Every record has exactly **one row** in its Sheet tab — editing something updates that row in place, and deleting removes it entirely, rather than appending new rows over time. Before a row is overwritten or removed, its previous contents are archived to a matching `<Sheet> Changes` tab, so you always have a full edit history without the live tab getting cluttered.
- **Photos and files genuinely upload to your Google Drive** (into a "Homebase Photos" or "Homebase Documents" folder, organized by section), not just locally. What stays local-only is the raw base64 preview used before an upload finishes — once it's synced, everyone sees the real Drive-hosted image.
- The whole spreadsheet is automatically backed up to a "Homebase Backups" folder in your Drive roughly every 12 hours, keeping the most recent 14 copies (with Passwords stripped out of each backup).
- Access is controlled by real Google Sign-In, not just knowing the app's URL — see "Sharing this app with someone else" below.

## How to test with real data

1. Follow the Sheet setup steps below to get your Web App URL
2. Open the app → **Settings → Sync & data** → paste the URL → Save
3. Sign in with a Google account that's on the `ALLOWED_USERS` list in the Apps Script (see setup below)
4. Before adding real entries, go to **Settings → Cars & projects** and add any cars/projects you use, and **Settings → Build categories** if you're using Builds
5. Start adding entries — they save locally instantly and push to your Sheet in the background; watch the sync pill in the header

## Importing your historical data

If you converted an existing spreadsheet (AppSheet export, old tracker, etc.) into `import-data.json`, bring it in like this:

1. Set up your Google Sheet connection first (steps above) so imported data starts syncing right away
2. Open the app → **Settings** → **Import historical data** → choose your `import-data.json` file
3. The app reads it directly in your browser and writes everything into local storage — the file itself never gets uploaded anywhere or committed to your GitHub repo
4. Categories, stores, cars, projects, and Garage's expense/repair types are merged by name with whatever the app already has, so you won't end up with duplicates
5. Once imported, everything syncs to your Sheet in the background like normal — for a large import (thousands of entries) this can take a few minutes; leave the app open and watch the sync pill

**Known limits of the converted data:**
- Photos, receipts, and vehicle images aren't included in the import itself — only the historical text/number data. The original spreadsheet's Drive image paths aren't reachable from the app. (This is separate from normal day-to-day photo uploads going forward, which do work — see "How sync actually works" above.)
- If your original data didn't cleanly separate "vet visit" from a general note, that distinction wasn't guessable from the source data and defaults to "no vet visit" — you can edit individual issues afterward.
- Any context fields your old tracker had that don't have a matching field in Homebase (e.g. weather, diet notes) get folded into the description text rather than dropped, so nothing is lost — it's just not in its own field.

## 1. Get the app on your phone

You need to host these files somewhere with HTTPS so it can be installed. We're using **GitHub Pages** — free, and updates always redeploy to the same URL.

1. Create a free account at **github.com** if you don't have one
2. Create a new repository (e.g. named `homebase`) — set it to **Public**
3. Upload all the files from this download into that repository
4. In the repo, go to **Settings → Pages**
5. Under "Source," choose **Deploy from a branch**, pick the `main` branch and `/ (root)` folder, then **Save**
6. GitHub gives you a link like `https://your-username.github.io/homebase/` — it can take a minute to go live the first time
7. Open that link on your phone in Safari (iPhone) or Chrome (Android)
8. iPhone: tap Share → **Add to Home Screen**. Android: tap the menu (⋮) → **Add to Home screen**

To push an update later, just upload the changed files again to the same repository — the live link stays the same. If the update touched `storage.js` (a new `DB_VERSION`) or `sw.js` (a new `CACHE` name), you may need to fully close and reopen the installed app once, or reinstall it, for the change to take effect.

## 2. Connect it to a Google Sheet

1. Go to **sheets.google.com** and create a new blank spreadsheet — name it "Homebase Data"
2. In the Sheet, click **Extensions → Apps Script**
3. Delete any placeholder code, and paste in the contents of `google-apps-script-full.gs` (included in this download)
4. In `GOOGLE_CLIENT_ID`, make sure the value matches the one in `auth.js` — they must be identical (a fresh setup would mean generating your own OAuth client ID in Google Cloud Console and updating both files)
5. In `ALLOWED_USERS`, list the Google account email(s) allowed to use this Sheet
6. Click **Deploy → New deployment**
7. Click the gear icon next to "Select type" → choose **Web app**
8. Set **Execute as: Me**, and **Who has access: Anyone** (this is correct and intentional — see the comment at the top of the script for why)
9. Click **Deploy** — approve the authorization prompt the first time
10. In the Apps Script editor, run `authorizeDriveAccess` once and `authorizeExternalRequests` once (select each from the function dropdown next to "Run") — these trigger the permission prompts Drive uploads and sign-in verification need
11. Optionally run `setupSheetBackups`, `setupDailyTrigger`, and `setupReportTriggers` once each to turn on automatic backups, recurring-entry generation, and emailed Finance reports
12. Copy the **Web app URL** it gives you (ends in `/exec`)
13. Open Homebase on your phone → **Settings → Sync & data** → paste the URL → Save
14. Sign in with one of the Google accounts from your `ALLOWED_USERS` list

## 3. Sharing this app with someone else

Anyone installs from the same public GitHub Pages link — the app itself isn't restricted. What's restricted is **syncing**, which requires signing in with a Google account on the `ALLOWED_USERS` list in the Apps Script:

- **To share your data with someone** (e.g. your wife): add their Google account email to `ALLOWED_USERS` in the Apps Script, redeploy (**Deploy → Manage deployments → Edit → New version**), and have them open the app and sign in with that account — no separate URL needed, since `sync.js` already has your deployment's URL saved as its fallback default.
- **For someone to have fully separate data** (e.g. a sibling with their own household): they'd need their own Google Sheet, their own Apps Script deployment (steps above), and their own `GOOGLE_CLIENT_ID` — then either paste their own Web App URL into their Settings on first launch, or change the `DEFAULT_SHEET_URL` constant in their copy of `sync.js` before hosting it, so a fresh install already points at their Sheet instead of yours.
