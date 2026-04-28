// api/analyze.js — Privacy Check Backend v3
// 3 categorias: Termos de Uso, Política de Privacidade, Política de Cookies
// Escala: 0-10 por categoria, média final 0-10

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
      // Média ponderada do score total
      const newAvg = Math.round(((prev.avg_score * count) + score) / (count + 1) * 10) / 10;
      // Média ponderada de cada categoria
      const prevScores = prev.scores || {};
      const newScores = {
        terms: Math.round(((( prevScores.terms || 0) * count) + (result.scores?.terms || 0)) / (count + 1) * 10) / 10,
        privacy: Math.round((((prevScores.privacy || 0) * count) + (result.scores?.privacy || 0)) / (count + 1) * 10) / 10,
        cookies: Math.round((((prevScores.cookies || 0) * count) + (result.scores?.cookies || 0)) / (count + 1) * 10) / 10,
      };

      await fetch(`${SUPABASE_URL}/rest/v1/site_rankings?id=eq.${prev.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          avg_score: newAvg,
          scores: newScores,
          analysis_count: count + 1,
          risk_level: newAvg >= 7 ? 'safe' : newAvg >= 4 ? 'moderate' : 'risky',
          positive_points: result.positive_points || prev.positive_points,
          negative_points: result.negative_points || prev.negative_points,
          data_collected: result.data_collected || prev.data_collected,
          data_usage: result.data_usage || prev.data_usage,
          last_analyzed: new Date().toISOString(),
        }),
      });
    } else {
      const category = detectCategory(domain);
      await fetch(`${SUPABASE_URL}/rest/v1/site_rankings`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          domain,
          display_name: toDisplayName(domain),
          category,
          avg_score: score,
          scores: result.scores || {},
          analysis_count: 1,
          risk_level: score >= 7 ? 'safe' : score >= 4 ? 'moderate' : 'risky',
          positive_points: result.positive_points || [],
          negative_points: result.negative_points || [],
          data_collected: result.data_collected || [],
          data_usage: result.data_usage || [],
          last_analyzed: new Date().toISOString(),
        }),
      });
    }
  } catch (err) {
    console.error('Supabase save error:', err);
  }
}

function detectCategory(domain) {
  const cats = {
    'social-media': ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'linkedin.com', 'pinterest.com', 'snapchat.com', 'reddit.com'],
    'ecommerce': ['amazon.', 'mercadolivre.', 'shopee.', 'aliexpress.', 'ebay.', 'americanas.', 'shopify.', 'etsy.'],
    'finance': ['nubank.', 'inter.', 'bradesco.', 'itau.', 'santander.', 'paypal.', 'stripe.', 'banco.', 'caixa.'],
    'health': ['unimed.', 'hapvida.', 'amil.', 'sulamerica.', 'medscape.', 'healthline.'],
    'technology': ['google.', 'microsoft.', 'apple.', 'github.', 'notion.', 'slack.', 'zoom.', 'dropbox.', 'adobe.', 'openai.', 'anthropic.', 'duckduckgo.', 'vercel.'],
    'news': ['globo.', 'folha.', 'uol.', 'bbc.', 'cnn.', 'g1.', 'wikipedia.', 'medium.', 'nytimes.'],
  };
  for (const [cat, domains] of Object.entries(cats)) {
    if (domains.some(d => domain.includes(d))) return cat;
  }
  return 'other';
}

function toDisplayName(domain) {
  const known = {
    'facebook.com': 'Facebook', 'instagram.com': 'Instagram', 'twitter.com': 'Twitter/X',
    'x.com': 'X (Twitter)', 'google.com': 'Google', 'amazon.com': 'Amazon',
    'amazon.com.br': 'Amazon Brazil', 'mercadolivre.com.br': 'Mercado Livre',
    'nubank.com.br': 'Nubank', 'github.com': 'GitHub', 'notion.so': 'Notion',
    'wikipedia.org': 'Wikipedia', 'duckduckgo.com': 'DuckDuckGo', 'tiktok.com': 'TikTok',
    'linkedin.com': 'LinkedIn', 'openai.com': 'OpenAI', 'apple.com': 'Apple',
    'microsoft.com': 'Microsoft', 'google.com.br': 'Google Brazil',
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

  const { siteUrl, termsText, lang, cookies } = req.body || {};
  const isPortuguese = lang === 'pt';
  const isSpanish = lang === 'es';

  const systemPrompt = isPortuguese
    ? `Você é um especialista em privacidade digital. Analise documentos legais de forma objetiva, consistente e determinística. Retorne sempre o mesmo JSON para o mesmo texto. Seja técnico e preciso.`
    : isSpanish
    ? `Eres un experto en privacidad digital. Analiza documentos legales de forma objetiva y determinista. Devuelve siempre el mismo JSON para el mismo texto.`
    : `You are a digital privacy expert. Analyze legal documents objectively, consistently and deterministically. Always return the same JSON for the same text. Be technical and precise.`;

  const cookiesContext = cookies?.length
    ? `\n\nCookies detected in the user's browser: ${JSON.stringify(cookies)}\nInclude this in the cookies analysis.`
    : '';

  const prompt = isPortuguese ? `
Analise os documentos legais do site: ${siteUrl}
${termsText ? `\nTexto detectado:\n${termsText.slice(0, 8000)}` : '\nUse seu conhecimento sobre as práticas conhecidas deste site.'}
${cookiesContext}

Avalie SEPARADAMENTE cada um dos 3 documentos com nota de 0 a 10:

📄 **Termos de Uso (0-10)** — Clareza, fairness, direitos do usuário, rescisão, limitações de responsabilidade
🔒 **Política de Privacidade (0-10)** — Quais dados coleta, como usa, com quem compartilha, por quanto tempo retém, direitos do usuário
🍪 **Política de Cookies (0-10)** — Tipos de cookies usados, consentimento, rastreamento de terceiros, opt-out disponível

A nota final é a MÉDIA das 3 notas acima.

Para pontos positivos e negativos, seja ESPECÍFICO: cite dados concretos, práticas reais, histórico de segurança.

Retorne APENAS JSON válido sem markdown:
{
  "scores": {
    "terms": <0-10>,
    "privacy": <0-10>,
    "cookies": <0-10>
  },
  "descriptions": {
    "terms": "<análise técnica dos termos de uso>",
    "privacy": "<análise técnica da política de privacidade>",
    "cookies": "<análise técnica da política de cookies>"
  },
  "positive_points": ["<ponto positivo específico>", "<ponto>", "<ponto>"],
  "negative_points": ["<ponto negativo específico>", "<ponto>", "<ponto>", "<ponto>"],
  "data_collected": ["<tipo de dado>", "<tipo>", "<tipo>"],
  "data_usage": ["<uso específico>", "<uso>", "<uso>"],
  "summary": "<2-3 frases sobre risco geral e recomendação>",
  "risk_level": "<safe|moderate|risky>"
}` : isSpanish ? `
Analiza los documentos legales del sitio: ${siteUrl}
${termsText ? `\nTexto detectado:\n${termsText.slice(0, 8000)}` : '\nUsa tu conocimiento sobre las prácticas conocidas de este sitio.'}
${cookiesContext}

Evalúa SEPARADAMENTE cada uno de los 3 documentos con nota de 0 a 10:
📄 Términos de Uso (0-10), 🔒 Política de Privacidad (0-10), 🍪 Política de Cookies (0-10)
La nota final es el PROMEDIO de las 3 notas.

Devuelve SOLO JSON válido sin markdown:
{
  "scores": { "terms": <0-10>, "privacy": <0-10>, "cookies": <0-10> },
  "descriptions": { "terms": "<análisis>", "privacy": "<análisis>", "cookies": "<análisis>" },
  "positive_points": ["<punto específico>", "<punto>", "<punto>"],
  "negative_points": ["<punto específico>", "<punto>", "<punto>"],
  "data_collected": ["<tipo>", "<tipo>", "<tipo>"],
  "data_usage": ["<uso>", "<uso>"],
  "summary": "<resumen 2-3 frases>",
  "risk_level": "<safe|moderate|risky>"
}` : `
Analyze the legal documents for: ${siteUrl}
${termsText ? `\nDetected text:\n${termsText.slice(0, 8000)}` : '\nUse your knowledge about this site\'s known practices.'}
${cookiesContext}

Evaluate SEPARATELY each of the 3 documents with a score from 0 to 10:

📄 **Terms of Use (0-10)** — Clarity, fairness, user rights, termination, liability limitations
🔒 **Privacy Policy (0-10)** — What data is collected, how it's used, who it's shared with, retention periods, user rights
🍪 **Cookie Policy (0-10)** — Types of cookies used, consent mechanisms, third-party tracking, opt-out availability

The final score is the AVERAGE of the 3 scores above.

For positive/negative points, be SPECIFIC: cite concrete data, real practices, security history.

Return ONLY valid JSON without markdown:
{
  "scores": {
    "terms": <0-10>,
    "privacy": <0-10>,
    "cookies": <0-10>
  },
  "descriptions": {
    "terms": "<technical analysis of terms of use>",
    "privacy": "<technical analysis of privacy policy>",
    "cookies": "<technical analysis of cookie policy>"
  },
  "positive_points": ["<specific positive point>", "<point>", "<point>"],
  "negative_points": ["<specific negative point>", "<point>", "<point>", "<point>"],
  "data_collected": ["<data type>", "<type>", "<type>"],
  "data_usage": ["<specific use>", "<use>", "<use>"],
  "summary": "<2-3 sentences on overall risk and recommendation>",
  "risk_level": "<safe|moderate|risky>"
}`;

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
        max_tokens: 1500,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
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

    // Calcular média final (0-10)
    const { terms = 0, privacy = 0, cookies = 0 } = result.scores || {};
    const avg = Math.round(((terms + privacy + cookies) / 3) * 10) / 10;
    result.score = avg;

    // Garantir risk_level baseado na escala 0-10
    if (avg >= 7) result.risk_level = 'safe';
    else if (avg >= 4) result.risk_level = 'moderate';
    else result.risk_level = 'risky';

    // Salvar no Supabase em background
    saveToRanking(siteUrl, result).catch(() => {});

    return res.status(200).json(result);

  } catch (err) {
    console.error('Backend error:', err);
    return res.status(500).json({ error: 'Internal error. Please try again.' });
  }
}
