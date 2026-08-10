# ALLMARE Ecommerce V9

## Abrir diretamente no Windows
1. Extraia TODO o ZIP.
2. Entre na pasta `public`.
3. Dê dois cliques em `index.html`.
4. O site funciona em modo local (file://) usando localStorage para carrinho, pedidos, clientes e revendedores.
5. Admin: clique em Admin no menu ou abra `admin.html`.
   - E-mail: admin@allmare.com.br
   - Senha: admin123

## Rodar com backend
Na raiz do projeto:

npm start

Abra http://localhost:3000

## Render
Start command: npm start
Defina ADMIN_EMAIL, ADMIN_PASSWORD, SESSION_SECRET, PUBLIC_URL, MERCADO_PAGO_ACCESS_TOKEN e credenciais do Melhor Envio conforme necessário.

## Importante
O modo file:// é uma demonstração local e não processa pagamentos reais. Mercado Pago/Melhor Envio reais exigem o backend executando no Render ou localmente.

## V10 — atualização sem alterar a estrutura visual
- Oferta do Drop: 3 peças por R$ 189,00, aplicada automaticamente no carrinho.
- Rastreamento de add-to-cart, abertura/início de checkout e cadastro de revendedor.
- Admin: nova aba “Leads & atividade” com dados de contato fornecidos no checkout/cadastro para remarketing.
- A identidade/estrutura visual original foi preservada; apenas um destaque discreto da promoção foi inserido.
- Arquivo visual de referência da promoção: public/assets/oferta-3-por-189.png.

## V12 — refinamentos visuais
- Logo Allmare redesenhada em SVG vetorial transparente, sem dependência de fonte no arquivo da marca.
- Cabeçalho com informações reorganizadas e textos mais nítidos.
- Tipografia do site refinada sem alterar a estrutura da V11.
- Rodapé com CTA direto para WhatsApp no número 21 96639-0331.
- Botão flutuante de WhatsApp incluído.

V13: logo Allmare refeita em SVG limpo e transparente; bloco Troca Fácil removido do cabeçalho.


## V14 — acabamento premium
- Logo do rodapé invertida para leitura perfeita no fundo preto.
- Ícone vetorial do WhatsApp no CTA e no botão flutuante.
- Bandeiras vetoriais de Pix, Visa, Mastercard, Elo, Amex e Boleto no rodapé.
- Motion CSS: entrada suave de seções, hero com movimento sutil, cards responsivos, CTA e oferta com microinterações.
- Respeita `prefers-reduced-motion` e mantém o modo local `file://` e o deploy no Render.

## V16 — ajustes finais de interface
- Coleção identificada como DROP 2.
- Bandeiras de pagamento exibidas de forma estática, sem animação/hover.
- Demais animações e responsividade da V14 mantidas.


## V16
Coleção atualizada com 9 modelos disponíveis, todos com tamanhos M, G e GG. Preparado para Render.
