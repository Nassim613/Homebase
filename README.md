# Homebase — Phase 1 + 2 + 3 + 4 build

This build covers **Finance**, **Jazz + Weight**, **Garage**, and now **More/Settings** end to end. Every tab is functional.

## What works right now

**Finance**: add expense/income/transfer entries with category/store auto-fill and conditional fields (car, project, given-to, car-insurance split); tap any entry to view it full-screen and Edit, Duplicate, or Delete; adding a category or store opens its own dedicated page (with an icon picker for categories, and a photo upload for store logos) instead of a popup; categories & stores manager; day-grouped search; monthly net summary; offline-first with sync status.

**Jazz**: log health issues (type, severity, status, description, medication + cost, vet visit + cost, up to 6 photos); issue threads with follow-up updates and resolve; Jazz's own weigh-ins; mini report.

**Weight**: Nassim/Safia toggle, latest reading with change-since-last, a trend chart with 3M/6M/1Y/All time range filters, full history.

**Garage**: add a vehicle (photos, ownership doc, full details); vehicle detail with correctly computed Total Spent and Profit; add a cost with repair subtypes; Mark as Sold flow; All Repairs cross-vehicle log; Owned + Flips reports with clickable charts and drill-down.

**More/Settings**: paste your Google Sheet Web App URL here to turn sync on — **sync now covers Finance, Categories, Stores, Jazz, Weight, and Garage**, each writing to its own tab in your Sheet (store logos stay local-only, same reasoning as other photos). Also includes a Cars & Projects manager (needed for Finance's conditional fields, and for Car Insurance's multi-car split), a Garage Expense & Repair Types manager, a "Force full resync" option for rebuilding your Sheet from scratch, and quick links to the Finance and Jazz reports.

## How to test with real data

1. Follow the Sheet setup steps below to get your Web App URL
2. Open the app → **More** tab → paste the URL under "Sync & data" → Save
3. Before adding real entries, go to **More → Cars & projects** and add any cars (needed for Gas/Car Maintenance/Car Insurance categories) and projects (needed for House Maintenance) you use
4. Start adding entries — they'll save locally instantly and push to your Sheet in the background; watch the sync pill in the header

## Importing your historical data

If you converted an existing spreadsheet (AppSheet export, old tracker, etc.) into `import-data.json`, bring it in like this:

1. Set up your Google Sheet connection first (steps above) so imported data starts syncing right away
2. Open the app → **More** tab → **Import historical data** → choose your `import-data.json` file
3. The app reads it directly in your browser and writes everything into local storage — the file itself never gets uploaded anywhere or committed to your GitHub repo
4. Categories, stores, cars, projects, and Garage's expense/repair types are merged by name with whatever the app already has, so you won't end up with duplicates
5. Once imported, everything syncs to your Sheet in the background like normal — for a large import (thousands of entries) this can take a few minutes; leave the app open and watch the sync pill

**Known limits of the converted data:**
- Photos, receipts, and vehicle images aren't included — only the historical text/number data. The original spreadsheet's Drive image paths aren't reachable from the app.
- If your original data didn't cleanly separate "vet visit" from a general note, that distinction wasn't guessable from the source data and defaults to "no vet visit" — you can edit individual issues afterward.
- Any context fields your old tracker had that don't have a matching field in Homebase (e.g. weather, diet notes) get folded into the description text rather than dropped, so nothing is lost — it's just not in its own field.

- Recurring entries (needs an Apps Script time-trigger to fire even when the app's closed — bigger piece, deliberately saved for last)
- Full Finance Reports page (charts, Utilities/Cars/Transfers sub-views, month accordion) — currently a placeholder reachable from the main Finance screen or More
- **Photos stay local-only for now.** Vehicle photos, receipts, and Jazz's issue photos sync everywhere *except* to your Sheet/Drive — pushing base64 images through Apps Script would blow past Google Sheets' per-cell size limit. All the metadata around them (costs, descriptions, dates, amounts) syncs fully. Proper photo upload to Drive (matching what your old AppSheet app did) is a distinct follow-up piece.
- Updates to an already-synced item (adding a Jazz issue update, marking an issue resolved, marking a vehicle sold) append a fresh snapshot row to the Sheet rather than editing the original row in place — so the Sheet is an append-only history log, not a live mirror of current state. Your phone's local copy is always the up-to-date one.

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

To push an update later, just upload the changed files again to the same repository — the live link stays the same.

## 2. Connect it to a Google Sheet

1. Go to **sheets.google.com** and create a new blank spreadsheet — name it "Homebase Data"
2. In the Sheet, click **Extensions → Apps Script**
3. Delete any placeholder code, and paste in the contents of `google-apps-script.gs` (included in this download)
4. Click **Deploy → New deployment**
5. Click the gear icon next to "Select type" → choose **Web app**
6. Set **Execute as: Me**, and **Who has access: Anyone**
7. Click **Deploy** — approve the authorization prompt the first time
8. Copy the **Web app URL** it gives you (ends in `/exec`)
9. Open Homebase on your phone → for now, open your browser's dev tools or just wait for the Settings screen in a later phase — a temporary way to set this is described below

**Temporary note for Phase 1**: the Settings screen (where you'd normally paste this URL) hasn't been built yet — that's part of the More tab in Phase 4. For now, sync will show "Not connected" until that screen exists. Everything still works locally on your device in the meantime; nothing is lost, it'll just start syncing once Settings is built.

## 3. Sharing this app with someone else

Same principle as before — anyone installs from the same link. To share your data with your wife, she'd eventually paste the same Sheet URL into her own Settings once that screen exists. For your brother to have fully separate data, he'd create his own Sheet and his own Apps Script deployment, same steps above, and use his own resulting URL.
