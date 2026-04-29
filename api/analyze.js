// api/analyze.js — Privacy Check Backend v4
// Analisa os 3 documentos de uma vez: Terms, Privacy, Cookies
// Nota 0 se documento não foi encontrado no site

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

      // Weighted average per category
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

  // Determine which docs were found vs missing
  const found = {
    terms:   !!(legalLinks?.terms),
    privacy: !!(legalLinks?.privacy),
    cookies: !!(legalLinks?.cookies),
  };

  const texts = {
    terms:   docTexts?.terms   || null,
    privacy: docTexts?.privacy || null,
    cookies: docTexts?.cookies || null,
  };

  const cookiesCtx = cookies?.length
    ? `\nBrowser cookies detected: ${JSON.stringify(cookies.slice(0, 8))}`
    : '';

  const missingNote = {
    pt: (type) => `O site NÃO possui uma página de ${type} — isso deve contar negativamente.`,
    en: (type) => `The site does NOT have a ${type} page — this must count negatively.`,
    es: (type) => `El sitio NO tiene una página de ${type} — esto debe contar negativamente.`,
  };

  const docInstructions = {
    pt: `Analise os 3 documentos legais do site ${domain}:

📄 TERMOS DE USO (0-10): ${found.terms ? `Texto:\n${texts.terms || 'Analise com base no seu conhecimento.'}` : missingNote.pt('Termos de Uso') + ' Atribua nota 0.'}

🔒 POLÍTICA DE PRIVACIDADE (0-10): ${found.privacy ? `Texto:\n${texts.privacy || 'Analise com base no seu conhecimento.'}` : missingNote.pt('Política de Privacidade') + ' Atribua nota 0.'}

🍪 POLÍTICA DE COOKIES (0-10): ${found.cookies ? `Texto:\n${texts.cookies || 'Analise com base no seu conhecimento.'}` : missingNote.pt('Política de Cookies') + ' Atribua nota 0.'}
${cookiesCtx}

Critérios:
- Termos: clareza, fairness, direitos do usuário, rescisão, limitações de responsabilidade
- Privacidade: dados coletados, uso, compartilhamento, retenção, direitos LGPD/GDPR
- Cookies: tipos usados, consentimento real, rastreamento terceiros, opt-out

Para pontos negativos, inclua OBRIGATORIAMENTE um item para cada documento não encontrado.`,

    en: `Analyze the 3 legal documents for ${domain}:

📄 TERMS OF USE (0-10): ${found.terms ? `Text:\n${texts.terms || 'Analyze based on your knowledge.'}` : missingNote.en('Terms of Use') + ' Assign score 0.'}

🔒 PRIVACY POLICY (0-10): ${found.privacy ? `Text:\n${texts.privacy || 'Analyze based on your knowledge.'}` : missingNote.en('Privacy Policy') + ' Assign score 0.'}

🍪 COOKIE POLICY (0-10): ${found.cookies ? `Text:\n${texts.cookies || 'Analyze based on your knowledge.'}` : missingNote.en('Cookie Policy') + ' Assign score 0.'}
${cookiesCtx}

Criteria:
- Terms: clarity, fairness, user rights, termination, liability limitations
- Privacy: data collected, use, sharing, retention, GDPR/LGPD rights
- Cookies: types used, real consent, third-party tracking, opt-out availability

For negative points, MUST include one item for each missing document.`,

    es: `Analiza los 3 documentos legales de ${domain}:

📄 TÉRMINOS DE USO (0-10): ${found.terms ? `Texto:\n${texts.terms || 'Analiza basándote en tu conocimiento.'}` : missingNote.es('Términos de Uso') + ' Asigna nota 0.'}

🔒 POLÍTICA DE PRIVACIDAD (0-10): ${found.privacy ? `Texto:\n${texts.privacy || 'Analiza basándote en tu conocimiento.'}` : missingNote.es('Política de Privacidad') + ' Asigna nota 0.'}

🍪 POLÍTICA DE COOKIES (0-10): ${found.cookies ? `Texto:\n${texts.cookies || 'Analiza basándote en tu conocimiento.'}` : missingNote.es('Política de Cookies') + ' Asigna nota 0.'}
${cookiesCtx}

Para puntos negativos, DEBE incluir un ítem por cada documento no encontrado.`,
  }[langCode];

  const jsonTemplate = `{
  "scores": {
    "terms": ${found.terms ? '<0-10>' : '0'},
    "privacy": ${found.privacy ? '<0-10>' : '0'},
    "cookies": ${found.cookies ? '<0-10>' : '0'}
  },
  "positive_points": ["<specific point>", "<point>", "<point>"],
  "negative_points": [${!found.terms ? '"❌ No Terms of Use page found",' : ''}${!found.privacy ? '"❌ No Privacy Policy page found",' : ''}${!found.cookies ? '"❌ No Cookie Policy page found",' : ''} "<other negative point>"],
  "data_collected": ["<data type>", "<type>"],
  "data_usage": ["<use>", "<use>"],
  "summary": "<2-3 sentences on overall privacy risk>",
  "risk_level": "<safe|moderate|risky>"
}`;

  const systemPrompt = {
    pt: 'Você é um especialista em privacidade digital. Analise de forma objetiva, técnica e determinística. Retorne APENAS JSON válido sem markdown.',
    en: 'You are a digital privacy expert. Analyze objectively, technically and deterministically. Return ONLY valid JSON without markdown.',
    es: 'Eres un experto en privacidad digital. Analiza de forma objetiva y determinista. Devuelve SOLO JSON válido sin markdown.',
  }[langCode];

  const userPrompt = `${docInstructions}\n\nReturn ONLY valid JSON without markdown:\n${jsonTemplate}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1200,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
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
    if (!found.terms) result.scores.terms = 0;
    if (!found.privacy) result.scores.privacy = 0;
    if (!found.cookies) result.scores.cookies = 0;

    // Final score = average of all 3
    const { terms = 0, privacy = 0, cookies: cookieScore = 0 } = result.scores;
    const avg = Math.round(((terms + privacy + cookieScore) / 3) * 10) / 10;
    result.score = avg;

    if (avg >= 7) result.risk_level = 'safe';
    else if (avg >= 4) result.risk_level = 'moderate';
    else result.risk_level = 'risky';

    // Add missing doc negatives if not already there
    const missingNegatives = {
      pt: { terms: '❌ Site não possui Termos de Uso', privacy: '❌ Site não possui Política de Privacidade', cookies: '❌ Site não possui Política de Cookies' },
      en: { terms: '❌ No Terms of Use page found', privacy: '❌ No Privacy Policy page found', cookies: '❌ No Cookie Policy page found' },
      es: { terms: '❌ Sin página de Términos de Uso', privacy: '❌ Sin Política de Privacidad', cookies: '❌ Sin Política de Cookies' },
    }[langCode];

    result.negative_points = result.negative_points || [];
    for (const [key, msg] of Object.entries(missingNegatives)) {
      if (!found[key] && !result.negative_points.some(p => p.includes('❌') && p.toLowerCase().includes(key))) {
        result.negative_points.unshift(msg);
      }
    }

    saveToRanking(siteUrl, result).catch(() => {});
    return res.status(200).json(result);

  } catch (err) {
    console.error('Backend error:', err);
    return res.status(500).json({ error: 'Internal error. Please try again.' });
  }
}
