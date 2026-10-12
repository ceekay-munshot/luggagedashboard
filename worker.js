// worker.js — Cloudflare Worker for the Luggage Discount Intelligence dashboard
//
// Responsibilities:
//   1. Serve the static dashboard (index.html + assets) via the ASSETS binding.
//   2. Shared refresh history API (/api/history) backed by Cloudflare KV, so the
//      trend + price charts are shared across all viewers rather than per-browser.
//
// NOTE: live price scraping is done client-side in index.html (Firecrawl), so this
// Worker does NOT proxy scraping. The old Genspark /api/fetch-brand and
// /api/fetch-insight endpoints were unused by the current dashboard and have been
// removed (they also carried a hardcoded API key).

const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
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

    // Shared refresh history (Cloudflare KV)
    if (url.pathname === '/api/history' && request.method === 'GET') {
      return handleGetHistory(request, env);
    }
    if (url.pathname === '/api/history' && request.method === 'POST') {
      return handleSaveHistory(request, env);
    }

    // Serve static files (index.html + assets)
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// REFRESH HISTORY — shared trend storage in Cloudflare KV
// Binding: LUGGAGE_HISTORY_KV (configured in wrangler.jsonc). Every client reads
// and writes the same list, so the trend + price charts are shared across viewers.
// ─────────────────────────────────────────────────────────────────────────────
const HISTORY_KEY = 'history';

async function handleGetHistory(request, env) {
  // KV not bound yet → behave as empty so the dashboard still works
  if (!env || !env.LUGGAGE_HISTORY_KV) {
    return new Response(JSON.stringify({ ok: true, history: [] }), { headers: JSON_HEADERS });
  }
  try {
    const raw = await env.LUGGAGE_HISTORY_KV.get(HISTORY_KEY);
    const history = raw ? JSON.parse(raw) : [];
    return new Response(JSON.stringify({ ok: true, history }), { headers: JSON_HEADERS });
  } catch (e) {
    return jsonError('History read failed: ' + e.message, 500);
  }
}

async function handleSaveHistory(request, env) {
  let body;
  try { body = await request.json(); }
  catch (e) { return jsonError('Invalid JSON body', 400); }

  const snap = body.snap;
  if (!snap || typeof snap !== 'object') return jsonError('Missing snap', 400);

  if (!env || !env.LUGGAGE_HISTORY_KV) {
    return jsonError('History storage not configured', 503);
  }
  try {
    const raw = await env.LUGGAGE_HISTORY_KV.get(HISTORY_KEY);
    const history = raw ? JSON.parse(raw) : [];
    history.push(snap);
    await env.LUGGAGE_HISTORY_KV.put(HISTORY_KEY, JSON.stringify(history));
    return new Response(JSON.stringify({ ok: true, history }), { headers: JSON_HEADERS });
  } catch (e) {
    return jsonError('History save failed: ' + e.message, 500);
  }
}

function jsonError(msg, status = 500) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: JSON_HEADERS,
  });
}
