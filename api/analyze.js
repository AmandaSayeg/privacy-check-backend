// api/analyze.js — Backend do Privacy Check no Vercel
// Este arquivo fica na pasta /api do seu projeto Vercel

export default async function handler(req, res) {
  // Permite requisições do Chrome Extension e de qualquer origem
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Responde ao preflight do browser
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { termsText, siteUrl, lang, userId } = req.body;

  // Validação básica
  if (!siteUrl) {
    return res.status(400).json({ error: "siteUrl é obrigatório" });
  }

  // ── Controle de uso grátis ──
  // Usa KV Storage do Vercel para contar usos por usuário
  // (userId é gerado pelo Chrome Extension e salvo localmente)
  const FREE_LIMIT = 999999; // Grátis ilimitado por agora — mude quando quiser monetizar

  try {
    // Chama a API da Anthropic usando a chave salva no Vercel (não exposta ao usuário)
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

    if (!ANTHROPIC_KEY) {
      return res.status(500).json({ error: "Servidor não configurado corretamente." });
    }

    const langLabels = {
      pt: "português brasileiro",
      en: "English",
      es: "español"
    };
    const outputLang = langLabels[lang] || langLabels["pt"];

    const systemPrompt = `You are a privacy and terms-of-service expert. Analyze website terms/privacy policies and return ONLY valid JSON. No markdown, no explanation, just the JSON object.`;

    const userPrompt = `Analyze this website's terms of service and privacy policy. Site: ${siteUrl}

Terms/Privacy text found:
"""
${(termsText || "").substring(0, 6000) || "No specific terms text found — analyze based on the site URL and general knowledge."}
"""

Return ONLY this JSON (no markdown, no extra text):
{
  "score": <integer 0-10>,
  "verdict": "<short verdict phrase in ${outputLang}>",
  "summary": "<2-3 sentences in simple, clear ${outputLang}>",
  "positive_points": ["<point 1>", "<point 2>", "<point 3 max>"],
  "negative_points": ["<point 1>", "<point 2>", "<point 3 max>"],
  "risk_level": "<safe|moderate|risky|very_risky>"
}

Score guide: 9-10=excellent, 7-8=good, 5-6=moderate concerns, 3-4=significant risks, 0-2=very risky.
Keep the summary simple, like explaining to a non-technical person. Use ${outputLang}.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 700,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error("Anthropic error:", err);
      return res.status(502).json({ error: "Erro ao chamar a IA. Tente novamente." });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);

  } catch (err) {
    console.error("Backend error:", err);
    return res.status(500).json({ error: "Erro interno. Tente novamente." });
  }
}
