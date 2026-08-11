// Cliente compartilhado da API do Banco Inter -- mTLS + OAuth 2.0.
// Usado por todos os endpoints (auth, extrato, saldo, cobranca).

import https from "https";

interface InterTokenCache {
  token: string | null;
  expiry: number;
}

const cache: InterTokenCache = { token: null, expiry: 0 };

function getCertKey(): { cert: string; key: string } {
  const cert = Buffer.from(process.env.INTER_CERT_BASE64 as string, "base64").toString("utf-8");
  const key = Buffer.from(process.env.INTER_KEY_BASE64 as string, "base64").toString("utf-8");
  return { cert, key };
}

interface HttpsRequestOptions {
  hostname: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  cert: string;
  key: string;
}

interface HttpsResponse {
  status: number;
  headers: Record<string, unknown>;
  body: string;
}

export function interHttpsRequest(options: HttpsRequestOptions): Promise<HttpsResponse> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: options.hostname,
        path: options.path,
        method: options.method,
        headers: options.headers,
        cert: options.cert,
        key: options.key,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, headers: res.headers, body: data });
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

const SCOPES = [
  "extrato.read",
  "boleto-cobranca.read",
  "boleto-cobranca.write",
  "cob.write",
  "cob.read",
  "cobv.write",
  "cobv.read",
  "pix.write",
  "pix.read",
  "webhook.read",
  "webhook.write",
  "payloadlocation.write",
  "payloadlocation.read",
].join(" ");

export async function getInterAccessToken(): Promise<string> {
  const now = Date.now();
  if (cache.token && now < cache.expiry) return cache.token;

  const { cert, key } = getCertKey();

  const bodyParams = new URLSearchParams({
    client_id: process.env.INTER_CLIENT_ID as string,
    client_secret: process.env.INTER_CLIENT_SECRET as string,
    scope: SCOPES,
    grant_type: "client_credentials",
  }).toString();

  const resp = await interHttpsRequest({
    hostname: "cdpj.partners.bancointer.com.br",
    path: "/oauth/v2/token",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": String(Buffer.byteLength(bodyParams)),
    },
    body: bodyParams,
    cert,
    key,
  });

  const data = JSON.parse(resp.body);
  if (resp.status !== 200 || !data.access_token) {
    throw new Error(`Falha na autenticacao Inter (status ${resp.status}): ${resp.body}`);
  }

  cache.token = data.access_token;
  cache.expiry = now + (data.expires_in - 60) * 1000;
  return cache.token as string;
}

export async function interApiRequest(
  path: string,
  method: string = "GET",
  body?: unknown
): Promise<HttpsResponse> {
  const { cert, key } = getCertKey();
  const token = await getInterAccessToken();

  const bodyStr = body ? JSON.stringify(body) : undefined;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (process.env.INTER_CONTA_CORRENTE) {
    headers["x-conta-corrente"] = process.env.INTER_CONTA_CORRENTE;
  }
  if (bodyStr) headers["Content-Length"] = String(Buffer.byteLength(bodyStr));

  return interHttpsRequest({
    hostname: "cdpj.partners.bancointer.com.br",
    path,
    method,
    headers,
    body: bodyStr,
    cert,
    key,
  });
}
