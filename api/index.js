export default async function handler(req, res) {
    const GAS_BASE_URL = 'https://script.google.com/macros/s/AKfycbzytkmMVhU_55XMSH984SA8LeohUYY1WDgqF3O4ENt6eyPPoAVHet-9mK3vsGUf3MeOUg/exec';
  
    const url = new URL(GAS_BASE_URL);
    if (req.method === 'GET') {
      for (const key in req.query) {
        url.searchParams.append(key, req.query[key]);
      }
    }
  
    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
  
    if (req.method === 'POST') {
      fetchOptions.body = JSON.stringify(req.body);
    }
  
    try {
      const gasResponse = await fetch(url.toString(), fetchOptions);
      const data = await gasResponse.json();
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: 'Proxy request failed', detail: err.message });
    }
  }  