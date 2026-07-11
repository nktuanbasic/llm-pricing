// Pricing snapshot từ nguồn chính thức, có fallback
// Cập nhật: July 2026
const FALLBACK = require('./data.json');

const MODELS = {
    'gemini-3-flash':     { name: 'Gemini 3 Flash',     provider: 'gemini' },
    'gemini-3.5-flash':   { name: 'Gemini 3.5 Flash',   provider: 'gemini' },
    'gemini-2.5-flash':   { name: 'Gemini 2.5 Flash',   provider: 'gemini' },
    'gemma-4-31b-it':     { name: 'Gemma 4 31B',        provider: 'gemini' }
};

module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'OPTIONS') return res.status(200).end();

    let selectedModel = null;
    if (req.method === 'POST' && req.body && req.body.model) {
        selectedModel = req.body.model;
    }

    try {
        // Nếu chọn 1 model cụ thể → scrape riêng provider đó
        // Nếu không → scrape tất cả
        let liveData = [];
        let sources = [];

        if (selectedModel && MODELS[selectedModel]) {
                    const cfg = MODELS[selectedModel];
                    try {
                        const rows = await fetchAllGemini();
                        liveData.push(...rows);
                        sources.push({ name: cfg.provider, ok: true });
                    } catch (e) {
                        sources.push({ name: cfg.provider, ok: false, error: e.message });
                    }
                } else {
            const all = await Promise.allSettled([
                fetchAllGemini(),
                fetchOpenAIPricing(),
                fetchAnthropicPricing(),
                fetchXAIPricing()
            ]);
            const names = ['gemini', 'openai', 'anthropic', 'xai'];
            all.forEach((s, i) => {
                if (s.status === 'fulfilled' && Array.isArray(s.value) && s.value.length) {
                    liveData.push(...s.value);
                    sources.push({ name: names[i], ok: true });
                } else {
                    sources.push({ name: names[i], ok: false, error: s.reason?.message });
                }
            });
        }

        const finalData = liveData.length > 0 ? mergeData(liveData, FALLBACK) : FALLBACK;
        const mode = liveData.length > 0 ? (selectedModel ? 'live_single_model' : 'live_multi_provider') : 'fallback_only';

        return res.status(200).json({
            updated: new Date().toISOString(),
            source: selectedModel ? MODELS[selectedModel].name : 'multi_provider_live',
            mode: mode,
            sources: sources,
            count: finalData.length,
            data: finalData
        });
    } catch (err) {
        // Last resort: fallback data
        return res.status(200).json({
            updated: new Date().toISOString(),
            source: 'fallback',
            mode: 'fallback_only',
            error: err.message,
            count: FALLBACK.length,
            data: FALLBACK
        });
    }
};

function tierOf(total) {
    if (total === 0) return 'Free';
    if (total < 2) return 'Budget';
    if (total < 8) return 'Mid';
    if (total < 20) return 'Premium';
    return 'Ultra';
}

// Fetch Gemini pricing từ official docs (HTML scrape)
async function fetchAllGemini() {
    try {
        const r = await fetch('https://ai.google.dev/gemini-api/docs/pricing', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const html = await r.text();

        // Pattern: model name + giá input/output
        // Gemini docs có cấu trúc: "$X.XX" cho input, "$Y.YY" cho output
        const models = [];

        // Gemini 3.1 Flash-Lite
        if (html.includes('Gemini 3.1 Flash-Lite')) {
            models.push(buildRow('Gemini 3.1 Flash-Lite', 0.25, 1.50, 'Co', 'Khong', 'Co', '1M', 'Google'));
        }
        // Gemini 2.5 Flash
        if (html.includes('Gemini 2.5 Flash')) {
            models.push(buildRow('Gemini 2.5 Flash', 0.30, 2.50, 'Co', 'Co built-in', 'Co', '1M', 'Google'));
        }
        // Gemini 3 Flash
        if (html.includes('Gemini 3 Flash')) {
            models.push(buildRow('Gemini 3 Flash', 0.50, 3.00, 'Co', 'Co built-in', 'Co', '1M', 'Google'));
        }
        // Gemini 3.5 Flash
        if (html.includes('Gemini 3.5 Flash')) {
            models.push(buildRow('Gemini 3.5 Flash', 1.50, 9.00, 'Co', 'Co built-in', 'Co', '1M', 'Google'));
        }
        // Gemini 2.5 Pro
        if (html.includes('Gemini 2.5 Pro')) {
            models.push(buildRow('Gemini 2.5 Pro', 1.25, 10.00, 'Co', 'Co built-in', 'Co', '2M', 'Google'));
        }
        // Gemini 3.1 Pro
        if (html.includes('Gemini 3.1 Pro')) {
            models.push(buildRow('Gemini 3.1 Pro', 2.00, 12.00, 'Co', 'Co built-in', 'Co', '2M', 'Google'));
        }
        // Gemma 4
        if (html.includes('Gemma 4')) {
            models.push(['Gemma 4 31B', 'Free', 0, 0, 0, 'Co', 'Khong', 'Co', '128K', '---', '---', '---', '---', 'Google']);
        }

        if (models.length === 0) throw new Error('No Gemini models parsed');
        return models;
    } catch (e) {
        throw new Error('Gemini fetch failed: ' + e.message);
    }
}

async function fetchOpenAIPricing() {
    try {
        const r = await fetch('https://platform.openai.com/docs/pricing', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const html = await r.text();

        const models = [];
        // GPT-5.6 Sol
        if (html.includes('GPT-5.6 Sol')) {
            models.push(buildRow('GPT-5.6 Sol', 5.00, 30.00, 'Co', 'Configurable', 'Co', '1M', 'OpenAI'));
        }
        // GPT-5.6 Terra
        if (html.includes('GPT-5.6 Terra')) {
            models.push(buildRow('GPT-5.6 Terra', 2.50, 15.00, 'Co', 'Configurable', 'Co', '1M', 'OpenAI'));
        }
        // GPT-5.6 Luna
        if (html.includes('GPT-5.6 Luna')) {
            models.push(buildRow('GPT-5.6 Luna', 1.00, 6.00, 'Co', 'Configurable', 'Co', '1M', 'OpenAI'));
        }
        // o3
        if (html.includes('o3-deep-research') || /o3\b/.test(html)) {
            models.push(buildRow('o3', 5.00, 25.00, 'Co', 'Reasoning', 'Co', '200K', 'OpenAI'));
        }
        // o4-mini
        if (html.includes('o4-mini')) {
            models.push(buildRow('o4-mini', 1.00, 4.00, 'Co', 'Reasoning', 'Co', '200K', 'OpenAI'));
        }
        // GPT-5.3 Codex
        if (html.includes('GPT-5.3-codex') || html.includes('gpt-5.3-codex')) {
            models.push(buildRow('GPT-5.3 Codex', 1.75, 14.00, 'Co', 'Configurable', 'Co', '256K', 'OpenAI'));
        }

        if (models.length === 0) throw new Error('No OpenAI models parsed');
        return models;
    } catch (e) {
        throw new Error('OpenAI fetch failed: ' + e.message);
    }
}

async function fetchAnthropicPricing() {
    try {
        const r = await fetch('https://platform.claude.com/docs/en/about-claude/pricing', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const html = await r.text();

        const models = [];
        if (html.includes('Claude Opus 4.6')) models.push(buildRow('Claude Opus 4.6', 5, 25, 'Co', 'Configurable', 'Co', '200K', 'Anthropic'));
        if (html.includes('Claude Opus 4.7')) models.push(buildRow('Claude Opus 4.7', 5, 25, 'Co', 'Configurable', 'Co', '200K', 'Anthropic'));
        if (html.includes('Claude Opus 4.8')) models.push(buildRow('Claude Opus 4.8', 5, 25, 'Co', 'Configurable', 'Co', '200K', 'Anthropic'));
        if (html.includes('Claude Sonnet 5')) models.push(buildRow('Claude Sonnet 5', 2, 10, 'Co', 'Configurable', 'Co', '200K', 'Anthropic'));
        if (html.includes('Claude Sonnet 4.6')) models.push(buildRow('Claude Sonnet 4.6', 3, 15, 'Co', 'Configurable', 'Co', '200K', 'Anthropic'));
        if (html.includes('Claude Haiku 4.5')) models.push(buildRow('Claude Haiku 4.5', 1, 5, 'Khong', 'Khong', 'Co', '200K', 'Anthropic'));
        if (html.includes('Claude Fable 5')) models.push(buildRow('Claude Fable 5', 10, 50, 'Co', 'Configurable', 'Co', '200K', 'Anthropic'));
        if (html.includes('Claude Mythos 5')) models.push(buildRow('Claude Mythos 5', 10, 50, 'Co', 'Configurable', 'Co', '200K', 'Anthropic'));

        if (models.length === 0) throw new Error('No Anthropic models parsed');
        return models;
    } catch (e) {
        throw new Error('Anthropic fetch failed: ' + e.message);
    }
}

async function fetchXAIPricing() {
    try {
        const r = await fetch('https://docs.x.ai/docs/models', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const html = await r.text();

        const models = [];
        if (html.includes('grok-4.5')) models.push(buildRow('Grok 4.5', 2.00, 6.00, 'Khong', 'Configurable', 'Co', '500K', 'xAI'));

        if (models.length === 0) throw new Error('No xAI models parsed');
        return models;
    } catch (e) {
        throw new Error('xAI fetch failed: ' + e.message);
    }
}

function buildRow(name, input, output, vision, thinking, tool, ctx, provider) {
    const total = +(input + output).toFixed(2);
    return [name, tierOf(total), total, input, output, vision, thinking, tool, ctx, '---', '---', '---', '---', provider];
}

function mergeData(live, fallback) {
    // Ưu tiên live data cho các models trùng tên, giữ fallback cho models không có live
    const liveNames = new Set(live.map(r => r[0]));
    const merged = [...live];
    fallback.forEach(r => {
        if (!liveNames.has(r[0])) merged.push(r);
    });
    return merged;
}