import type { VercelRequest, VercelResponse } from "@vercel/node";
import { consultarPix, normalizarStatus, autorizado } from "./_shared/interPagamentoClient";

// Chamado pelo cron `inter-sync-status-pagamentos` do Supabase.
// É esta consulta que transforma "enviado" em "pago" — a resposta do envio
// não confirma que o dinheiro chegou.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ erro: "method not allowed" });
    return;
  }
  if (!autorizado(req)) {
    res.status(401).json({ erro: "nao autorizado" });
    return;
  }

  try {
    const daQuery = req.query?.codigo_solicitacao;
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const codigo = (Array.isArray(daQuery) ? daQuery[0] : daQuery) || body.codigo_solicitacao;

    if (!codigo) {
      res.status(400).json({ erro: "codigo_solicitacao obrigatorio" });
      return;
    }

    const r = await consultarPix(String(codigo));

    if (r.status >= 400) {
      res.status(r.status).json({
        erro: "falha na consulta",
        detalhe: r.json || r.body.slice(0, 600),
      });
      return;
    }

    res.status(200).json({
      ok: true,
      codigo_solicitacao: codigo,
      status: normalizarStatus(r.json),
      raw: r.json,
    });
  } catch (err) {
    console.error("pagamento-pix-status:", err);
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
}
