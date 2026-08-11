# Allmare Ecommerce V20

Correção definitiva de mobile:
- seção de modelos não usa mais reveal/IntersectionObserver;
- CSS força a vitrine a permanecer renderizada em qualquer viewport/toque;
- app.js e styles.css usam cache-busting `?v=20.0.0`;
- servidor envia HTML/CSS/JS com `Cache-Control: no-store`, evitando celular preso em versão antiga;
- 9 modelos, tamanhos M/G/GG e restante da V19 mantidos.

Render: `npm install` / `npm start`.
