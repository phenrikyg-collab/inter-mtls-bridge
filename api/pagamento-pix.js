// api/pagamento-pix.js — envia UM Pix. O lote é orquestrado do lado do Supabase.
const { pagarPix, normalizarStatus, autorizado } = require("../lib/inter-pagamento");

const VALOR_MAX = Number(process.env.INTER_PAG_VALOR_MAX || 20000);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "method not allowed" });
  }
  if (!autorizado(req)) {
    return res.status(401).json({ erro: "nao autorizado" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { valor, chave, descricao, idempotency_key: idempotencyKey } = body;

    if (!valor || Number(valor) <= 0) return res.status(400).json({ erro: "valor invalido" });
    if (!chave) return res.status(400).json({ erro: "chave pix obrigatoria" });
    if (!idempotencyKey) return res.status(400).json({ erro: "idempotency_key obrigatoria" });

    // Teto por transação: protege contra um valor digitado errado no painel.
    if (Number(valor) > VALOR_MAX) {
      return res.status(422).json({
        erro: `valor ${valor} acima do teto de ${VALOR_MAX} configurado na ponte`,
      });
    }

    const r = await pagarPix({ valor, chave, descricao, idempotencyKey });

    if (r.status >= 400) {
      // 4xx do Inter é definitivo (chave inválida, saldo, escopo) — não adianta repetir.
      return res.status(r.status).json({
        erro: "inter recusou o pagamento",
        status_http: r.status,
        detalhe: r.json || r.texto?.slice(0, 600),
      });
    }

    return res.status(200).json({
      ok: true,
      codigo_solicitacao:
        r.json?.codigoSolicitacao || r.json?.codigo_solicitacao || null,
      status: normalizarStatus(r.json),
      raw: r.json,
    });
  } catch (err) {
    console.error("pagamento-pix:", err);
    return res.status(500).json({ erro: String(err.message || err) });
  }
};
