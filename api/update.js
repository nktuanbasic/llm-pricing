module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const data = require('./data.json');

        if (!Array.isArray(data)) {
            return res.status(500).json({ error: 'data.json invalid format' });
        }

        return res.status(200).json({
            updated: new Date().toISOString(),
            source: 'official_pricing_pages',
            count: data.length,
            data: data
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};