import type { VercelRequest, VercelResponse } from "@vercel/node";
import { interApiRequest } from "./_shared/interClient";

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// GET /api/extrato?dataInicio=2026-08-01&dataFim=2026-08-11
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  try {
    const { dataInicio, dataFim } = req.query;
    if (!dataInicio || !dataFim) {
      res.status(400).json({ error: "dataInicio e dataFim sao obrigatorios (formato YYYY-MM-DD)" });
      return;
    }

    const upstream = await interApiRequest(
      `/banking/v2/extrato?dataInicio=${dataInicio}&dataFim=${dataFim}`,
      "GET"
    );

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
