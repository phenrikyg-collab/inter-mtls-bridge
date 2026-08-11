import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getInterAccessToken } from "./_shared/interClient";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const token = await getInterAccessToken();
    res.status(200).json({ ok: true, token_gerado: !!token });
  } catch (err) {
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
}
