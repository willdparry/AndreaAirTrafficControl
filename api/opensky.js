export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const clientId     = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: "Missing credentials", clientId: !!clientId, clientSecret: !!clientSecret });
  }

  const path   = req.query.path;
  const params = { ...req.query };
  delete params.path;

  if (!path) return res.status(400).json({ error: "Missing path" });

  try {
    // 1. Get OAuth2 token
    const tokenBody = new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     clientId,
      client_secret: clientSecret,
    });

    const tokenRes = await fetch(
      "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
      {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    tokenBody.toString(),
      }
    );

    const tokenText = await tokenRes.text();

    if (!tokenRes.ok) {
      return res.status(401).json({ error: "Token fetch failed", status: tokenRes.status, detail: tokenText });
    }

    const { access_token } = JSON.parse(tokenText);

    // 2. Call OpenSky
    const qs  = Object.keys(params).length ? "?" + new URLSearchParams(params).toString() : "";
    const url = `https://opensky-network.org/api/${path}${qs}`;

    const apiRes = await fetch(url, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!apiRes.ok) {
      const body = await apiRes.text();
      return res.status(apiRes.status).json({ error: "OpenSky error", status: apiRes.status, detail: body });
    }

    const data = await apiRes.json();
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=20");
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: "Proxy error", detail: err.message, stack: err.stack });
  }
}
