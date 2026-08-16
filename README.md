# Allmare Ecommerce V22 — pagamento, frete, etiquetas e analytics

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

Depois do deploy, abra `/api/health`. O retorno deve conter:
`"database":"postgresql"`
