// worker.js — Cloudflare Worker for the Luggage Discount & Price Intelligence dashboard
//
// Responsibilities:
//   1. Serve the static dashboard (index.html + assets) via the ASSETS binding.
//   2. Shared history API (/api/history) backed by Cloudflare KV:
//        - "history": array of SLIM snapshots (aggregates only, no per-product arrays)
//          so a full year of daily points stays well under KV size limits.
//        - "current": the latest FULL snapshot (keeps per-product detail for the
//          dashboard's "last result" view and the Price Tracker's product tables).
//   3. scheduled() — a DAILY cron that scrapes all brands server-side and appends a
//      snapshot by itself, so price/discount history builds automatically with no
//      one clicking "Refresh". Schedule is set in wrangler.jsonc (triggers.crons).
//
// The scraping library below is ported verbatim from index.html so the daily cron
// produces exactly the same numbers as a manual refresh.
//
// The Firecrawl API key is read from the FIRECRAWL_KEY secret (or FIRECRAWL_API_KEY,
// whichever is set). It is never hardcoded here. If neither secret is set, the daily
// cron simply skips (the dashboard still works normally).

// ─── Scraping library (ported verbatim from index.html) ───
const BRANDS = [
  {brand:"VIP",                company:"VIP Group"},
  {brand:"Skybags",            company:"VIP Group"},
  {brand:"Carlton",            company:"VIP Group"},
  {brand:"Aristocrat",         company:"VIP Group"},
  {brand:"Safari",             company:"Safari Industries"},
  {brand:"Samsonite",          company:"Samsonite Group"},
  {brand:"American Tourister", company:"Samsonite Group"},
  {brand:"HRX",                company:"HRX"},
  {brand:"Uppercase",          company:"Uppercase"},
  {brand:"Nasher Miles",       company:"Nasher Miles"},
];

const LISTING_PAGES = {
  "VIP":                [
    "https://www.flipkart.com/search?q=VIP+luggage+trolley&sort=popularity&p%5B%5D=facets.brand%255B%255D%3DVIP",
    "https://www.amazon.in/s?k=VIP+luggage+trolley+bag&rh=p_89%3AVIP",
  ],
  "Skybags":            [
    "https://www.flipkart.com/search?q=skybags+luggage+trolley&sort=popularity",
    "https://www.amazon.in/s?k=skybags+luggage+trolley+bag",
  ],
  "Carlton":            [
    "https://www.flipkart.com/search?q=Carlton+luggage+trolley&sort=popularity",
    "https://www.amazon.in/s?k=Carlton+luggage+trolley+suitcase",
  ],
  "Aristocrat":         [
    "https://www.flipkart.com/search?q=Aristocrat+luggage+trolley&sort=popularity",
    "https://www.amazon.in/s?k=Aristocrat+luggage+trolley+bag",
  ],
  "Safari":             [
    "https://www.flipkart.com/search?q=Safari+luggage+trolley&sort=popularity&p%5B%5D=facets.brand%255B%255D%3DSafari",
    "https://www.amazon.in/s?k=Safari+luggage+trolley+bag&rh=p_89%3ASafari",
  ],
  "Samsonite":          [
    "https://www.flipkart.com/search?q=Samsonite+luggage+trolley&sort=popularity",
    "https://www.amazon.in/s?k=Samsonite+luggage+trolley+bag",
  ],
  "American Tourister": [
    "https://www.flipkart.com/search?q=American+Tourister+luggage+trolley&sort=popularity",
    "https://www.amazon.in/s?k=American+Tourister+luggage+trolley",
  ],
  // HRX — Hrithik Roshan celebrity brand, sold on Flipkart & Amazon
  "HRX":                [
    "https://www.flipkart.com/search?q=HRX+luggage+trolley+suitcase&sort=popularity",
    "https://www.amazon.in/s?k=HRX+luggage+trolley+suitcase",
  ],
  // Uppercase — Indian D2C startup, Amazon & Flipkart
  "Uppercase":          [
    "https://www.flipkart.com/search?q=Uppercase+luggage+trolley+suitcase&sort=popularity",
    "https://www.amazon.in/s?k=Uppercase+luggage+suitcase+trolley",
  ],
  // Nasher Miles — Indian D2C brand by Abhishek Daga, Lokesh Daga & Shruti Kedia Daga
  "Nasher Miles":       [
    "https://www.flipkart.com/search?q=Nasher+Miles+luggage+trolley+suitcase&sort=popularity",
    "https://www.amazon.in/s?k=Nasher+Miles+luggage+suitcase+trolley",
  ],
};

async function firecrawlScrape(url, key) {
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: false }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('Firecrawl scrape HTTP ' + res.status + ': ' + txt.slice(0,120));
  }
  const data = await res.json();
  if (!data.success) throw new Error('Firecrawl scrape error: ' + JSON.stringify(data).slice(0,120));
  return { markdown: data.data?.markdown || '', url };
}

function parseAmazonSKUs(markdown, pageUrl, brand, company) {
  const skus = [];
  const brandTokens = brand.toLowerCase().split(/\s+/).filter(Boolean);
  const toNum = s => parseInt(String(s).replace(/[^\d]/g, ''), 10);
  const seen = new Set();

  // Price link: text contains a ₹ figure, URL is an Amazon /dp/<ASIN> product page.
  const re = /\[([^\]]*?₹[^\]]*?)\]\((https?:\/\/(?:www\.)?amazon\.in\/([^/)]+)\/dp\/([A-Z0-9]{8,12})[^)]*)\)/gi;
  let m;
  while ((m = re.exec(markdown)) !== null) {
    const text = m[1], url = m[2], slug = m[3], asin = m[4];

    // Brand must appear as a whole word in the slug (so "VIP" doesn't match
    // "Con-VIP-ack" and a "VIP" search doesn't pick up Aristocrat products).
    const slugTokens = slug.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!brandTokens.every(bt => slugTokens.includes(bt))) continue;

    // Selling price = first ₹ figure; MRP = figure right after "M.R.P:".
    const sellMatch = text.match(/₹\s*([\d,]+)/);
    const mrpMatch  = text.match(/M\.?R\.?P\.?\s*:?\s*[₹Rs\s]*([\d,]+)/i);
    if (!sellMatch || !mrpMatch) continue;
    const selling = toNum(sellMatch[1]);
    const mrp     = toNum(mrpMatch[1]);
    if (!mrp || !selling || mrp <= selling || selling < 300 || mrp > 300000) continue;
    const discount = +((mrp - selling) / mrp * 100).toFixed(1);
    if (discount < 5 || discount > 92) continue;

    if (seen.has(asin)) continue;
    seen.add(asin);

    let name = slug;
    try { name = decodeURIComponent(slug); } catch (e) {}
    name = name.replace(/-/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 130);

    const tier = mrp < 2000 ? '<₹2k' : mrp < 6000 ? '₹2–6k' : '>₹6k';
    skus.push({ brand, company, name, mrp, selling, discount,
                platform: 'Amazon', tier, url, isProductPage: true, isLive: true });
  }
  return skus;
}

// ── Parse SKUs from a scraped listing page ─────────────────────────────────
//
// REAL Firecrawl markdown structures observed:
//
// FLIPKART — each product has 3 links in sequence:
//   [![img](https://rukminim2.flixcart.com/.../suitcase.jpeg)](https://flipkart.com/.../p/itm...?pid=XXXXX)
//   [79% off](https://flipkart.com/.../p/itm...?pid=XXXXX)
//   [Large Check-in Suitcase (75 cm) 4 Wheels - Eclipse Neo...](https://flipkart.com/.../p/itm...?pid=XXXXX)
//   ₹2,849
//   ~~₹14,170~~
//
// AMAZON — each product has this pattern:
//   [Safari Stratos 8 Wheels...](https://amazon.in/.../dp/B097GJXPXP/ref=sr_1_36?...)
//   M.R.P:₹30,997₹30,997(https://amazon.in/.../dp/B097GJXPXP/ref=sr_1_36?...)
//   ₹6,349
//   (75% off)
//
// RULES FOR VALID PRODUCT NAME LINK:
//   ✅ Text is ≥ 20 chars, contains brand name, has no image extensions or raw URLs
//   ❌ Text contains image URL (rukminim, .jpeg, .jpg, .png, .webp)
//   ❌ Text matches "XX% off" pattern
//   ❌ Text starts with M.R.P or contains "₹" (it's a price, not a name)
//   ❌ Text contains "http" (raw URL leaked into name)
// ─────────────────────────────────────────────────────────────────────────────
function parseSKUsFromPage(markdown, pageUrl, brand, company) {
  // Amazon.in's listing markdown changed: product TITLES are no longer the
  // clickable text (the visible links are colour swatches), the title now lives
  // in the URL slug, and price+MRP sit together inside one price link. The old
  // "find a product-name link, then read nearby prices" approach therefore finds
  // almost nothing on Amazon. Use a dedicated Amazon extractor that anchors on
  // the price block itself. Flipkart still uses the name-link logic below.
  if (pageUrl.includes('amazon')) return parseAmazonSKUs(markdown, pageUrl, brand, company);

  const skus      = [];
  const isAmazon  = pageUrl.includes('amazon');
  const platform  = isAmazon ? 'Amazon' : 'Flipkart';
  const brandLow  = brand.toLowerCase();

  function toNum(s) { return parseInt(String(s).replace(/[^\d]/g, ''), 10); }

  // ── Step 1: Find ALL markdown links in the page ───────────────────────────
  // Capture: [text](url) — greedy on url to handle nested parens in Amazon URLs
  const linkRe = /\[([^\]]{1,300})\]\((https?:\/\/(?:www\.)?(?:amazon\.in|flipkart\.com)[^)]{10,500})\)/g;
  let m;
  const rawLinks = [];
  while ((m = linkRe.exec(markdown)) !== null) {
    rawLinks.push({ text: m[1], url: m[2], pos: m.index });
  }

  // ── Step 2: Filter to PRODUCT NAME links only ─────────────────────────────
  function isProductNameLink(text, url) {
    const t   = text.trim();
    const uLow = url.toLowerCase();
    // Must be a reasonable length for a product title
    if (t.length < 15 || t.length > 250) return false;
    // Must NOT be an image link (img alt text or image CDN URL)
    if (/rukminim|flixcart\.com\/image|\.jpeg|\.jpg|\.png|\.webp/i.test(t)) return false;
    if (/rukminim|\.jpeg|\.jpg|\.png|\.webp/i.test(url)) return false;
    // Must NOT be a discount badge like "79% off" or "83% off"
    if (/^\d{1,2}%\s*off$/i.test(t)) return false;
    if (/^[\d,\s₹%-]+$/.test(t)) return false;
    // Must NOT start with M.R.P
    if (/^M\.?R\.?P/i.test(t)) return false;
    // Must NOT contain raw http (URL leaked into name)
    if (/https?:\/\//i.test(t)) return false;
    // Must NOT contain ₹ (it's a price line)
    if (/[₹\u20b9]/.test(t)) return false;
    // Must NOT be navigation items
    if (/^(home|shop|men|women|kids|bags|luggage|filter|sort|all|see more|next|prev)/i.test(t)) return false;
    // Brand check: EITHER the link text OR the URL path must mention the brand
    // (Flipkart product names don't always start with the brand name)
    const brandInText = t.toLowerCase().includes(brandLow);
    const brandInUrl  = uLow.includes(brandLow) || uLow.includes(brandLow.replace(/ /g,'-'));
    if (!brandInText && !brandInUrl) return false;
    return true;
  }

  const productLinks = rawLinks.filter(l => isProductNameLink(l.text, l.url));

  // ── Step 3: For each product link, find MRP + selling from nearby text ────
  const seen = new Set();

  for (let li = 0; li < productLinks.length; li++) {
    const { text: rawName, url: productUrl, pos } = productLinks[li];

    // Price block = from this product name link to the next product name link.
    // Use 900 chars max — wide enough for Flipkart where prices come AFTER
    // the name link but BEFORE the next product's image link.
    const nextPos = productLinks[li + 1]?.pos ?? (pos + 900);
    const block = markdown.slice(pos, Math.min(pos + 900, nextPos));

    // ── EXTRACT MRP ────────────────────────────────────────────────────────
    // Amazon pattern: "M.R.P:₹30,997₹30,997(https://..." → first number is MRP
    // Flipkart pattern: "~~₹14,170~~"
    let mrp = null;

    // Amazon: M.R.P line — extract FIRST number after "M.R.P:"
    const mrpLineMatch = block.match(/M\.?R\.?P\.?\s*:?\s*[₹\u20b9Rs\s]*([\d,]+)/i);
    if (mrpLineMatch) mrp = toNum(mrpLineMatch[1]);

    // Flipkart: strikethrough ~~₹X~~
    if (!mrp) {
      const strikeMatch = block.match(/~~\s*[₹\u20b9Rs\s]*([\d,]+)\s*~~/);
      if (strikeMatch) mrp = toNum(strikeMatch[1]);
    }

    // ── EXTRACT STATED DISCOUNT % ──────────────────────────────────────────
    let statedDisc = null;
    const discMatch = block.match(/\(?\s*(\d{1,2})\s*%\s*off\s*\)?/i);
    if (discMatch) statedDisc = parseInt(discMatch[1], 10);

    // ── EXTRACT SELLING PRICE CANDIDATES ──────────────────────────────────
    // Strip: (1) entire M.R.P line, (2) strikethrough blocks, (3) markdown
    // links like (https://...) that contain duplicate price numbers
    const blockClean = block
      .replace(/M\.?R\.?P[^\n]*/gi, '')          // remove M.R.P: line entirely
      .replace(/~~[^~]+~~/g, '')                  // remove ~~strikethrough~~
      .replace(/\(https?:\/\/[^)]{0,400}\)/g, '') // remove (https://url) fragments
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');   // collapse [text](url) → text only

    const rawPrices = [...blockClean.matchAll(/[₹\u20b9]\s*([\d,]+)/g)]
      .map(mx => toNum(mx[1]))
      .filter(v => v >= 300 && v <= 100000);

    let selling = null;

    // PRIORITY 1: MRP + statedDisc → derive selling, cross-check against real prices
    if (mrp && mrp >= 300 && statedDisc && statedDisc >= 5 && statedDisc <= 92) {
      const derived = Math.round(mrp * (1 - statedDisc / 100));
      // Find the closest real price on the page to our derived value
      let closest = null, closestDiff = Infinity;
      for (const p of rawPrices) {
        if (p >= mrp) continue;
        const diff = Math.abs(p - derived);
        if (diff < closestDiff) { closestDiff = diff; closest = p; }
      }
      if (closest) {
        // Check: does the real price produce a discount close to stated? (within 12pp)
        const realDisc = Math.round((mrp - closest) / mrp * 100);
        if (Math.abs(realDisc - statedDisc) <= 12) {
          selling = closest; // real price matches stated discount → use it
        } else {
          // Real price doesn't validate — use derived value as best estimate
          selling = derived;
        }
      } else {
        selling = derived; // no real prices found → use derived
      }
    }

    // PRIORITY 2: MRP known, no disc% → smallest price below MRP
    if (mrp && mrp >= 300 && !selling) {
      const cands = rawPrices.filter(p => p < mrp && p >= 300);
      if (cands.length) selling = Math.min(...cands);
    }

    // PRIORITY 3: No MRP label → validate price pair against stated discount
    if (!mrp && statedDisc && statedDisc >= 5 && statedDisc <= 92) {
      const allPrices = [...blockClean.matchAll(/[₹\u20b9]\s*([\d,]+)/g)]
        .map(mx => toNum(mx[1])).filter(v => v >= 300 && v <= 100000);
      const uniq = [...new Set(allPrices)].sort((a, b) => a - b);
      for (let a = 0; a < uniq.length && !mrp; a++) {
        for (let b2 = a + 1; b2 < uniq.length && !mrp; b2++) {
          const lo = uniq[a], hi = uniq[b2];
          const calc = Math.round((hi - lo) / hi * 100);
          if (Math.abs(calc - statedDisc) <= 5) { selling = lo; mrp = hi; }
        }
      }
    }

    // ── VALIDATE ──────────────────────────────────────────────────────────
    if (!mrp || !selling) continue;
    if (mrp <= selling || selling < 300 || mrp > 100000) continue;
    const discount = +((mrp - selling) / mrp * 100).toFixed(1);
    if (discount < 5 || discount > 92) continue;
    // If stated discount exists, computed must match within 10pp
    if (statedDisc && Math.abs(discount - statedDisc) > 10) continue;

    // Clean product name
    const name = rawName.replace(/[*_#\[\]!]/g, '').trim().slice(0, 130);

    // De-duplicate by (name prefix + mrp + selling)
    const dedupeKey = name.slice(0, 35) + mrp + selling;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const tier = mrp < 2000 ? '<₹2k' : mrp < 6000 ? '₹2–6k' : '>₹6k';
    const isProductPage = productUrl.includes('/dp/') || productUrl.includes('/p/') ||
                          productUrl.includes('pid=') || productUrl.includes('/product/');

    skus.push({ brand, company, name, mrp, selling, discount,
                platform, tier, url: productUrl, isProductPage, isLive: true });
  }

  return skus;
}

async function fetchBrandPrices(brand, company, key) {
  const pages = LISTING_PAGES[brand] || [];
  if (!pages.length) throw new Error('No listing pages configured for ' + brand);

  // Scrape all pages in parallel
  const settled = await Promise.allSettled(pages.map(url => firecrawlScrape(url, key)));

  let allSkus = [];
  let lastErr = '';

  for (const result of settled) {
    if (result.status === 'rejected') {
      lastErr = result.reason?.message || 'scrape failed';
      continue;
    }
    const { markdown, url } = result.value;
    if (!markdown || markdown.length < 200) continue;
    const skus = parseSKUsFromPage(markdown, url, brand, company);
    allSkus.push(...skus);
  }

  // De-duplicate across pages by (mrp+selling+name prefix)
  const seen = new Set();
  allSkus = allSkus.filter(s => {
    const k = s.name.slice(0,30) + s.mrp + s.selling;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  if (allSkus.length === 0) throw new Error(lastErr || 'No valid SKUs parsed from listing pages for ' + brand);
  return allSkus;
}

function calcStats(arr) {
  if (!arr.length) return {avg:0,median:0,min:0,max:0,p25:0,p75:0,count:0};
  const s = [...arr].sort((a,b)=>a-b);
  const mid = s.length / 2;
  const median = s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[Math.floor(mid)];
  return {
    avg:    +(arr.reduce((a,v)=>a+v,0)/arr.length).toFixed(1),
    median: +median.toFixed(1),
    min:    +s[0].toFixed(1),
    max:    +s[s.length-1].toFixed(1),
    p25:    +s[Math.floor(s.length*.25)].toFixed(1),
    p75:    +s[Math.floor(s.length*.75)].toFixed(1),
    count:  arr.length
  };
}

function priceAgg(arr) {
  if (!arr.length) return { avgPrice:0, medianPrice:0, minPrice:0, maxPrice:0 };
  const s = [...arr].sort((a,b)=>a-b);
  const mid = s.length/2;
  const median = s.length%2===0 ? (s[mid-1]+s[mid])/2 : s[Math.floor(mid)];
  return {
    avgPrice:    Math.round(arr.reduce((a,v)=>a+v,0)/arr.length),
    medianPrice: Math.round(median),
    minPrice:    s[0],
    maxPrice:    s[s.length-1],
  };
}

// Physical size bucket from a product title: Cabin (~≤58cm), Medium (~59–71cm), Large (~≥72cm).
function sizeOf(name){
  const n = String(name||'').toLowerCase();
  const m = n.match(/(\d{2,3})\s*cm/);
  if (m){ const c=+m[1]; if(c>=40&&c<=58) return 'Cabin'; if(c<=71) return 'Medium'; if(c<=95) return 'Large'; }
  if (/\blarge\b/.test(n))                return 'Large';
  if (/\bcabin\b|\bsmall\b/.test(n))      return 'Cabin';
  if (/\bmedium\b|check[\s-]?in/.test(n)) return 'Medium';
  return 'Other';
}
function sizeBreakdown(skus){
  const out = {};
  ['Cabin','Medium','Large','Other'].forEach(sz=>{
    const ps = (skus||[]).filter(s=>sizeOf(s.name)===sz).map(s=>s.selling).filter(n=>n>0);
    if (ps.length) out[sz] = { avgPrice: Math.round(ps.reduce((a,v)=>a+v,0)/ps.length), count: ps.length };
  });
  return out;
}

function buildStats(skus) {
  const co={}, br={};
  skus.forEach(sku => {
    const {brand,company,discount,platform,tier,selling} = sku;
    if (!co[company]) co[company]={discs:[],prices:[],tiers:{},skus:[]};
    co[company].discs.push(discount); co[company].prices.push(selling); co[company].skus.push(sku);
    co[company].tiers[tier]=co[company].tiers[tier]||[]; co[company].tiers[tier].push(discount);
    if (!br[brand]) br[brand]={discs:[],prices:[],company,plt:{},skus:[]};
    br[brand].discs.push(discount); br[brand].prices.push(selling); br[brand].skus.push(sku);
    br[brand].plt[platform]=(br[brand].plt[platform]||0)+1;
  });
  const companyStats = Object.entries(co).map(([company,{discs,prices,tiers,skus}])=>({
    company,...calcStats(discs),...priceAgg(prices),skus,
    tierAvg: Object.fromEntries(Object.entries(tiers).map(([t,a])=>[t,+(a.reduce((x,v)=>x+v,0)/a.length).toFixed(1)]))
  })).sort((a,b)=>b.avg-a.avg);
  const brandStats = Object.entries(br).map(([brand,{discs,prices,company,plt,skus}])=>({
    brand,company,...calcStats(discs),...priceAgg(prices),skus,
    bySize: sizeBreakdown(skus),
    amazon:plt["Amazon"]||0, flipkart:plt["Flipkart"]||0
  })).sort((a,b)=>b.avg-a.avg);
  return {companyStats,brandStats};
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────────
const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};
function json(obj) { return new Response(JSON.stringify(obj), { headers: JSON_HEADERS }); }
function jsonError(msg, status = 500) {
  return new Response(JSON.stringify({ ok: false, error: msg }), { status, headers: JSON_HEADERS });
}

// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT STORAGE (Cloudflare KV)
//   history (slim, capped)  +  current (latest full)
// ─────────────────────────────────────────────────────────────────────────────
const HISTORY_KEY = 'history';
const CURRENT_KEY = 'current';
const MAX_HISTORY = 500; // ~1.3 years of daily snapshots

// If an old snapshot's stat lacks price aggregates, compute them from its SKUs
// BEFORE we drop the SKUs — so the price trend survives slimming.
function ensurePriceAgg(stat) {
  if (typeof stat.avgPrice === 'number') return stat;
  const skus = stat.skus || [];
  if (!skus.length) return stat;
  const prices = skus.map(s => s.selling).filter(n => typeof n === 'number');
  return prices.length ? { ...stat, ...priceAgg(prices) } : stat;
}
function slimStats(stats) {
  if (!stats) return stats;
  const strip = arr => (arr || []).map(st => { const s = ensurePriceAgg(st); const { skus, ...rest } = s; return rest; });
  return { companyStats: strip(stats.companyStats), brandStats: strip(stats.brandStats) };
}
function slimSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return snap;
  return { ...snap, stats: slimStats(snap.stats) };
}

async function readHistory(env) {
  const raw = await env.LUGGAGE_HISTORY_KV.get(HISTORY_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function readCurrent(env) {
  const raw = await env.LUGGAGE_HISTORY_KV.get(CURRENT_KEY);
  return raw ? JSON.parse(raw) : null;
}
async function saveSnapshotToKV(env, fullSnap) {
  let history = await readHistory(env);
  history = history.map(slimSnapshot);          // migrate any old full entries to slim
  history.push(slimSnapshot(fullSnap));
  if (history.length > MAX_HISTORY) history = history.slice(history.length - MAX_HISTORY);
  await env.LUGGAGE_HISTORY_KV.put(HISTORY_KEY, JSON.stringify(history));
  await env.LUGGAGE_HISTORY_KV.put(CURRENT_KEY, JSON.stringify(fullSnap)); // keep full detail
  return history;
}

// ─────────────────────────────────────────────────────────────────────────────
// DAILY CAPTURE — scrape every brand server-side and append a snapshot
// ─────────────────────────────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

async function scrapeAllBrands(key) {
  let allSkus = [], good = 0;
  for (const { brand, company } of BRANDS) {
    let skus = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      try { skus = await fetchBrandPrices(brand, company, key); if (skus.length) break; }
      catch (e) { if (attempt === 0) await new Promise(r => setTimeout(r, 2000)); }
    }
    if (skus.length) { allSkus.push(...skus); good++; }
    await new Promise(r => setTimeout(r, 500)); // gentle pacing for Firecrawl
  }
  return { allSkus, good };
}

function buildSnapshot(allSkus) {
  const stats = buildStats(allSkus);
  const now = new Date();
  const get = co => { const c = stats.companyStats.find(x => x.company === co); return c ? c.avg : undefined; };
  return {
    ts: now.toISOString(),
    label: `${String(now.getUTCDate()).padStart(2,'0')} ${MONTHS[now.getUTCMonth()]}`,
    stats, skuCount: allSkus.length,
    vip: get('VIP Group'), safari: get('Safari Industries'), sam: get('Samsonite Group'),
    hrx: get('HRX'), ucase: get('Uppercase'), nasher: get('Nasher Miles'),
    auto: true, // marks a cron-captured snapshot
  };
}

async function dailyCapture(env) {
  if (!env || !env.LUGGAGE_HISTORY_KV) return;
  const key = env && (env.FIRECRAWL_KEY || env.FIRECRAWL_API_KEY);
  if (!key) { console.log('dailyCapture: FIRECRAWL_KEY/FIRECRAWL_API_KEY secret not set — skipping'); return; }
  try {
    const { allSkus, good } = await scrapeAllBrands(key);
    // Don't pollute the trend with a bad-network day
    if (good < 3 || allSkus.length < 10) { console.log('dailyCapture: low yield, skipped', good, allSkus.length); return; }
    await saveSnapshotToKV(env, buildSnapshot(allSkus));
    console.log('dailyCapture: saved', good, 'brands', allSkus.length, 'skus');
  } catch (e) {
    console.log('dailyCapture failed:', e && e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY API HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
async function handleGetHistory(request, env) {
  if (!env || !env.LUGGAGE_HISTORY_KV) return json({ ok: true, history: [], current: null });
  try {
    const history = await readHistory(env);
    const current = await readCurrent(env);
    return json({ ok: true, history, current });
  } catch (e) { return jsonError('History read failed: ' + e.message, 500); }
}
async function handleSaveHistory(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return jsonError('Invalid JSON body', 400); }
  const snap = body.snap;
  if (!snap || typeof snap !== 'object') return jsonError('Missing snap', 400);
  if (!env || !env.LUGGAGE_HISTORY_KV) return jsonError('History storage not configured', 503);
  try {
    const history = await saveSnapshotToKV(env, snap);
    const current = await readCurrent(env);
    return json({ ok: true, history, current });
  } catch (e) { return jsonError('History save failed: ' + e.message, 500); }
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (url.pathname === '/api/history' && request.method === 'GET')  return handleGetHistory(request, env);
    if (url.pathname === '/api/history' && request.method === 'POST') return handleSaveHistory(request, env);

    // Manual trigger for the daily capture (handy for a first run / testing): POST /api/capture
    if (url.pathname === '/api/capture' && request.method === 'POST') {
      const key = env && (env.FIRECRAWL_KEY || env.FIRECRAWL_API_KEY);
      if (!key) return jsonError('FIRECRAWL_KEY (or FIRECRAWL_API_KEY) secret not set', 503);
      try {
        const { allSkus, good } = await scrapeAllBrands(key);
        if (good < 3 || allSkus.length < 10) return jsonError('Low yield: ' + good + ' brands, ' + allSkus.length + ' skus', 502);
        const history = await saveSnapshotToKV(env, buildSnapshot(allSkus));
        return json({ ok: true, good, skuCount: allSkus.length, runs: history.length });
      } catch (e) { return jsonError('Capture failed: ' + e.message, 500); }
    }

    if (env && env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },

  // Daily cron (schedule in wrangler.jsonc → triggers.crons). Runs server-side,
  // no browser needed, so price history accrues automatically every day.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dailyCapture(env));
  },
};
