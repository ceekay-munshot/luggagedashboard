# Luggage Discount & Price Intelligence — India

Live discount **and selling-price** intelligence for the Indian luggage market —
**6 company groups · 10 brands · live Amazon.in & Flipkart scraping.**

Brands tracked: VIP, Skybags, Carlton, Aristocrat (VIP Group) · Safari (Safari
Industries) · Samsonite, American Tourister (Samsonite Group) · HRX · Uppercase ·
Nasher Miles.

---

## What it does

Open the dashboard and click **▶ Fetch Live Data**. It reads current Amazon.in and
Flipkart listing pages for each brand, extracts MRP + selling price for every
product, and builds:

- **Main dashboard** — avg discount by company/brand, distribution, price-tier heatmap,
  company "strategy" cards, investor-style executive summary.
- **💰 Price Tracker** — average selling price by company and brand, top products with
  their current prices, and an average-price-over-time chart that builds up from each
  refresh.
- **📊 Margin Intelligence** — live discounts vs. each company's reported gross margins,
  with a plain-English signal (Marketing Tactic / Liquidation / Premium Hold, etc.).
- **📈 Trend History** — discount trend across refresh sessions (shared across viewers).
- **Export Excel** — every view as a multi-sheet `.xlsx`.

On load, the dashboard **shows the last saved result immediately** (with a banner) so
you don't have to re-scrape just to see the latest numbers — click Refresh for live data.

---

## How it's built (architecture)

| Piece | File | Role |
|---|---|---|
| Front-end (single page) | `index.html` | All UI + charts. For a manual refresh, scrapes Amazon/Flipkart **client-side** via Firecrawl and computes stats in the browser. |
| API / hosting / daily cron | `worker.js` | Cloudflare Worker. Serves the static site, provides `/api/history`, and runs a **daily scheduled scrape** (same scraping code, server-side) so price history builds automatically. |
| Shared history store | Cloudflare **KV** (`LUGGAGE_HISTORY_KV`) | `history` = slim per-day snapshots (aggregates only, so a year fits); `current` = latest full snapshot (per-product detail). Shared across all viewers. |
| Config | `wrangler.jsonc` | Worker + static-assets + KV binding + daily cron (`triggers.crons`). |

Scraping engine: **Firecrawl** (`api.firecrawl.dev`). Amazon and Flipkart use different
page layouts, so `index.html` has a dedicated extractor for each:
- **Amazon** — anchors on the price block (`₹selling … M.R.P: ₹mrp`), takes the product
  name from the URL slug, matches the brand as a whole word, de-dupes by ASIN.
- **Flipkart** — anchors on the product-name link and reads the nearby price block.

Discount % = (MRP − Selling) ÷ MRP × 100 — pure arithmetic from real page data.

---

## Local development

```bash
npm install
npm run dev        # wrangler dev — local preview at http://localhost:8787
npm run deploy     # wrangler deploy — push to Cloudflare
```

The Firecrawl API key for *manual* refreshes is embedded in `index.html` (client-side).
The *daily cron* reads its key from a Worker secret (see below), not from the code.

---

## Daily automatic price capture (one-time setup)

The Worker runs a scheduled scrape every day at **02:30 UTC (08:00 IST)** — set in
`wrangler.jsonc` under `triggers.crons`. It scrapes all 10 brands server-side and appends
a snapshot to the shared history, so the price/discount trend builds on its own with
nobody clicking "Refresh".

For the daily cron to run it needs the Firecrawl key as a **Worker secret** (one time):

```bash
npx wrangler secret put FIRECRAWL_KEY
# paste the Firecrawl key when prompted
```

(Or add it in the Cloudflare dashboard → your Worker → Settings → Variables and Secrets.)
Without the secret, the daily cron simply skips and the rest of the dashboard works normally.

- **Kick off the first capture now** (instead of waiting for tomorrow): `POST /api/capture`
  on the live site — e.g. `curl -X POST https://<your-worker-url>/api/capture`.
- **Credits:** each daily run uses ~20 Firecrawl credits (10 brands × 2 pages), ≈600/month.
  Make sure the Firecrawl plan covers it.
- **Change the time / frequency:** edit `triggers.crons` in `wrangler.jsonc` (standard cron,
  UTC) and redeploy.

---

## One-time setup: auto-deploy on every GitHub push

Connect the repo once and every push to the default branch redeploys automatically —
no manual `wrangler deploy` ever again.

1. Push this repo to GitHub.
2. In the **Cloudflare dashboard** → **Workers & Pages** → **Create** →
   **Workers** → **Connect to Git**.
3. Pick this GitHub repository and the branch to deploy (usually `main`).
4. Build command: `npm run deploy` · Deploy command: (leave default / none) ·
   Root directory: `/`.
5. Save. Cloudflare now builds and deploys on every push to that branch.

> One-time KV step (only if the history store isn't created yet):
> `npx wrangler kv namespace create LUGGAGE_HISTORY_KV` and put the returned id in
> `wrangler.jsonc`. The id already present in this repo is wired up; keep it unless you
> re-create the namespace.

---

## Updating the margin data

Margin figures (gross margin, EBITDA, quarterly trend, source) are seeded in
`index.html` (`MARGIN_SEED`) and stored per-browser in `localStorage`
(`ldi_margin_data`). Update them live via the **✏️** icon on each card in the
Margin Intelligence tab — changes save instantly. Bump `MARGIN_SEED_VERSION` in
`index.html` when you change the built-in seed so existing users pick up the new figures.

---

## Known limitations

- **Price history is not retroactive.** The tool reads *live* prices, so the
  average-price-over-time chart only has data from when capture started — there is no
  backfilled history from before that. Going forward, the **daily cron builds it
  automatically** (see above). A true pre-existing last-1-year history would need a
  historical price-data source (e.g. Keepa for Amazon); not currently integrated.
- **Firecrawl key — manual refresh is still client-side.** The key in `index.html` is
  visible in page source (used for the browser "Refresh" button). The daily cron uses a
  Worker secret instead. Moving the manual path behind a Worker proxy too is a good
  follow-up to fully remove the key from the page.
- **Manual refresh is sequential** (10 brands × 2 pages) and takes a few minutes; the
  daily cron does the same server-side. Each full scrape spends ~20 Firecrawl credits.
- Page-layout changes on Amazon/Flipkart can require the extractor to be updated.
