import type { VercelRequest, VercelResponse } from "@vercel/node";
import { interApiRequest } from "./_shared/interClient";

// GET /api/consulta-pix?txid=XXXXX
export default async function handler(req: VercelRequest, res: VercelResponse) {
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
