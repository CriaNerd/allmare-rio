import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@allmare.com.br').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET = process.env.SESSION_SECRET || 'allmare-dev-secret';
const DATABASE_URL = process.env.DATABASE_URL || '';
const usingPostgres = Boolean(DATABASE_URL);

const pool = usingPostgres ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
}) : null;

function initialData(){return {orders:[], wholesale:[], customers:[], events:[]};}
function loadData(){try{return JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));}catch{return initialData();}}
function saveData(data){fs.mkdirSync(path.dirname(DATA_FILE),{recursive:true});fs.writeFileSync(DATA_FILE,JSON.stringify(data,null,2));}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>2e6)req.destroy();});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}});req.on('error',reject);});}
function token(payload){const raw=Buffer.from(JSON.stringify({...payload,exp:Date.now()+7*864e5})).toString('base64url');const sig=crypto.createHmac('sha256',SECRET).update(raw).digest('base64url');return raw+'.'+sig;}
function verify(t){try{const [raw,sig]=String(t||'').split('.');if(!raw||!sig)return null;const expected=crypto.createHmac('sha256',SECRET).update(raw).digest('base64url');const a=Buffer.from(sig),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;const p=JSON.parse(Buffer.from(raw,'base64url').toString());return p.exp>Date.now()?p:null;}catch{return null;}}
function auth(req){return verify((req.headers.authorization||'').replace(/^Bearer\s+/i,''));}
function cleanCep(v){return String(v||'').replace(/\D/g,'');}
function mime(file){return ({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file).toLowerCase()]||'application/octet-stream';}
function serve(res,file){if(!fs.existsSync(file)||fs.statSync(file).isDirectory())return false;const dynamicAsset=/\.(html|css|js)$/i.test(file);res.writeHead(200,{'Content-Type':mime(file),'Cache-Control':dynamicAsset?'no-store, max-age=0':'public, max-age=604800, immutable'});fs.createReadStream(file).pipe(res);return true;}

async function initDatabase(){
  if(!pool) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS allmare_customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS allmare_orders (
      id TEXT PRIMARY KEY,
      customer_email TEXT,
      customer JSONB NOT NULL DEFAULT '{}'::jsonb,
      shipping JSONB NOT NULL DEFAULT '{}'::jsonb,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      tracking_code TEXT NOT NULL DEFAULT '',
      label_url TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS allmare_orders_customer_email_idx ON allmare_orders(customer_email);
    CREATE INDEX IF NOT EXISTS allmare_orders_created_at_idx ON allmare_orders(created_at DESC);

    CREATE TABLE IF NOT EXISTS allmare_order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES allmare_orders(id) ON DELETE CASCADE,
      product_id TEXT,
      name TEXT,
      size TEXT,
      qty INTEGER NOT NULL DEFAULT 1,
      unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      image TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS allmare_order_items_order_idx ON allmare_order_items(order_id);

    CREATE TABLE IF NOT EXISTS allmare_wholesale_leads (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      phone TEXT,
      cep TEXT,
      quantity TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS allmare_lead_events (
      id TEXT PRIMARY KEY,
      visitor_id TEXT,
      type TEXT,
      path TEXT,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS allmare_lead_events_visitor_idx ON allmare_lead_events(visitor_id);
    CREATE INDEX IF NOT EXISTS allmare_lead_events_created_idx ON allmare_lead_events(created_at DESC);

    CREATE TABLE IF NOT EXISTS allmare_payments (
      id TEXT PRIMARY KEY,
      order_id TEXT REFERENCES allmare_orders(id) ON DELETE SET NULL,
      provider TEXT NOT NULL DEFAULT 'mercadopago',
      provider_payment_id TEXT,
      status TEXT,
      amount NUMERIC(12,2),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  await pool.query(sql);
  console.log('PostgreSQL Allmare: tabelas allmare_* prontas.');
}

function normalizeOrder(row, items=[]){
  const payload = row.payload || {};
  return {
    ...payload,
    id: row.id,
    customer: row.customer || payload.customer || {},
    items,
    shipping: row.shipping || payload.shipping || {},
    total: Number(row.total || payload.total || 0),
    status: row.status,
    payment_status: row.payment_status,
    tracking_code: row.tracking_code || '',
    label_url: row.label_url || '',
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

async function dbCustomerLogin(b){
  const email=String(b.email||'').toLowerCase();
  if(!pool){const d=loadData();let c=d.customers.find(x=>x.email===email);if(!c){c={id:crypto.randomUUID(),name:b.name||'Cliente Allmare',email};d.customers.push(c);saveData(d);}return c;}
  const id=crypto.randomUUID();
  const name=b.name||'Cliente Allmare';
  const q=await pool.query(`INSERT INTO allmare_customers(id,name,email) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET name=COALESCE(NULLIF(EXCLUDED.name,''),allmare_customers.name) RETURNING id,name,email`,[id,name,email]);
  return q.rows[0];
}

async function dbAddEvent(b){
  const event={id:crypto.randomUUID(),...b,created_at:new Date().toISOString()};
  if(!pool){const d=loadData();d.events=d.events||[];d.events.unshift(event);d.events=d.events.slice(0,5000);saveData(d);return event;}
  await pool.query(`INSERT INTO allmare_lead_events(id,visitor_id,type,path,data,payload,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,[event.id,event.visitor_id||null,event.type||null,event.path||null,JSON.stringify(event.data||{}),JSON.stringify(event),event.created_at]);
  return event;
}

async function dbAddWholesale(b){
  const lead={id:crypto.randomUUID(),...b,status:'new',created_at:new Date().toISOString()};
  if(!pool){const d=loadData();d.wholesale.unshift(lead);saveData(d);return lead;}
  await pool.query(`INSERT INTO allmare_wholesale_leads(id,name,email,phone,cep,quantity,status,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,[lead.id,lead.name||null,lead.email||null,lead.phone||null,lead.cep||null,String(lead.quantity||''),lead.status,JSON.stringify(lead),lead.created_at]);
  return lead;
}

async function dbCreateOrder(b){
  const order={id:'ALM-'+Date.now().toString().slice(-8),...b,status:'pending',payment_status:'pending',tracking_code:'',label_url:'',created_at:new Date().toISOString()};
  if(!pool){const d=loadData();d.orders.unshift(order);saveData(d);return order;}
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`INSERT INTO allmare_orders(id,customer_email,customer,shipping,total,status,payment_status,tracking_code,label_url,payload,created_at,updated_at) VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10::jsonb,$11,$11)`,[order.id,order.customer?.email?.toLowerCase()||null,JSON.stringify(order.customer||{}),JSON.stringify(order.shipping||{}),Number(order.total||0),order.status,order.payment_status,'','',JSON.stringify(order),order.created_at]);
    for(const x of order.items||[]){
      await client.query(`INSERT INTO allmare_order_items(id,order_id,product_id,name,size,qty,unit_price,image,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,[crypto.randomUUID(),order.id,String(x.id||x.product_id||''),x.name||'',x.size||'',Number(x.qty||1),Number(x.unit??x.unit_price??0),x.image||'',JSON.stringify(x)]);
    }
    await client.query('COMMIT');
    return order;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

async function dbListOrders(email=null){
  if(!pool){const d=loadData();return email?d.orders.filter(o=>o.customer?.email===email):d.orders;}
  const q=await pool.query(`SELECT * FROM allmare_orders ${email?'WHERE customer_email=$1':''} ORDER BY created_at DESC`,email?[email]:[]);
  if(!q.rows.length)return [];
  const ids=q.rows.map(r=>r.id);
  const iq=await pool.query(`SELECT * FROM allmare_order_items WHERE order_id = ANY($1::text[]) ORDER BY id`,[ids]);
  const byOrder=new Map();
  for(const x of iq.rows){if(!byOrder.has(x.order_id))byOrder.set(x.order_id,[]);byOrder.get(x.order_id).push({...x.payload,id:x.product_id||x.payload?.id,name:x.name,size:x.size,qty:Number(x.qty),unit:Number(x.unit_price),image:x.image});}
  return q.rows.map(r=>normalizeOrder(r,byOrder.get(r.id)||[]));
}

async function dbListWholesale(){
  if(!pool)return loadData().wholesale;
  const q=await pool.query(`SELECT * FROM allmare_wholesale_leads ORDER BY created_at DESC`);
  return q.rows.map(r=>({...r.payload,id:r.id,name:r.name,email:r.email,phone:r.phone,cep:r.cep,quantity:r.quantity,status:r.status,created_at:r.created_at}));
}

async function dbListEvents(){
  if(!pool)return loadData().events||[];
  const q=await pool.query(`SELECT * FROM allmare_lead_events ORDER BY created_at DESC LIMIT 5000`);
  return q.rows.map(r=>({...r.payload,id:r.id,visitor_id:r.visitor_id,type:r.type,path:r.path,data:r.data||{},created_at:r.created_at}));
}

async function dbStats(){
  if(!pool){const d=loadData();return {orders:d.orders.length,revenue:d.orders.filter(x=>x.payment_status==='approved').reduce((a,b)=>a+Number(b.total||0),0),pending:d.orders.filter(x=>!['delivered','cancelled'].includes(x.status)).length,wholesale:d.wholesale.length,leads:new Set((d.events||[]).map(x=>x.visitor_id).filter(Boolean)).size,checkouts:(d.events||[]).filter(x=>x.type==='checkout_started').length};}
  const q=await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM allmare_orders) AS orders,
    (SELECT COALESCE(SUM(total),0)::numeric FROM allmare_orders WHERE payment_status='approved') AS revenue,
    (SELECT COUNT(*)::int FROM allmare_orders WHERE status NOT IN ('delivered','cancelled')) AS pending,
    (SELECT COUNT(*)::int FROM allmare_wholesale_leads) AS wholesale,
    (SELECT COUNT(DISTINCT visitor_id)::int FROM allmare_lead_events WHERE visitor_id IS NOT NULL AND visitor_id<>'') AS leads,
    (SELECT COUNT(*)::int FROM allmare_lead_events WHERE type='checkout_started') AS checkouts`);
  const r=q.rows[0];return {...r,revenue:Number(r.revenue||0)};
}

async function dbPatchOrder(id,patch){
  if(!pool){const d=loadData();const o=d.orders.find(x=>x.id===id);if(!o)return null;Object.assign(o,patch);saveData(d);return o;}
  const current=(await dbListOrders()).find(x=>x.id===id);if(!current)return null;
  const merged={...current,...patch};
  const q=await pool.query(`UPDATE allmare_orders SET status=$2,payment_status=$3,tracking_code=$4,label_url=$5,payload=$6::jsonb,updated_at=NOW() WHERE id=$1 RETURNING *`,[id,merged.status||'pending',merged.payment_status||'pending',merged.tracking_code||'',merged.label_url||'',JSON.stringify(merged)]);
  return normalizeOrder(q.rows[0],current.items||[]);
}

async function quoteShipping(cep,qty=1){const prefix=Number(cep.slice(0,2));if(prefix>=1&&prefix<=28)return {free:true,price:0,deliveryDays:5,service:'Frete promocional RJ e SP'};
 if(process.env.MELHOR_ENVIO_TOKEN&&process.env.MELHOR_ENVIO_FROM_POSTAL_CODE){try{const base=process.env.MELHOR_ENVIO_SANDBOX==='false'?'https://melhorenvio.com.br':'https://sandbox.melhorenvio.com.br';const r=await fetch(base+'/api/v2/me/shipment/calculate',{method:'POST',headers:{Authorization:'Bearer '+process.env.MELHOR_ENVIO_TOKEN,'Content-Type':'application/json','User-Agent':'Allmare ecommerce'},body:JSON.stringify({from:{postal_code:cleanCep(process.env.MELHOR_ENVIO_FROM_POSTAL_CODE)},to:{postal_code:cep},products:[{id:'drop02',width:25,height:8,length:30,weight:.35,insurance_value:99.9,quantity:Math.max(1,Number(qty)||1)}]})});const list=await r.json();const valid=Array.isArray(list)?list.filter(x=>x.price&&!x.error).sort((a,b)=>Number(a.price)-Number(b.price)):[];if(valid[0])return {free:false,price:Number(valid[0].price)+25,deliveryDays:Number(valid[0].delivery_time||8),service:'Envio econômico'};}catch(e){console.error('Melhor Envio:',e.message);}}
 return {free:false,price:49.9,deliveryDays:8,service:'Envio econômico (modo teste)'};
}

async function createPreference(order){if(!process.env.MERCADO_PAGO_ACCESS_TOKEN)return null;const base=process.env.PUBLIC_URL?.replace(/\/$/,'');if(!base)return null;const r=await fetch('https://api.mercadopago.com/checkout/preferences',{method:'POST',headers:{Authorization:'Bearer '+process.env.MERCADO_PAGO_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({items:order.items.map((x,i)=>({id:String(i+1),title:x.name+' - '+x.size,quantity:x.qty,unit_price:Number(x.unit),currency_id:'BRL'})),shipments:{cost:Number(order.shipping?.price||0)},payer:{name:order.customer.name,email:order.customer.email},external_reference:order.id,back_urls:{success:base+'/#account',pending:base+'/#account',failure:base+'/#checkout'},auto_return:'approved',notification_url:base+'/api/webhooks/mercadopago'})});if(!r.ok){console.error('Mercado Pago:',await r.text());return null;}const d=await r.json();return d.init_point||null;}

const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,admin:true,database:usingPostgres?'postgresql':'local-json'});
  if(req.method==='POST'&&url.pathname==='/api/admin/login'){const b=await body(req);if(String(b.email||'').toLowerCase()!==ADMIN_EMAIL||String(b.password||'')!==ADMIN_PASSWORD)return json(res,401,{error:'E-mail ou senha inválidos'});return json(res,200,{token:token({role:'admin',email:ADMIN_EMAIL}),user:{name:'Administrador Allmare',email:ADMIN_EMAIL,role:'admin'}});}
  if(req.method==='POST'&&url.pathname==='/api/customer/login'){const b=await body(req);const c=await dbCustomerLogin(b);return json(res,200,{token:token({role:'customer',email:c.email,id:c.id}),user:c});}
  if(req.method==='GET'&&url.pathname==='/api/me'){const u=auth(req);return u?json(res,200,u):json(res,401,{error:'Sessão inválida'});}
  if(req.method==='POST'&&url.pathname==='/api/events'){const b=await body(req);await dbAddEvent(b);return json(res,201,{ok:true});}
  if(req.method==='POST'&&url.pathname==='/api/wholesale'){const b=await body(req);await dbAddWholesale(b);return json(res,201,{ok:true});}
  if(req.method==='GET'&&url.pathname==='/api/shipping/quote'){const cep=cleanCep(url.searchParams.get('cep'));if(cep.length!==8)return json(res,400,{error:'CEP inválido'});return json(res,200,await quoteShipping(cep,url.searchParams.get('qty')));}
  if(req.method==='POST'&&url.pathname==='/api/orders'){const b=await body(req);const order=await dbCreateOrder(b);const checkoutUrl=await createPreference(order);return json(res,201,{order,checkoutUrl,demo:!checkoutUrl});}
  if(req.method==='GET'&&url.pathname==='/api/orders/mine'){const u=auth(req);if(!u)return json(res,401,{error:'Faça login'});return json(res,200,await dbListOrders(u.email));}
  if(url.pathname.startsWith('/api/admin/')){
    const u=auth(req);if(!u||u.role!=='admin')return json(res,401,{error:'Acesso administrativo necessário'});
    if(req.method==='GET'&&url.pathname==='/api/admin/orders')return json(res,200,await dbListOrders());
    if(req.method==='GET'&&url.pathname==='/api/admin/wholesale')return json(res,200,await dbListWholesale());
    if(req.method==='GET'&&url.pathname==='/api/admin/events')return json(res,200,await dbListEvents());
    if(req.method==='GET'&&url.pathname==='/api/admin/stats')return json(res,200,await dbStats());
    if(req.method==='PATCH'&&url.pathname.startsWith('/api/admin/orders/')){const id=decodeURIComponent(url.pathname.split('/').pop());const b=await body(req);const o=await dbPatchOrder(id,b);if(!o)return json(res,404,{error:'Pedido não encontrado'});return json(res,200,{ok:true,order:o});}
  }
  if(req.method==='POST'&&url.pathname==='/api/webhooks/mercadopago')return json(res,200,{ok:true});
  let rel=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);let file=path.normalize(path.join(PUBLIC,rel));if(!file.startsWith(PUBLIC))return json(res,403,{error:'Acesso negado'});if(serve(res,file))return;if(!path.extname(rel))return serve(res,path.join(PUBLIC,'index.html'));json(res,404,{error:'Arquivo não encontrado'});
 }catch(e){console.error(e);json(res,500,{error:'Erro interno do servidor'});}
});

try{
  await initDatabase();
  server.listen(PORT,()=>console.log(`Allmare V21 funcionando em http://localhost:${PORT} | banco: ${usingPostgres?'PostgreSQL':'JSON local (fallback)'}`));
}catch(e){
  console.error('Falha ao inicializar PostgreSQL:',e);
  process.exit(1);
}
