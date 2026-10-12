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
| Front-end (single page) | `index.html` | All UI + charts. Scrapes Amazon/Flipkart **client-side** via the Firecrawl API, computes all stats in the browser. |
| API / hosting | `worker.js` | Cloudflare Worker. Serves the static site and provides `/api/history` (shared refresh history). |
| Shared history store | Cloudflare **KV** (`LUGGAGE_HISTORY_KV`) | Every refresh snapshot is saved here so the trend/price charts are shared across all viewers. |
| Config | `wrangler.jsonc` | Worker + static-assets + KV binding config. |

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

The Firecrawl API key is currently embedded in `index.html` (client-side). See
**Known limitations** below.

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
  average-price-over-time chart builds from the moment tracking started — it is not a
  backfilled 12-month history. A true last-1-year price history needs a historical
  price-data source (e.g. Keepa for Amazon); not currently integrated.
- **Firecrawl key is client-side.** The key in `index.html` is visible in page source.
  For production it should move behind the Worker (a `/api/scrape` proxy with the key as
  a Cloudflare secret). Flagged as a follow-up.
- **Refresh is manual and sequential** (10 brands × 2 pages). A full refresh takes a few
  minutes and spends Firecrawl credits each time.
- Page-layout changes on Amazon/Flipkart can require the extractor to be updated.
