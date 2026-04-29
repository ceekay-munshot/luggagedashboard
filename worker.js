// worker.js — Genspark Hosted Deploy Worker
// Runs on Genspark's own Cloudflare infrastructure
// api.genspark.ai resolves INTERNALLY from here (not from external servers)

const GS_KEY = 'gsk-eyJjb2dlbl9pZCI6ImRkZjcxNGRmLTk2MTQtNDllNy1hNTU5LTM4MDJkYjg1MzM5YiIsImtleV9pZCI6ImY2Yzg0YjhiLThiNjctNDAwOS04MmEyLTg1ODU4NjdiYTNjNCIsImN0aW1lIjoxNzc0MDg4NDk1LCJjbGF1ZGVfYmlnX21vZGVsIjpudWxsLCJjbGF1ZGVfbWlkZGxlX21vZGVsIjpudWxsLCJjbGF1ZGVfc21hbGxfbW9kZWwiOm51bGx9fGRvf984BPZ02UHf7O49zhZOsUU5pqFStFbw98InBc34';

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
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // API routes
    if (url.pathname === '/api/fetch-brand' && request.method === 'POST') {
      return handleFetchBrand(request, env);
    }
    if (url.pathname === '/api/fetch-insight' && request.method === 'POST') {
      return handleFetchInsight(request, env);
    }

    // Serve static files
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
async function handleFetchBrand(request, env) {
  let body;
  try { body = await request.json(); }
  catch (e) { return jsonError('Invalid JSON body', 400); }

  const { brand, company, today } = body;
  if (!brand || !company) return jsonError('Missing brand or company', 400);

  const key = (env && env.GS_KEY) || GS_KEY;

  const prompt = `Today is ${today}. Search Amazon.in and Flipkart RIGHT NOW for "${brand} luggage trolley bag" and find 8 to 10 real current product listings available for purchase today.

For each listing extract:
- name: exact product name
- mrp: original MRP (strikethrough price) in Indian Rupees as an integer
- selling: current selling price in Indian Rupees as an integer
- platform: exactly "Amazon" or "Flipkart"

Return ONLY a valid JSON array, no markdown, no explanation, no extra text:
[{"name":"${brand} Alpha 65cm Hard Trolley","mrp":4995,"selling":1695,"platform":"Amazon"}]

Only include listings where: mrp > selling, selling >= 400, discount between 5% and 92%.`;

  try {
    const gsRes = await fetch('https://api.genspark.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
      },
      body: JSON.stringify({
        model: 'genspark-auto',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        tools: [{ type: 'web_search' }],
      }),
      signal: AbortSignal.timeout(58000),
    });

    if (!gsRes.ok) {
      const errText = await gsRes.text().catch(() => '');
      return jsonError('Genspark API returned ' + gsRes.status + ': ' + errText.slice(0, 200), 502);
    }

    const data = await gsRes.json();
    const rawText = data.choices?.[0]?.message?.content || '';

    const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return jsonError('No JSON array in AI response. Got: ' + rawText.slice(0, 150), 422);

    let items;
    try { items = JSON.parse(match[0]); }
    catch (e) { return jsonError('JSON parse error: ' + e.message, 422); }

    const skus = [];
    for (const item of items) {
      const mrp     = Math.round(Number(item.mrp));
      const selling = Math.round(Number(item.selling));
      if (!mrp || !selling || mrp <= selling || selling < 400 || mrp > 300000) continue;
      const discount = +((mrp - selling) / mrp * 100).toFixed(1);
      if (discount < 5 || discount > 92) continue;
      skus.push({
        brand, company,
        name:     String(item.name || brand).slice(0, 120),
        mrp, selling, discount,
        platform: String(item.platform || '').toLowerCase().includes('flip') ? 'Flipkart' : 'Amazon',
        tier:     mrp < 2000 ? '<₹2k' : mrp < 6000 ? '₹2–6k' : '>₹6k',
      });
    }

    return new Response(JSON.stringify({ ok: true, skus }), { headers: JSON_HEADERS });

  } catch (e) {
    return jsonError('Worker exception: ' + e.message, 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function handleFetchInsight(request, env) {
  let body;
  try { body = await request.json(); }
  catch (e) { return jsonError('Invalid JSON body', 400); }

  const { companyStats, today } = body;
  if (!companyStats) return jsonError('Missing companyStats', 400);

  const key = (env && env.GS_KEY) || GS_KEY;

  const table = companyStats.map(c =>
    `${c.company}: Avg ${c.avg}%, Median ${c.median}%, Range ${c.min}–${c.max}%, ${c.count} SKUs`
  ).join('\n');

  const prompt = `Indian luggage e-commerce discount data as of ${today}:\n\n${table}\n\nIn exactly 3 sentences (one per company: VIP Group, Safari Industries, Samsonite Group), what does this data signal about each company's pricing strategy and near-term margin outlook? Be direct and analytical.`;

  try {
    const gsRes = await fetch('https://api.genspark.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
      },
      body: JSON.stringify({
        model: 'genspark-auto',
        messages: [
          { role: 'system', content: 'You are a sharp equity analyst covering Indian consumer brands.' },
          { role: 'user', content: prompt },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!gsRes.ok) {
      const errText = await gsRes.text().catch(() => '');
      return jsonError('Insight API error ' + gsRes.status + ': ' + errText.slice(0, 200), 502);
    }

    const data = await gsRes.json();
    const insight = data.choices?.[0]?.message?.content?.trim() || '';
    if (!insight) return jsonError('Empty insight from AI', 422);

    return new Response(JSON.stringify({ ok: true, insight }), { headers: JSON_HEADERS });

  } catch (e) {
    return jsonError('Insight exception: ' + e.message, 500);
  }
}

function jsonError(msg, status = 500) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status,
    headers: JSON_HEADERS,
  });
}
