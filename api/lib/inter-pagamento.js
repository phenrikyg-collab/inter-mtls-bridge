// lib/inter-pagamento.js
// Cliente mTLS da SEGUNDA integração do Inter (a de pagamento).
// Não compartilha nada com o cliente de cobrança: outro client_id, outro certificado,
// outro cache de token. Isso é de propósito — se um vazar, o outro não paga nada.

const https = require("https");
const { URL } = require("url");

const INTER_HOST = "cdpj.partners.bancointer.com.br";
const SCOPES = "pagamento-pix.write pagamento-pix.read";

// ---- credenciais da integração de PAGAMENTO ----
function credenciais() {
  const faltando = [
    "INTER_PAG_CLIENT_ID",
    "INTER_PAG_CLIENT_SECRET",
    "INTER_PAG_CERT_B64",
    "INTER_PAG_KEY_B64",
  ].filter((k) => !process.env[k]);

  if (faltando.length) {
    throw new Error(`Variáveis de ambiente ausentes: ${faltando.join(", ")}`);
  }

  return {
    clientId: process.env.INTER_PAG_CLIENT_ID,
    clientSecret: process.env.INTER_PAG_CLIENT_SECRET,
    cert: Buffer.from(process.env.INTER_PAG_CERT_B64, "base64"),
    key: Buffer.from(process.env.INTER_PAG_KEY_B64, "base64"),
    contaCorrente: process.env.INTER_PAG_CONTA_CORRENTE || null,
  };
}

let agentCache = null;
function agent() {
  if (!agentCache) {
    const c = credenciais();
    agentCache = new https.Agent({
      cert: c.cert,
      key: c.key,
      keepAlive: true,
      maxSockets: 8,
    });
  }
  return agentCache;
}

// Requisição HTTPS crua — não usa fetch de propósito: o fetch do Node
// (undici) ignora o `agent`, e sem o agent não há mTLS.
function request({ method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(body);
    const req = https.request(
      {
        host: INTER_HOST,
        path,
        method,
        agent: agent(),
        headers: {
          ...headers,
          ...(payload ? { "Content-Length": payload.length } : {}),
        },
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const texto = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = texto ? JSON.parse(texto) : null;
          } catch (_) {
            /* resposta não-JSON: fica em `texto` */
          }
          resolve({ status: res.statusCode, json, texto });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout na chamada ao Inter")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---- token (cache em memória da lambda; expira 60s antes por segurança) ----
let tokenCache = { valor: null, expiraEm: 0 };

async function token() {
  if (tokenCache.valor && Date.now() < tokenCache.expiraEm) return tokenCache.valor;

  const c = credenciais();
  const form = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: "client_credentials",
    scope: SCOPES,
  }).toString();

  const r = await request({
    method: "POST",
    path: "/oauth/v2/token",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });

  if (r.status !== 200 || !r.json?.access_token) {
    throw new Error(
      `falha ao obter token (${r.status}): ${r.texto?.slice(0, 400) || "sem corpo"}`
    );
  }

  tokenCache = {
    valor: r.json.access_token,
    expiraEm: Date.now() + (r.json.expires_in - 60) * 1000,
  };
  return tokenCache.valor;
}

function headersAutenticados(extra = {}) {
  const c = credenciais();
  return {
    "Content-Type": "application/json",
    ...(c.contaCorrente ? { "x-conta-corrente": c.contaCorrente } : {}),
    ...extra,
  };
}

/**
 * Envia um Pix.
 * @param {{valor:number, chave:string, descricao?:string, idempotencyKey:string}} p
 */
async function pagarPix({ valor, chave, descricao, idempotencyKey }) {
  if (!idempotencyKey) throw new Error("idempotencyKey é obrigatório");

  const t = await token();
  const corpo = {
    valor: Number(valor),
    descricao: (descricao || "").slice(0, 140) || undefined,
    destinatario: { tipo: "CHAVE", chave: String(chave).trim() },
  };

  const r = await request({
    method: "POST",
    path: "/banking/v2/pix",
    headers: headersAutenticados({
      Authorization: `Bearer ${t}`,
      "x-id-idempotente": idempotencyKey,
    }),
    body: JSON.stringify(corpo),
  });

  return { ...r, requisicao: corpo };
}

/** Consulta o status de um Pix já enviado. */
async function consultarPix(codigoSolicitacao) {
  const t = await token();
  return request({
    method: "GET",
    path: `/banking/v2/pix/${encodeURIComponent(codigoSolicitacao)}`,
    headers: headersAutenticados({ Authorization: `Bearer ${t}` }),
  });
}

/** Normaliza os muitos nomes de status que o Inter devolve. */
function normalizarStatus(json) {
  const bruto = (
    json?.transacaoPix?.status ||
    json?.status ||
    json?.situacao ||
    ""
  )
    .toString()
    .toUpperCase();

  if (["REALIZADO", "PAGO", "EFETIVADO", "CONCLUIDO", "APROVADO"].includes(bruto)) return "pago";
  if (["AGUARDANDO_APROVACAO", "PENDENTE_APROVACAO", "EM_APROVACAO"].includes(bruto))
    return "aguardando_aprovacao";
  if (["CANCELADO", "REJEITADO", "NAO_REALIZADO", "ERRO", "FALHA"].includes(bruto)) return "falhou";
  return "enviado";
}

/** Porteiro: o endpoint de pagamento não pode ficar aberto na internet. */
function autorizado(req) {
  const esperado = process.env.BRIDGE_SHARED_SECRET;
  if (!esperado) return false; // sem segredo configurado, ninguém entra
  const recebido = req.headers["x-bridge-secret"];
  if (!recebido || recebido.length !== esperado.length) return false;
  // comparação de tempo constante
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

module.exports = { pagarPix, consultarPix, normalizarStatus, autorizado };
