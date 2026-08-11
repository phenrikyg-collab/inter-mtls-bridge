# inter-mtls-bridge

Ponte mTLS para a API do Banco Inter (autenticação mútua + OAuth 2.0). O Supabase (Deno) não suporta mTLS de saída de forma confiável, então essa camada Node.js/Vercel resolve a autenticação e repassa as chamadas — mesmo padrão usado no `bradesco-mtls-bridge`.

## Variáveis de ambiente
Configurar no painel do Vercel (Project Settings → Environment Variables):

| Variável | Descrição |
|---|---|
| `INTER_CLIENT_ID` | Client ID gerado na Nova Integração do Inter |
| `INTER_CLIENT_SECRET` | Client Secret gerado junto |
| `INTER_CERT_BASE64` | Certificado `.crt` da integração, em base64 (uma linha só) |
| `INTER_KEY_BASE64` | Chave privada `.key` da integração, em base64 (uma linha só) |
| `INTER_CONTA_CORRENTE` | Número da conta corrente (opcional, só se algum endpoint exigir) |

## Endpoints

| Rota | Método | Descrição |
|---|---|---|
| `/api/auth` | GET | Testa a autenticação (confirma se gerou token) |
| `/api/extrato?dataInicio=YYYY-MM-DD&dataFim=YYYY-MM-DD` | GET | Extrato bancário |
| `/api/saldo` | GET | Saldo atual (aceita `?dataSaldo=YYYY-MM-DD` opcional) |
| `/api/cobranca-pix` | POST | Cria cobrança Pix imediata (`{ valor, chave, nome_devedor?, cpf_cnpj_devedor? }`) |

## Estrutura
```
api/
  _shared/
    interClient.ts   -- mTLS + cache de token OAuth, reaproveitado por todos os endpoints
  auth.ts
  extrato.ts
  saldo.ts
  cobranca-pix.ts
```
