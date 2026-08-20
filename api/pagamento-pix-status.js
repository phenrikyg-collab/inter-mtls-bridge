// api/pagamento-pix-status.js — consulta o status de um Pix já enviado.
const { consultarPix, normalizarStatus, autorizado } = require("../lib/inter-pagamento");

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ erro: "method not allowed" });
  }
  if (!autorizado(req)) {
    return res.status(401).json({ erro: "nao autorizado" });
  }

  try {
    const codigo =
      req.query?.codigo_solicitacao ||
      (typeof req.body === "string" ? JSON.parse(req.body) : req.body || {})
        .codigo_solicitacao;

    if (!codigo) return res.status(400).json({ erro: "codigo_solicitacao obrigatorio" });

    const r = await consultarPix(codigo);

    if (r.status >= 400) {
      return res.status(r.status).json({
        erro: "falha na consulta",
        detalhe: r.json || r.texto?.slice(0, 600),
      });
    }

    return res.status(200).json({
      ok: true,
      codigo_solicitacao: codigo,
      status: normalizarStatus(r.json),
      raw: r.json,
    });
  } catch (err) {
    console.error("pagamento-pix-status:", err);
    return res.status(500).json({ erro: String(err.message || err) });
  }
};
