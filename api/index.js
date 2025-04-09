export default async function handler(req, res) {
  // Step 1: Always respond to OPTIONS preflight first
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-gas-endpoint');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    return res.status(204).end(); // No content
  }

  // Step 2: Read GAS URL from header
  const GAS_URL = req.headers['x-gas-endpoint'];
  if (!GAS_URL) {
    return res.status(400).json({ error: 'Missing x-gas-endpoint header' });
  }

  try {
    // Step 3: Forward the request to GAS
    const fetchRes = await fetch(GAS_URL, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: req.method === 'GET' ? undefined : JSON.stringify(req.body),
    });

    const data = await fetchRes.text(); // Accept any content (JSON, plain text)

    // Step 4: Set CORS headers on response
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-gas-endpoint');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

    return res.status(fetchRes.status).send(data);
  
  
  } catch (err) {
    return res.status(500).json({ error: 'Proxy error', details: err.message });
  }
}
