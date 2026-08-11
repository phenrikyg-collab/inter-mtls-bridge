import type { VercelRequest, VercelResponse } from "@vercel/node";
import { interApiRequest } from "./_shared/interClient";

// POST /api/inter/cobranca-pix
// Body esperado: { valor: "150.00", chave: "SUA_CHAVE_PIX_INTER", nome_devedor?, cpf_cnpj_devedor?, ... }
// Cria uma cobranca Pix imediata (endpoint /pix/v2/cob), retorna o txid + payload copia-e-cola.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed -- use POST" });
    return;
  }
  try {
    const { valor, chave, nome_devedor, cpf_cnpj_devedor, expiracao_segundos } = req.body || {};
    if (!valor || !chave) {
      res.status(400).json({ error: "valor e chave (chave Pix cadastrada no Inter) sao obrigatorios" });
      return;
    }

    const payload: Record<string, unknown> = {
      calendario: { expiracao: expiracao_segundos || 3600 },
      valor: { original: valor },
      chave,
    };
    if (nome_devedor || cpf_cnpj_devedor) {
      payload.devedor = {
        nome: nome_devedor,
        cpf: cpf_cnpj_devedor && cpf_cnpj_devedor.length <= 11 ? cpf_cnpj_devedor : undefined,
        cnpj: cpf_cnpj_devedor && cpf_cnpj_devedor.length > 11 ? cpf_cnpj_devedor : undefined,
      };
    }

    const upstream = await interApiRequest("/pix/v2/cob", "POST", payload);

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
