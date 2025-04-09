export default async function handler(req, res) {
  const GAS_URL = process.env.GAS_URL;

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end(); // No content
    return;
  }

  if (req.method === 'GET' || req.method === 'POST') {
    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (req.method === 'POST') {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const url = req.method === 'GET' && req.query
      ? `${GAS_URL}?${new URLSearchParams(req.query)}`
      : GAS_URL;

    try {
      const response = await fetch(url, fetchOptions);
      const data = await response.json();

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json(data);
    } catch (error) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(500).json({ error: 'Proxy request failed', details: error.message });
    }
  } else {
    res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}