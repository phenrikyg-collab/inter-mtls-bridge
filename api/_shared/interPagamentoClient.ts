import https from "https";

/**
 * Cliente mTLS da SEGUNDA integração do Inter — a de pagamento.
 *
 * Deliberadamente separado de `interClient.ts`: outro client_id, outro
 * certificado, outro cache de token. Se o segredo de cobrança vazar, ele não
 * paga nada; se este vazar, ele não lê cobrança. As variáveis seguem o mesmo
 * padrão de nome do cliente de cobrança, com o prefixo INTER_PAG_.
 */

const INTER_HOST = "cdpj.partners.bancointer.com.br";
const SCOPES = "pagamento-pix.write pagamento-pix.read";

interface TokenCache {
  token: string | null;
  expiry: number;
}

interface HttpsResponse {
  status: number;
  json: any | null;
  body: string;
}

interface RequestOptions {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

export type StatusPagamento =
  | "pago"
  | "aguardando_aprovacao"
  | "enviado"
  | "falhou";

function env(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`variável de ambiente ausente: ${nome}`);
  return v;
}

let agentCache: https.Agent | null = null;

function getAgent(): https.Agent {
  if (!agentCache) {
    agentCache = new https.Agent({
      cert: Buffer.from(env("INTER_PAG_CERT_BASE64"), "base64"),
      key: Buffer.from(env("INTER_PAG_KEY_BASE64"), "base64"),
      keepAlive: true,
      maxSockets: 8,
    });
  }
  return agentCache;
}

/**
 * Requisição HTTPS crua. Não usa fetch de propósito: o fetch do Node (undici)
 * ignora o `agent`, e sem o agent não há mTLS.
 */
export function interPagHttpsRequest(options: RequestOptions): Promise<HttpsResponse> {
  return new Promise((resolve, reject) => {
    const payload = options.body ? Buffer.from(options.body) : null;

    const req = https.request(
      {
        host: INTER_HOST,
        path: options.path,
        method: options.method,
        agent: getAgent(),
        headers: {
          ...(options.headers || {}),
          ...(payload ? { "Content-Length": String(payload.length) } : {}),
        },
        timeout: 25000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json: any = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            /* resposta não-JSON fica só em `body` */
          }
          resolve({ status: res.statusCode || 0, json, body });
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error("timeout na chamada ao Inter")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const tokenCache: TokenCache = { token: null, expiry: 0 };

export async function getInterPagAccessToken(): Promise<string> {
  if (tokenCache.token && Date.now() < tokenCache.expiry) return tokenCache.token;

  const form = new URLSearchParams({
    client_id: env("INTER_PAG_CLIENT_ID"),
    client_secret: env("INTER_PAG_CLIENT_SECRET"),
    grant_type: "client_credentials",
    scope: SCOPES,
  }).toString();

  const r = await interPagHttpsRequest({
    method: "POST",
    path: "/oauth/v2/token",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });

  if (r.status !== 200 || !r.json?.access_token) {
    throw new Error(
      `falha ao obter token de pagamento (${r.status}): ${r.body.slice(0, 400) || "sem corpo"}`
    );
  }

  tokenCache.token = r.json.access_token;
  tokenCache.expiry = Date.now() + (Number(r.json.expires_in) - 60) * 1000;
  return tokenCache.token as string;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const conta = process.env.INTER_PAG_CONTA_CORRENTE;
  return {
    "Content-Type": "application/json",
    ...(conta ? { "x-conta-corrente": conta } : {}),
    ...extra,
  };
}

export interface PagarPixInput {
  valor: number;
  chave: string;
  descricao?: string;
  idempotencyKey: string;
}

/** Envia UM Pix. O lote é orquestrado do lado do Supabase. */
export async function pagarPix(p: PagarPixInput): Promise<HttpsResponse & { requisicao: unknown }> {
  if (!p.idempotencyKey) throw new Error("idempotencyKey é obrigatório");

  const token = await getInterPagAccessToken();
  const corpo = {
    valor: Number(p.valor),
    descricao: (p.descricao || "").slice(0, 140) || undefined,
    destinatario: { tipo: "CHAVE", chave: String(p.chave).trim() },
  };

  const r = await interPagHttpsRequest({
    method: "POST",
    path: "/banking/v2/pix",
    headers: authHeaders({
      Authorization: `Bearer ${token}`,
      "x-id-idempotente": p.idempotencyKey,
    }),
    body: JSON.stringify(corpo),
  });

  return { ...r, requisicao: corpo };
}

/** Consulta o status de um Pix já enviado. */
export async function consultarPix(codigoSolicitacao: string): Promise<HttpsResponse> {
  const token = await getInterPagAccessToken();
  return interPagHttpsRequest({
    method: "GET",
    path: `/banking/v2/pix/${encodeURIComponent(codigoSolicitacao)}`,
    headers: authHeaders({ Authorization: `Bearer ${token}` }),
  });
}

/** Normaliza os vários nomes de status que o Inter devolve. */
export function normalizarStatus(json: any): StatusPagamento {
  const bruto = String(
    json?.transacaoPix?.status || json?.status || json?.situacao || ""
  ).toUpperCase();

  if (["REALIZADO", "PAGO", "EFETIVADO", "CONCLUIDO", "APROVADO"].includes(bruto)) return "pago";
  if (["AGUARDANDO_APROVACAO", "PENDENTE_APROVACAO", "EM_APROVACAO"].includes(bruto))
    return "aguardando_aprovacao";
  if (["CANCELADO", "REJEITADO", "NAO_REALIZADO", "ERRO", "FALHA"].includes(bruto)) return "falhou";
  return "enviado";
}

/**
 * Porteiro. Um endpoint que move dinheiro não pode nascer aberto na internet.
 * Sem BRIDGE_SHARED_SECRET configurado, ninguém entra — nem você.
 */
export function autorizado(req: { headers: Record<string, any> }): boolean {
  const esperado = process.env.BRIDGE_SHARED_SECRET;
  if (!esperado) return false;

  const recebidoRaw = req.headers["x-bridge-secret"];
  const recebido = Array.isArray(recebidoRaw) ? recebidoRaw[0] : recebidoRaw;
  if (typeof recebido !== "string" || recebido.length !== esperado.length) return false;

  let dif = 0;
  for (let i = 0; i < esperado.length; i++) {
    dif |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  }
  return dif === 0;
}
