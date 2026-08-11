import type { VercelRequest, VercelResponse } from "@vercel/node";
import { interApiRequest } from "./_shared/interClient";

// GET /api/inter/saldo (opcional: ?dataSaldo=2026-08-11)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { dataSaldo } = req.query;
    const path = dataSaldo ? `/banking/v2/saldo?dataSaldo=${dataSaldo}` : "/banking/v2/saldo";

    const upstream = await interApiRequest(path, "GET");

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
