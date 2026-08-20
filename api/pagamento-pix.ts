import type { VercelRequest, VercelResponse } from "@vercel/node";
import { pagarPix, normalizarStatus, autorizado } from "./_shared/interPagamentoClient";

// Sem CORS de propósito: este endpoint é chamado servidor-a-servidor pela edge
// function do Supabase. Navegador nenhum deveria conseguir chamá-lo.

const VALOR_MAX = Number(process.env.INTER_PAG_VALOR_MAX || 20000);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ erro: "method not allowed" });
    return;
  }
  if (!autorizado(req)) {
    res.status(401).json({ erro: "nao autorizado" });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { valor, chave, descricao } = body;
    const idempotencyKey = body.idempotency_key;

    if (!valor || Number(valor) <= 0) {
      res.status(400).json({ erro: "valor invalido" });
      return;
    }
    if (!chave) {
      res.status(400).json({ erro: "chave pix obrigatoria" });
      return;
    }
    if (!idempotencyKey) {
      res.status(400).json({ erro: "idempotency_key obrigatoria" });
      return;
    }

    // Teto por transação: rede de proteção contra valor digitado errado no painel.
    if (Number(valor) > VALOR_MAX) {
      res.status(422).json({
        erro: `valor ${valor} acima do teto de ${VALOR_MAX} configurado na ponte`,
      });
      return;
    }

    const r = await pagarPix({ valor, chave, descricao, idempotencyKey });

    if (r.status >= 400) {
      // 4xx do Inter é definitivo (chave inválida, saldo, escopo) — repetir não resolve.
      res.status(r.status).json({
        erro: "inter recusou o pagamento",
        status_http: r.status,
        detalhe: r.json || r.body.slice(0, 600),
      });
      return;
    }

    res.status(200).json({
      ok: true,
      codigo_solicitacao: r.json?.codigoSolicitacao || r.json?.codigo_solicitacao || null,
      status: normalizarStatus(r.json),
      raw: r.json,
    });
  } catch (err) {
    console.error("pagamento-pix:", err);
    res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
  }
}
