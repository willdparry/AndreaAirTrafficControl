import https from 'https';

function httpsGet(urlStr, auth) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'Authorization': 'Basic ' + auth }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return res.status(500).json({ error: 'Missing credentials' });

  const path = req.query.path;
  if (!path) return res.status(400).json({ error: 'Missing path' });

  const params = { ...req.query };
  delete params.path;

  try {
    const auth = Buffer.from(clientId + ':' + clientSecret).toString('base64');
    const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
    const result = await httpsGet('https://opensky-network.org/api/' + path + qs, auth);

    if (result.status !== 200) return res.status(result.status).json({ error: 'OpenSky error', detail: result.body });

    res.setHeader('Cache-Control', 's-maxage=10');
    return res.status(200).json(JSON.parse(result.body));
  } catch (err) {
    return res.status(500).json({ error: 'Proxy error', detail: err.message });
  }
}
