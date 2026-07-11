module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Use env var GEMINI_API_KEY set in Vercel, or accept from request body
    const apiKey = process.env.GEMINI_API_KEY || (req.body?.apiKey);
    if (!apiKey) {
        return res.status(400).json({ error: 'Missing GEMINI_API_KEY env var on server' });
    }

    const model = req.body.model || 'gemini-3-flash';
        const prompt = `You are a pricing data specialist. Return the CURRENT API pricing for major LLM providers as a JSON array.
    Each entry: [Model Name, Tier, Total per 1M input+output, Input per 1M, Output per 1M, Vision yes/no, Thinking info, Tool Call yes/no, Context length, Arena Elo, SWE-bench percent, LiveCodeBench percent, AA Index, Provider]

    TIERS: Free=$0, Budget=<$2, Mid=$2-$7, Premium=$8-$18, Ultra=>$18

    IMPORTANT PRICING RULES:
    - Gemini 3.1 Flash-Lite: Input=$0.25, Output=$1.50 → Total=$1.75 (Budget tier). NOT free.
    - Claude Opus 4.6, Claude Opus 4.7, Claude Opus 4.8 are SEPARATE models with DIFFERENT prices. DO NOT combine them.
    - Use real current public pricing. If unsure, best estimate.

    Include: DeepSeek V4 Flash, DeepSeek V4 Pro, MiniMax M3, Qwen3.7 Plus, Gemini 3.1 Flash-Lite, Gemini 2.5 Flash, Gemini 3 Flash, Grok 4.3, GLM-5, Kimi K2.7 Code, Kimi K2.6, Qwen3.7 Max, GLM-5V-Turbo, GPT-5.4 mini, o4-mini, GLM-5.2, Claude Haiku 4.5, GPT-5.6 Luna, Grok 4.5, o3, Gemini 3.5 Flash, Gemini 2.5 Pro, Claude Sonnet 5, Gemini 3.1 Pro, GPT-5.6 Terra, GPT-5.4, Claude Sonnet 4.6, Claude Opus 4.6, Claude Opus 4.7, Claude Opus 4.8, GPT-5.6 Sol, GPT-5.5, Claude Fable 5, GLM-4.7-Flash

    Return ONLY valid JSON array. No markdown. Use 2 decimal prices. Mark best-value models with BEST in last element.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
        const geminiRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
            })
        });

        if (!geminiRes.ok) {
            const errText = await geminiRes.text();
            return res.status(502).json({ error: 'Gemini API error', status: geminiRes.status, detail: errText.substring(0, 500) });
        }

        const geminiData = await geminiRes.json();
        const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        let jsonData;
        const jsonMatch = text.match(/\[([\s\S]*)\]/);
        if (jsonMatch) {
            jsonData = JSON.parse(jsonMatch[0]);
        } else {
            jsonData = JSON.parse(text);
        }

        if (!Array.isArray(jsonData)) {
            return res.status(502).json({ error: 'Gemini returned invalid format' });
        }

        res.setHeader('Cache-Control', 'no-cache');
        return res.status(200).json({
            updated: new Date().toISOString(),
            model: model,
            count: jsonData.length,
            data: jsonData
        });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
