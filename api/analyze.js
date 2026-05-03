// api/analyze.js — Privacy Check Backend v4.1
// Otimizado: prompt mais curto, modelo mais rápido para análise
// Rigoroso: penaliza sites conhecidos por práticas ruins mesmo sem texto

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://udpsqzhvvscxwykxzhpt.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function saveToRanking(siteUrl, result) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
  try {
    const domain = new URL(siteUrl).hostname.replace('www.', '');
    const score = result.score || 0;
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/site_rankings?domain=eq.${encodeURIComponent(domain)}&select=id,avg_score,analysis_count,scores,positive_points,negative_points,data_collected,data_usage`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const existing = await checkRes.json();

    if (existing && existing.length > 0) {
      const prev = existing[0];
      const count = prev.analysis_count || 1;
      const prevScores = prev.scores || {};
      const newScores = {};
      for (const key of ['terms', 'privacy', 'cookies']) {
        const cur = result.scores?.[key];
        const prev_val = prevScores[key];
        if (cur !== null && cur !== undefined) {
          newScores[key] = Math.round((((prev_val ?? cur) * count) + cur) / (count + 1) * 10) / 10;
        } else {
          newScores[key] = prev_val ?? null;
        }
      }
      const allValid = Object.values(newScores).filter(v => v !== null && v !== undefined);
      const newAvg = allValid.length > 0
        ? Math.round((allValid.reduce((a, b) => a + b, 0) / allValid.length) * 10) / 10
        : prev.avg_score;

      await fetch(`${SUPABASE_URL}/rest/v1/site_rankings?id=eq.${prev.id}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          avg_score: newAvg, scores: newScores, analysis_count: count + 1,
          risk_level: newAvg >= 7 ? 'safe' : newAvg >= 4 ? 'moderate' : 'risky',
          positive_points: result.positive_points || prev.positive_points,
          negative_points: result.negative_points || prev.negative_points,
          data_collected: result.data_collected || prev.data_collected,
          last_analyzed: new Date().toISOString(),
        }),
      });
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/site_rankings`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          domain, display_name: toDisplayName(domain), category: detectCategory(domain),
          avg_score: score, scores: result.scores || {}, analysis_count: 1,
          risk_level: score >= 7 ? 'safe' : score >= 4 ? 'moderate' : 'risky',
          positive_points: result.positive_points || [],
          negative_points: result.negative_points || [],
          data_collected: result.data_collected || [],
          last_analyzed: new Date().toISOString(),
        }),
      });
    }
  } catch (err) { console.error('Supabase error:', err); }
}

function detectCategory(domain) {
  const cats = {
    'social-media': ['facebook.com','instagram.com','twitter.com','x.com','tiktok.com','linkedin.com','reddit.com'],
    'ecommerce': ['amazon.','mercadolivre.','shopee.','aliexpress.','ebay.','shopify.','etsy.'],
    'finance': ['nubank.','inter.','bradesco.','itau.','santander.','paypal.','stripe.'],
    'health': ['unimed.','hapvida.','amil.','medscape.','healthline.'],
    'technology': ['google.','microsoft.','apple.','github.','notion.','slack.','zoom.','openai.','anthropic.','duckduckgo.'],
    'news': ['globo.','folha.','uol.','bbc.','cnn.','wikipedia.','nytimes.'],
  };
  for (const [cat, domains] of Object.entries(cats)) {
    if (domains.some(d => domain.includes(d))) return cat;
  }
  return 'other';
}

function toDisplayName(domain) {
  const known = {
    'facebook.com':'Facebook','instagram.com':'Instagram','twitter.com':'Twitter/X',
    'x.com':'X (Twitter)','google.com':'Google','amazon.com':'Amazon',
    'amazon.com.br':'Amazon Brazil','mercadolivre.com.br':'Mercado Livre',
    'nubank.com.br':'Nubank','github.com':'GitHub','notion.so':'Notion',
    'wikipedia.org':'Wikipedia','duckduckgo.com':'DuckDuckGo','tiktok.com':'TikTok',
    'linkedin.com':'LinkedIn','openai.com':'OpenAI','apple.com':'Apple','microsoft.com':'Microsoft',
  };
  if (known[domain]) return known[domain];
  return domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { siteUrl, lang, cookies, docTexts, legalLinks } = req.body || {};
  const isPortuguese = lang === 'pt';
  const isSpanish = lang === 'es';
  const langCode = isPortuguese ? 'pt' : isSpanish ? 'es' : 'en';

  const domain = (() => { try { return new URL(siteUrl).hostname.replace('www.',''); } catch { return siteUrl; } })();

  const found = {
    terms:   !!(legalLinks?.terms),
    privacy: !!(legalLinks?.privacy),
    cookies: !!(legalLinks?.cookies),
  };

  const texts = {
    terms:   docTexts?.terms   ? docTexts.terms.slice(0, 4000)   : null,
    privacy: docTexts?.privacy ? docTexts.privacy.slice(0, 4000) : null,
    cookies: docTexts?.cookies ? docTexts.cookies.slice(0, 4000) : null,
  };

  const hasAnyText = Object.values(texts).some(Boolean);

  const cookiesCtx = cookies?.length
    ? `Browser cookies: ${cookies.slice(0, 5).map(c => c.name).join(', ')}`
    : '';

  // Build compact prompt for speed
  const buildPrompt = () => {
    const langInstruction = {
      pt: 'IMPORTANTE: Responda TODOS os textos (summary, positive_points, negative_points, data_collected, data_usage) em PORTUGUÊS BRASILEIRO.',
      en: 'IMPORTANT: Write ALL text fields (summary, positive_points, negative_points, data_collected, data_usage) in ENGLISH.',
      es: 'IMPORTANTE: Escribe TODOS los textos (summary, positive_points, negative_points, data_collected, data_usage) en ESPAÑOL.',
    }[langCode];

    const lines = [`${langInstruction}\n\nAnalyze privacy practices of ${domain}. Be objective and rigorous — do not be lenient with sites known for mass data collection.`];

    lines.push(`\nScore each document 0–10 (0 = missing or terrible, 10 = excellent):`);

    lines.push(`\n📄 TERMS OF USE: ${found.terms
      ? (texts.terms ? `Text: ${texts.terms}` : 'Link found but text unavailable — use your knowledge.')
      : 'NOT FOUND on site. Score = 0.'}`);

    lines.push(`\n🔒 PRIVACY POLICY: ${found.privacy
      ? (texts.privacy ? `Text: ${texts.privacy}` : 'Link found but text unavailable — use your knowledge.')
      : 'NOT FOUND on site. Score = 0.'}`);

    lines.push(`\n🍪 COOKIE POLICY: ${found.cookies
      ? (texts.cookies ? `Text: ${texts.cookies}` : 'Link found but text unavailable — use your knowledge.')
      : 'NOT FOUND on site. Score = 0.'}`);

    if (cookiesCtx) lines.push(`\n${cookiesCtx}`);

    if (!hasAnyText) {
      lines.push(`\nIMPORTANT: No document text was retrieved. Use your trained knowledge about ${domain}'s actual privacy practices. Be accurate and rigorous — if this site is known for extensive data collection, targeted advertising, or privacy violations, scores must reflect that reality.`);
    }

    lines.push(`\nReturn ONLY valid JSON (no markdown):\n{
  "scores": {"terms": <0-10 or 0 if missing>, "privacy": <0-10 or 0 if missing>, "cookies": <0-10 or 0 if missing>},
  "positive_points": ["<specific point>", "<point>"],
  "negative_points": ["<specific point>", "<point>", "<point>"],
  "data_collected": ["<type>", "<type>"],
  "data_usage": ["<use>", "<use>"],
  "summary": "<2 sentences: main risk + recommendation>",
  "risk_level": "<safe|moderate|risky>"
}`);

    return lines.join('\n');
  };

  const systemPrompt = {
    pt: 'Você é um especialista rigoroso em privacidade digital. Seja objetivo e preciso. Sites como Facebook, TikTok e Google devem receber notas baixas por suas práticas extensivas de coleta de dados. Responda SEMPRE em português brasileiro. Retorne APENAS JSON válido sem markdown.',
    en: 'You are a rigorous digital privacy expert. Be objective and accurate. Sites like Facebook, TikTok, and Google should receive low scores for their extensive data collection practices. Always respond in English. Return ONLY valid JSON without markdown.',
    es: 'Eres un experto riguroso en privacidad digital. Sé objetivo y preciso. Sitios como Facebook, TikTok y Google deben recibir notas bajas. Responde SIEMPRE en español. Devuelve SOLO JSON válido sin markdown.',
  }[langCode];

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // Haiku: 3-4x mais rápido que Opus
        max_tokens: 1500,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: buildPrompt() }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic error:', err);
      return res.status(500).json({ error: 'AI service error. Please try again.' });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    // Force 0 for missing docs
    if (!found.terms)   result.scores.terms   = 0;
    if (!found.privacy) result.scores.privacy = 0;
    if (!found.cookies) result.scores.cookies = 0;

    // Final score = average of all 3
    const { terms = 0, privacy = 0, cookies: cookieScore = 0 } = result.scores;
    const avg = Math.round(((terms + privacy + cookieScore) / 3) * 10) / 10;
    result.score = avg;

    if (avg >= 7) result.risk_level = 'safe';
    else if (avg >= 4) result.risk_level = 'moderate';
    else result.risk_level = 'risky';

    // Add missing doc negatives
    const missingMsg = {
      pt: { terms: '❌ Site não possui Termos de Uso', privacy: '❌ Site não possui Política de Privacidade', cookies: '❌ Site não possui Política de Cookies' },
      en: { terms: '❌ No Terms of Use page found', privacy: '❌ No Privacy Policy page found', cookies: '❌ No Cookie Policy page found' },
      es: { terms: '❌ Sin Términos de Uso', privacy: '❌ Sin Política de Privacidad', cookies: '❌ Sin Política de Cookies' },
    }[langCode];

    result.negative_points = result.negative_points || [];
    for (const [key, msg] of Object.entries(missingMsg)) {
      if (!found[key] && !result.negative_points.some(p => p.startsWith('❌'))) {
        result.negative_points.unshift(msg);
      }
    }

  await saveToRanking(siteUrl, result);
  return res.status(200).json(result);

  } catch (err) {
    console.error('Backend error:', err);
    return res.status(500).json({ error: 'Internal error. Please try again.' });
  }
}
