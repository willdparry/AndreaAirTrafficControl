export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { path, ...params } = req.query;
  if (!path) return res.status(400).json({ error: "Missing path" });

  const clientId     = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: "OpenSky credentials not configured" });
  }

  try {
    // 1. Get OAuth2 token
    const tokenRes = await fetch(
      "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type:    "client_credentials",
          client_id:     clientId,
          client_secret: clientSecret,
        }),
      }
    );

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return res.status(401).json({ error: "Token fetch failed", detail: err });
    }

    const { access_token } = await tokenRes.json();

    // 2. Forward request to OpenSky
    const qs = new URLSearchParams(params).toString();
    const url = `https://opensky-network.org/api/${path}${qs ? "?" + qs : ""}`;

    const apiRes = await fetch(url, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({ error: "OpenSky API error", status: apiRes.status });
    }

    const data = await apiRes.json();
    // Cache for 10 seconds — OpenSky updates roughly every 10s
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=20");
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: "Proxy error", detail: err.message });
  }
}
