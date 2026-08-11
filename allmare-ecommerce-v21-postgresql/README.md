# Allmare Ecommerce V21 — PostgreSQL

Baseada diretamente na V20, preservando o visual e a correção mobile/cache.

## O que mudou
- PostgreSQL real via `DATABASE_URL`.
- Criação automática e segura das tabelas com prefixo `allmare_`.
- O banco pode ser compartilhado com outro sistema sem alterar tabelas dele.
- Pedidos, itens, clientes, leads, atividades e revendedores passam a persistir no PostgreSQL.
- `allmare_payments` já fica preparada para a próxima etapa de confirmação automática do Mercado Pago.
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

Depois do deploy, abra `/api/health`. O retorno deve conter:
`"database":"postgresql"`
