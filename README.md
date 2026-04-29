# Luggage Discount Intelligence — India
### 6 company groups · 10 brands · Live Amazon.in & Flipkart price scraping

---

## Completed Features

### Core Dashboard
- Live scraping of Amazon.in and Flipkart listing pages via Firecrawl API
- 10 brands tracked: VIP, Skybags, Carlton, Aristocrat, Safari, Samsonite, American Tourister, HRX, Uppercase, Nasher Miles
- 6 company groups with colour-coded analytics
- Discount % = (MRP − Selling) ÷ MRP × 100, pure arithmetic, no modelling
- Company summary cards with brand-positioning archetypes (Premium Hold / Selective Promoter / Market-Share Play / Liquidation Signal / Growth Push)
- Avg discount bar chart by brand, discount distribution curves, price tier heatmap

### Executive Summary (3 investor-ready cards)
- Card 1: Market Archetype — who is playing what game
- Card 2: Price Spectrum — entry price, top MRP, deepest cut per company
- Card 3: Investor Signal — pricing momentum scorecard with plain-English takeaway

### Trend History Tab
- Continuous line chart of company avg discount across refresh sessions
- Per-brand sparkline grid (10 brands)
- SKU count trend bar chart
- Run log table with delta indicators

### 📊 Margin Intelligence Tab (NEW)
- Marries live discount data with quarterly-reported gross margins
- Sources:
  - VIP Industries: NSE filings, Q3 FY26 (audited)
  - Safari Industries: NSE filings, Q3 FY26 (audited)
  - Samsonite Group: HKEx interim report H1 2024 (audited, gross margin 60.2%)
  - HRX, Uppercase, Nasher Miles: estimated from funding/revenue disclosures (clearly labelled ESTIMATED)
- Classification: Marketing Tactic / Liquidation Signal / Margin Distress / Growth Push / Premium Hold / Selective Promoter / Headroom Warning
- Classification logic: if gross margins are stable while discounts are high → Marketing Tactic. If gross margins are compressing + discounts are deep + revenue is declining → Liquidation Signal.
- Sector comparison chart: gross margin (filings) vs live discount (scraped) side-by-side
- Gross margin trend mini-charts per company
- Margin headroom: gross margin minus live discount %
- Full methodology and caveats block

## Navigation
| Button | View |
|---|---|
| (default) | Main Dashboard |
| 📊 Margin Intelligence | Margin Intelligence Tab |
| 📈 Trend History (N) | Trend History Tab |
| Company card click | Company Detail |
| Brand row click | Brand Detail |
| Tier Heatmap click | Price Tier Detail |
| Ctrl+Shift+A | Admin Panel |

## Data Models
- `STATE.curr`: current scrape stats (companyStats[], brandStats[], each with skus[])
- `STATE.history`: array of snapshots (max 10), each with ts, label, stats, skuCount, per-company avg
- `ldi_margin_data` (localStorage key): JSON array of 6 company margin records — stores grossMargin, ebitdaMargin, quarterlyGrossMargins, period, source, isEstimated, lastUpdated. Read/written entirely client-side via lsGetMargins()/lsSaveMargins(). No server or database required. Edit via the ✏️ icon in the Margin Intelligence tab — saves instantly to localStorage.

## Not Yet Implemented
- Persistent history across page reloads (session-only today)
- Auto-ingestion of margin data from NSE/BSE filing APIs (currently manual update via ✏️)
- Email/export of exec summary cards
- Mobile-optimised layout for History and Margin tabs

---

## Deployment Guide
### No coding needed. Takes 10 minutes. Completely free.

---

## What you need to do (overview)
1. Create a free GitHub account and upload the files there
2. Connect GitHub to a free Vercel account — it auto-deploys
3. Your dashboard is live at a permanent URL

---

## STEP 1 — Create a free GitHub account

1. Go to **https://github.com**
2. Click **Sign up** (top right)
3. Enter your email, create a password, choose a username
4. Verify your email — done

---

## STEP 2 — Create a new repository on GitHub

A "repository" is just a folder on GitHub that holds your files.

1. Once logged in to GitHub, click the **+** icon (top right corner)
2. Click **New repository**
3. Under **Repository name**, type: `luggage-dashboard`
4. Make sure **Private** is selected (so only you can see the code)
5. Scroll down, click the green **Create repository** button

---

## STEP 3 — Upload your files to GitHub

You need to upload these exact files from the Genspark File Explorer:
- `index.html`
- `vercel.json`
- The `api` folder containing `fetch-brand.js` and `fetch-insight.js`

**To upload:**

1. On your new repository page, click **uploading an existing file** (you'll see this link in the middle of the page)
2. Download the files from Genspark first:
   - In Genspark, click **File Explorer** tab
   - Download `index.html`, `vercel.json`
3. Drag all files into the GitHub upload box
4. For the `api` folder — you need to upload the files inside it. Click **choose your files**, navigate into the `api` folder, select both `fetch-brand.js` and `fetch-insight.js`
   - GitHub will automatically create the `api/` folder structure
5. At the bottom, click the green **Commit changes** button

---

## STEP 4 — Create a free Vercel account

1. Go to **https://vercel.com**
2. Click **Sign Up**
3. Click **Continue with GitHub** — this connects your GitHub automatically
4. Authorise Vercel to access your GitHub

---

## STEP 5 — Deploy your dashboard on Vercel

1. Once logged in to Vercel, click **Add New Project** (or **New Project**)
2. You'll see your GitHub repositories listed — click **Import** next to `luggage-dashboard`
3. On the next screen, don't change anything — just click the big **Deploy** button
4. Wait about 60 seconds — Vercel will build and deploy
5. You'll see a **Congratulations** screen with your live URL, something like:
   ```
   https://luggage-dashboard-abc123.vercel.app
   ```
6. Click that URL — your dashboard is live!

---

## STEP 6 — Test it works

1. Open your Vercel URL
2. Click **▶ Fetch Live Data**
3. Wait 2–3 minutes
4. You should see all 7 brands with live prices and charts

---

## That's it — you're done!

Share the Vercel URL with your customer. It will work every time they visit it and click Fetch.

---

## If you ever need to update the dashboard

1. Go to **https://github.com** → your `luggage-dashboard` repository
2. Click on the file you want to update (e.g. `index.html`)
3. Click the **pencil icon** (Edit) on the right
4. Make changes
5. Click **Commit changes**
6. Vercel automatically redeploys within 30 seconds — your live URL updates instantly

---

## Troubleshooting

**"Function timed out"** — Genspark is taking too long. Just click Try Again.

**"GS_KEY not set"** — This means the API key wasn't included. The key is already baked into the server files so this shouldn't happen. If it does, contact support.

**Dashboard loads but shows no data** — Make sure you're on the Vercel URL (not the Genspark preview).
# luggagedashboard
