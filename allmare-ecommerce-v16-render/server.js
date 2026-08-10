import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@allmare.com.br').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET = process.env.SESSION_SECRET || 'allmare-dev-secret';

function initialData(){return {orders:[], wholesale:[], customers:[], events:[]};}
function loadData(){try{return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));}catch{return initialData();}}
function saveData(data){fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true});fs.writeFileSync(DATA_FILE,JSON.stringify(data,null,2));}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>2e6)req.destroy();});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}});req.on('error',reject);});}
function token(payload){const raw=Buffer.from(JSON.stringify({...payload,exp:Date.now()+7*864e5})).toString('base64url');const sig=crypto.createHmac('sha256',SECRET).update(raw).digest('base64url');return raw+'.'+sig;}
function verify(t){try{const [raw,sig]=String(t||'').split('.');const expected=crypto.createHmac('sha256',SECRET).update(raw).digest('base64url');if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))return null;const p=JSON.parse(Buffer.from(raw,'base64url').toString());return p.exp>Date.now()?p:null;}catch{return null;}}
function auth(req){return verify((req.headers.authorization||'').replace(/^Bearer\s+/i,''));}
function cleanCep(v){return String(v||'').replace(/\D/g,'');}
function mime(file){return ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file).toLowerCase()]||'application/octet-stream';}
function serve(res,file){if(!fs.existsSync(file)||fs.statSync(file).isDirectory())return false;res.writeHead(200,{'Content-Type':mime(file),'Cache-Control':file.endsWith('.html')?'no-cache':'public, max-age=86400'});fs.createReadStream(file).pipe(res);return true;}
async function quoteShipping(cep,qty=1){const prefix=Number(cep.slice(0,2));if(prefix>=1&&prefix<=28)return {free:true,price:0,deliveryDays:5,service:'Frete promocional RJ e SP'};
 if(process.env.MELHOR_ENVIO_TOKEN&&process.env.MELHOR_ENVIO_FROM_POSTAL_CODE){try{const base=process.env.MELHOR_ENVIO_SANDBOX==='false'?'https://melhorenvio.com.br':'https://sandbox.melhorenvio.com.br';const r=await fetch(base+'/api/v2/me/shipment/calculate',{method:'POST',headers:{Authorization:'Bearer '+process.env.MELHOR_ENVIO_TOKEN,'Content-Type':'application/json','User-Agent':'Allmare ecommerce'},body:JSON.stringify({from:{postal_code:cleanCep(process.env.MELHOR_ENVIO_FROM_POSTAL_CODE)},to:{postal_code:cep},products:[{id:'drop02',width:25,height:8,length:30,weight:.35,insurance_value:99.9,quantity:Math.max(1,Number(qty)||1)}]})});const list=await r.json();const valid=Array.isArray(list)?list.filter(x=>x.price&&!x.error).sort((a,b)=>Number(a.price)-Number(b.price)):[];if(valid[0])return {free:false,price:Number(valid[0].price)+25,deliveryDays:Number(valid[0].delivery_time||8),service:'Envio econômico'};}catch(e){console.error('Melhor Envio:',e.message);}}
 return {free:false,price:49.9,deliveryDays:8,service:'Envio econômico (modo teste)'};
}
async function createPreference(order){if(!process.env.MERCADO_PAGO_ACCESS_TOKEN)return null;const base=process.env.PUBLIC_URL?.replace(/\/$/,'');if(!base)return null;const r=await fetch('https://api.mercadopago.com/checkout/preferences',{method:'POST',headers:{Authorization:'Bearer '+process.env.MERCADO_PAGO_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({items:order.items.map((x,i)=>({id:String(i+1),title:x.name+' - '+x.size,quantity:x.qty,unit_price:Number(x.unit),currency_id:'BRL'})),shipments:{cost:Number(order.shipping?.price||0)},payer:{name:order.customer.name,email:order.customer.email},external_reference:order.id,back_urls:{success:base+'/#account',pending:base+'/#account',failure:base+'/#checkout'},auto_return:'approved',notification_url:base+'/api/webhooks/mercadopago'})});if(!r.ok){console.error('Mercado Pago:',await r.text());return null;}const d=await r.json();return d.init_point||null;}

const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,admin:true});
  if(req.method==='POST'&&url.pathname==='/api/admin/login'){const b=await body(req);if(String(b.email||'').toLowerCase()!==ADMIN_EMAIL||String(b.password||'')!==ADMIN_PASSWORD)return json(res,401,{error:'E-mail ou senha inválidos'});return json(res,200,{token:token({role:'admin',email:ADMIN_EMAIL}),user:{name:'Administrador Allmare',email:ADMIN_EMAIL,role:'admin'}});}
  if(req.method==='POST'&&url.pathname==='/api/customer/login'){const b=await body(req);const d=loadData();let c=d.customers.find(x=>x.email===String(b.email||'').toLowerCase());if(!c){c={id:crypto.randomUUID(),name:b.name||'Cliente Allmare',email:String(b.email||'').toLowerCase()};d.customers.push(c);saveData(d);}return json(res,200,{token:token({role:'customer',email:c.email,id:c.id}),user:c});}
  if(req.method==='GET'&&url.pathname==='/api/me'){const u=auth(req);return u?json(res,200,u):json(res,401,{error:'Sessão inválida'});}
  if(req.method==='POST'&&url.pathname==='/api/events'){const b=await body(req);const d=loadData();d.events=d.events||[];d.events.unshift({id:crypto.randomUUID(),...b,created_at:new Date().toISOString()});d.events=d.events.slice(0,5000);saveData(d);return json(res,201,{ok:true});}
  if(req.method==='POST'&&url.pathname==='/api/wholesale'){const b=await body(req);const d=loadData();d.wholesale.unshift({id:crypto.randomUUID(),...b,status:'new',created_at:new Date().toISOString()});saveData(d);return json(res,201,{ok:true});}
  if(req.method==='GET'&&url.pathname==='/api/shipping/quote'){const cep=cleanCep(url.searchParams.get('cep'));if(cep.length!==8)return json(res,400,{error:'CEP inválido'});return json(res,200,await quoteShipping(cep,url.searchParams.get('qty')));}
  if(req.method==='POST'&&url.pathname==='/api/orders'){const b=await body(req);const d=loadData();const order={id:'ALM-'+Date.now().toString().slice(-8),...b,status:'pending',payment_status:'pending',tracking_code:'',label_url:'',created_at:new Date().toISOString()};d.orders.unshift(order);saveData(d);const checkoutUrl=await createPreference(order);return json(res,201,{order,checkoutUrl,demo:!checkoutUrl});}
  if(req.method==='GET'&&url.pathname==='/api/orders/mine'){const u=auth(req);if(!u)return json(res,401,{error:'Faça login'});const d=loadData();return json(res,200,d.orders.filter(o=>o.customer?.email===u.email));}
  if(url.pathname.startsWith('/api/admin/')){const u=auth(req);if(!u||u.role!=='admin')return json(res,401,{error:'Acesso administrativo necessário'});const d=loadData();if(req.method==='GET'&&url.pathname==='/api/admin/orders')return json(res,200,d.orders);if(req.method==='GET'&&url.pathname==='/api/admin/wholesale')return json(res,200,d.wholesale);if(req.method==='GET'&&url.pathname==='/api/admin/events')return json(res,200,d.events||[]);if(req.method==='GET'&&url.pathname==='/api/admin/stats')return json(res,200,{orders:d.orders.length,revenue:d.orders.filter(x=>x.payment_status==='approved').reduce((a,b)=>a+Number(b.total||0),0),pending:d.orders.filter(x=>!['delivered','cancelled'].includes(x.status)).length,wholesale:d.wholesale.length,leads:new Set((d.events||[]).map(x=>x.visitor_id).filter(Boolean)).size,checkouts:(d.events||[]).filter(x=>x.type==='checkout_started').length});if(req.method==='PATCH'&&url.pathname.startsWith('/api/admin/orders/')){const id=decodeURIComponent(url.pathname.split('/').pop());const b=await body(req);const o=d.orders.find(x=>x.id===id);if(!o)return json(res,404,{error:'Pedido não encontrado'});Object.assign(o,b);saveData(d);return json(res,200,{ok:true,order:o});}}
  if(req.method==='POST'&&url.pathname==='/api/webhooks/mercadopago')return json(res,200,{ok:true});
  let rel=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);let file=path.normalize(path.join(PUBLIC,rel));if(!file.startsWith(PUBLIC))return json(res,403,{error:'Acesso negado'});if(serve(res,file))return;if(!path.extname(rel))return serve(res,path.join(PUBLIC,'index.html'));json(res,404,{error:'Arquivo não encontrado'});
 }catch(e){console.error(e);json(res,500,{error:'Erro interno do servidor'});}
});
server.listen(PORT,()=>console.log('Allmare funcionando em http://localhost:'+PORT));
