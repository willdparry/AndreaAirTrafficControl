import https from 'https';

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
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
    const tokenBody = 'grant_type=client_credentials&client_id=' + encodeURIComponent(clientId) + '&client_secret=' + encodeURIComponent(clientSecret);
    const tokenRes = await httpsRequest({
      hostname: 'auth.opensky-network.org',
      path: '/auth/realms/opensky-network/protocol/openid-connect/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tokenBody) }
    }, tokenBody);

    if (tokenRes.status !== 200) return res.status(401).json({ error: 'Token failed', detail: tokenRes.body });

    const { access_token } = JSON.parse(tokenRes.body);
    const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';

    const apiRes = await httpsRequest({
      hostname: 'opensky-network.org',
      path: '/api/' + path + qs,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + access_token }
    });

    if (apiRes.status !== 200) return res.status(apiRes.status).json({ error: 'OpenSky error', detail: apiRes.body });

    res.setHeader('Cache-Control', 's-maxage=10');
    return res.status(200).json(JSON.parse(apiRes.body));
  } catch (err) {
    return res.status(500).json({ error: 'Proxy error', detail: err.message });
  }
}
