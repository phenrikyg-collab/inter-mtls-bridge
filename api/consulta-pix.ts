import type { VercelRequest, VercelResponse } from "@vercel/node";
import { interApiRequest } from "./_shared/interClient";

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// GET /api/consulta-pix?txid=XXXXX
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    const { txid } = req.query;
    if (!txid) {
      res.status(400).json({ error: "txid e obrigatorio" });
      return;
    }

    const upstream = await interApiRequest(`/pix/v2/cob/${txid}`, "GET");

    res.status(upstream.status);
    try {
      res.json(JSON.parse(upstream.body));
    } catch {
      res.send(upstream.body);
    }
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
}
