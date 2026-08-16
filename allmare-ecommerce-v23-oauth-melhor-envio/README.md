# Allmare Ecommerce V23 — OAuth automático do Melhor Envio

Baseada diretamente na V20, preservando o visual e a correção mobile/cache.

## O que mudou
- PostgreSQL real via `DATABASE_URL`.
- Criação automática e segura das tabelas com prefixo `allmare_`.
- O banco pode ser compartilhado com outro sistema sem alterar tabelas dele.
- Pedidos, itens, clientes, leads, atividades e revendedores passam a persistir no PostgreSQL.
- Pagamento real pelo Checkout Pro e confirmação automática via webhook autenticado.
- Opções reais de preço e prazo do Melhor Envio para o cliente selecionar.
- Compra e geração automática da etiqueta após a aprovação; PDF e dados completos no admin.
- Funil de marketing com visualizações, sacola, frete, checkout e conversão.
- Botão de conexão do Melhor Envio dentro do admin.
- Access Token e Refresh Token criptografados no PostgreSQL.
- Renovação automática do Access Token antes do vencimento.
- Se `DATABASE_URL` não existir, o projeto ainda funciona localmente usando `data/store.json` como fallback.

## Tabelas criadas automaticamente
- allmare_customers
- allmare_orders
- allmare_order_items
- allmare_wholesale_leads
- allmare_lead_events
- allmare_payments

## Render
Root Directory: pasta desta versão, se ela estiver dentro de uma pasta no GitHub.
Build Command: `npm install`
Start Command: `npm start`

Em Environment, adicione a `DATABASE_URL` usando a Internal Database URL do PostgreSQL do Render.

O login administrativo não possui credencial local: ele lê exclusivamente `ADMIN_EMAIL` e `ADMIN_PASSWORD` do Environment do Render.

No Mercado Pago, configure o webhook de produção como `https://SEU-DOMINIO/api/webhooks/mercadopago`, marque **Pagamentos** e salve o segredo em `MERCADO_PAGO_WEBHOOK_SECRET`.

No Melhor Envio, o token precisa permitir cálculo, checkout, geração, impressão e rastreamento. Para a compra automática funcionar, mantenha saldo na carteira, use `MELHOR_ENVIO_SANDBOX=false` e preencha todos os dados `MELHOR_ENVIO_FROM_*` do remetente.

## Conectar o Melhor Envio na V23
1. Configure `MELHOR_ENVIO_CLIENT_ID` e `MELHOR_ENVIO_CLIENT_SECRET` no Render.
2. Faça o deploy e entre em `/admin.html`.
3. Abra **Integrações** e copie a Callback URL exibida.
4. Cadastre exatamente essa URL no aplicativo do Melhor Envio.
5. Clique em **Conectar Melhor Envio** e autorize.

Depois do deploy, abra `/api/health`. O retorno deve conter:
`"database":"postgresql"`
