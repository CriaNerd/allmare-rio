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
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || '').toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const SECRET = process.env.SESSION_SECRET || 'allmare-dev-secret';
const DATABASE_URL = process.env.DATABASE_URL || '';
const usingPostgres = Boolean(DATABASE_URL);
const MP_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN || '';
const MP_WEBHOOK_SECRET = process.env.MERCADO_PAGO_WEBHOOK_SECRET || process.env.MP_WEBHOOK_SECRET || '';
const ME_TOKEN = process.env.MELHOR_ENVIO_TOKEN || '';
const ME_BASE = process.env.MELHOR_ENVIO_SANDBOX === 'false' ? 'https://melhorenvio.com.br' : 'https://sandbox.melhorenvio.com.br';
const ME_CLIENT_ID = process.env.MELHOR_ENVIO_CLIENT_ID || '';
const ME_CLIENT_SECRET = process.env.MELHOR_ENVIO_CLIENT_SECRET || '';
const ME_SCOPES = 'cart-read cart-write orders-read purchases-read shipping-calculate shipping-checkout shipping-companies shipping-generate shipping-print shipping-tracking ecommerce-shipping transactions-read users-read';
const SHIPPING_MARKUP = Number(process.env.SHIPPING_MARKUP || 0);

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
      shipment_id TEXT NOT NULL DEFAULT '',
      shipment_status TEXT NOT NULL DEFAULT '',
      label_error TEXT NOT NULL DEFAULT '',
      provider_payment_id TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS allmare_orders_customer_email_idx ON allmare_orders(customer_email);
    CREATE INDEX IF NOT EXISTS allmare_orders_created_at_idx ON allmare_orders(created_at DESC);
    ALTER TABLE allmare_orders ADD COLUMN IF NOT EXISTS shipment_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE allmare_orders ADD COLUMN IF NOT EXISTS shipment_status TEXT NOT NULL DEFAULT '';
    ALTER TABLE allmare_orders ADD COLUMN IF NOT EXISTS label_error TEXT NOT NULL DEFAULT '';
    ALTER TABLE allmare_orders ADD COLUMN IF NOT EXISTS provider_payment_id TEXT NOT NULL DEFAULT '';

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
    CREATE TABLE IF NOT EXISTS allmare_integrations (
      provider TEXT PRIMARY KEY,
      credentials TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
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
    shipment_id: row.shipment_id || '',
    shipment_status: row.shipment_status || '',
    label_error: row.label_error || '',
    provider_payment_id: row.provider_payment_id || '',
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
  if(!pool){const d=loadData(),events=d.events||[],leads=new Set(events.map(x=>x.visitor_id).filter(Boolean)).size,checkouts=events.filter(x=>x.type==='checkout_started').length,approved=d.orders.filter(x=>x.payment_status==='approved').length;return {orders:d.orders.length,revenue:d.orders.filter(x=>x.payment_status==='approved').reduce((a,b)=>a+Number(b.total||0),0),pending:d.orders.filter(x=>!['delivered','cancelled'].includes(x.status)).length,wholesale:d.wholesale.length,leads,checkouts,pageviews:events.filter(x=>x.type==='page_view').length,addToCarts:events.filter(x=>x.type==='add_to_cart').length,approved,conversion:leads?Number((approved/leads*100).toFixed(1)):0};}
  const q=await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM allmare_orders) AS orders,
    (SELECT COALESCE(SUM(total),0)::numeric FROM allmare_orders WHERE payment_status='approved') AS revenue,
    (SELECT COUNT(*)::int FROM allmare_orders WHERE status NOT IN ('delivered','cancelled')) AS pending,
    (SELECT COUNT(*)::int FROM allmare_wholesale_leads) AS wholesale,
    (SELECT COUNT(DISTINCT visitor_id)::int FROM allmare_lead_events WHERE visitor_id IS NOT NULL AND visitor_id<>'') AS leads,
    (SELECT COUNT(*)::int FROM allmare_lead_events WHERE type='checkout_started') AS checkouts,
    (SELECT COUNT(*)::int FROM allmare_lead_events WHERE type='page_view') AS pageviews,
    (SELECT COUNT(*)::int FROM allmare_lead_events WHERE type='add_to_cart') AS "addToCarts",
    (SELECT COUNT(*)::int FROM allmare_orders WHERE payment_status='approved') AS approved`);
  const r=q.rows[0];return {...r,revenue:Number(r.revenue||0),conversion:r.leads?Number((r.approved/r.leads*100).toFixed(1)):0};
}

async function dbPatchOrder(id,patch){
  if(!pool){const d=loadData();const o=d.orders.find(x=>x.id===id);if(!o)return null;Object.assign(o,patch);saveData(d);return o;}
  const current=(await dbListOrders()).find(x=>x.id===id);if(!current)return null;
  const merged={...current,...patch};
  const q=await pool.query(`UPDATE allmare_orders SET status=$2,payment_status=$3,tracking_code=$4,label_url=$5,shipment_id=$6,shipment_status=$7,label_error=$8,provider_payment_id=$9,payload=$10::jsonb,updated_at=NOW() WHERE id=$1 RETURNING *`,[id,merged.status||'pending',merged.payment_status||'pending',merged.tracking_code||'',merged.label_url||'',merged.shipment_id||'',merged.shipment_status||'',merged.label_error||'',merged.provider_payment_id||'',JSON.stringify(merged)]);
  return normalizeOrder(q.rows[0],current.items||[]);
}

function encryptCredentials(value){const key=crypto.createHash('sha256').update(SECRET).digest(),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]),tag=cipher.getAuthTag();return [iv,tag,encrypted].map(x=>x.toString('base64url')).join('.');}
function decryptCredentials(value){try{const [iv,tag,encrypted]=String(value||'').split('.').map(x=>Buffer.from(x,'base64url'));const key=crypto.createHash('sha256').update(SECRET).digest(),decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);decipher.setAuthTag(tag);return JSON.parse(Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8'));}catch{return null;}}
async function integrationGet(){if(!pool)return null;const q=await pool.query(`SELECT * FROM allmare_integrations WHERE provider='melhor_envio'`);if(!q.rows[0])return null;return {...q.rows[0].metadata,credentials:decryptCredentials(q.rows[0].credentials)};}
async function integrationSave(credentials,metadata={}){if(!pool)throw new Error('A conexão automática do Melhor Envio exige PostgreSQL');await pool.query(`INSERT INTO allmare_integrations(provider,credentials,metadata,created_at,updated_at) VALUES('melhor_envio',$1,$2::jsonb,NOW(),NOW()) ON CONFLICT(provider) DO UPDATE SET credentials=EXCLUDED.credentials,metadata=EXCLUDED.metadata,updated_at=NOW()`,[encryptCredentials(credentials),JSON.stringify(metadata)]);}
function meCallbackUrl(){const base=String(process.env.PUBLIC_URL||'').replace(/\/$/,'');if(!base)throw new Error('PUBLIC_URL não configurada');return base+'/api/integrations/melhor-envio/callback';}
async function meOauthToken(params){if(!ME_CLIENT_ID||!ME_CLIENT_SECRET)throw new Error('MELHOR_ENVIO_CLIENT_ID e MELHOR_ENVIO_CLIENT_SECRET não configurados');const r=await fetch(ME_BASE+'/oauth/token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded','User-Agent':'Allmare ecommerce contato@allmare.com.br'},body:new URLSearchParams({...params,client_id:ME_CLIENT_ID,client_secret:ME_CLIENT_SECRET})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||d.error_description||d.error||'Falha ao autenticar no Melhor Envio');return d;}
async function saveMeToken(d){const credentials={access_token:d.access_token,refresh_token:d.refresh_token,token_type:d.token_type||'Bearer',expires_at:Date.now()+Number(d.expires_in||2592000)*1000};await integrationSave(credentials,{connected_at:new Date().toISOString(),scope:d.scope||ME_SCOPES});return credentials;}
async function meAccessToken(){const integration=await integrationGet();let c=integration?.credentials;if(c?.access_token&&Number(c.expires_at||0)>Date.now()+5*60*1000)return c.access_token;if(c?.refresh_token){const d=await meOauthToken({grant_type:'refresh_token',refresh_token:c.refresh_token});c=await saveMeToken({...d,refresh_token:d.refresh_token||c.refresh_token});return c.access_token;}if(ME_TOKEN)return ME_TOKEN;throw new Error('Conecte o Melhor Envio no painel administrativo');}
async function meHeaders(){return {Authorization:'Bearer '+await meAccessToken(),'Content-Type':'application/json',Accept:'application/json','User-Agent':'Allmare ecommerce contato@allmare.com.br'};}
async function meRequest(endpoint,options={}){const r=await fetch(ME_BASE+endpoint,{...options,headers:{...await meHeaders(),...(options.headers||{})}});const text=await r.text();let data={};try{data=text?JSON.parse(text):{};}catch{data={raw:text};}if(!r.ok)throw new Error(data.message||data.error||`Melhor Envio respondeu ${r.status}`);return data;}
async function meStatus(){const integration=await integrationGet();const c=integration?.credentials,base=String(process.env.PUBLIC_URL||'').replace(/\/$/,'');return {configured:Boolean(ME_CLIENT_ID&&ME_CLIENT_SECRET&&base),connected:Boolean(c?.access_token||ME_TOKEN),automaticRefresh:Boolean(c?.refresh_token),environment:process.env.MELHOR_ENVIO_SANDBOX==='false'?'produção':'sandbox',expiresAt:c?.expires_at?new Date(c.expires_at).toISOString():null,callbackUrl:base?base+'/api/integrations/melhor-envio/callback':''};}
function packageFor(qty=1){const q=Math.max(1,Number(qty)||1);return {id:'allmare-drop',width:25,height:Math.min(30,4+q*2),length:30,weight:Number((.25*q+.15).toFixed(2)),insurance_value:99.9,quantity:q};}
async function quoteShipping(cep,qty=1){
  if(!process.env.MELHOR_ENVIO_FROM_POSTAL_CODE)throw new Error('MELHOR_ENVIO_FROM_POSTAL_CODE não configurado no Render');
  const list=await meRequest('/api/v2/me/shipment/calculate',{method:'POST',body:JSON.stringify({from:{postal_code:cleanCep(process.env.MELHOR_ENVIO_FROM_POSTAL_CODE)},to:{postal_code:cep},products:[packageFor(qty)]})});
  return (Array.isArray(list)?list:[]).filter(x=>x.price&&!x.error).map(x=>({id:String(x.id),serviceId:Number(x.id),service:x.name||x.company?.name||'Transportadora',company:x.company?.name||'',companyPicture:x.company?.picture||'',price:Number(x.price)+SHIPPING_MARKUP,carrierPrice:Number(x.price),deliveryDays:Number(x.delivery_time||0),deliveryRange:x.delivery_range||{},free:false,source:'melhor_envio'})).sort((a,b)=>a.price-b.price);
}
async function validateShipping(customer,shipping,qty){const options=await quoteShipping(cleanCep(customer.cep),qty);const chosen=options.find(x=>String(x.serviceId)===String(shipping?.serviceId));if(!chosen)throw new Error('Opção de frete inválida ou indisponível. Calcule novamente.');return chosen;}

async function createPreference(order){if(!MP_TOKEN)throw new Error('Mercado Pago não configurado');const base=process.env.PUBLIC_URL?.replace(/\/$/,'');if(!base)throw new Error('PUBLIC_URL não configurada');const qty=(order.items||[]).reduce((n,x)=>n+Number(x.qty||0),0);const subtotal=Number(order.total)-Number(order.shipping?.price||0);const r=await fetch('https://api.mercadopago.com/checkout/preferences',{method:'POST',headers:{Authorization:'Bearer '+MP_TOKEN,'Content-Type':'application/json','X-Idempotency-Key':'preference-'+order.id},body:JSON.stringify({items:[{id:order.id,title:`Pedido Allmare · ${qty} peça${qty===1?'':'s'}`,description:(order.items||[]).map(x=>`${x.qty}x ${x.name} ${x.size}`).join(', ').slice(0,250),quantity:1,unit_price:subtotal,currency_id:'BRL'}],shipments:{cost:Number(order.shipping?.price||0)},payer:{name:order.customer.name,email:order.customer.email,identification:{type:'CPF',number:String(order.customer.cpf||'').replace(/\D/g,'')}},external_reference:order.id,metadata:{order_id:order.id},back_urls:{success:base+'/#account',pending:base+'/#account',failure:base+'/#checkout'},auto_return:'approved',notification_url:base+'/api/webhooks/mercadopago'})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Falha ao criar pagamento no Mercado Pago');return d.init_point;}
async function getPayment(id){const r=await fetch('https://api.mercadopago.com/v1/payments/'+encodeURIComponent(id),{headers:{Authorization:'Bearer '+MP_TOKEN}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Não foi possível consultar o pagamento');return d;}
function validMpSignature(req,url,dataId){if(!MP_WEBHOOK_SECRET)return true;const parts=Object.fromEntries(String(req.headers['x-signature']||'').split(',').map(x=>x.trim().split('=')));const requestId=String(req.headers['x-request-id']||'');if(!parts.ts||!parts.v1||!requestId||!dataId)return false;const manifest=`id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${parts.ts};`;const expected=crypto.createHmac('sha256',MP_WEBHOOK_SECRET).update(manifest).digest('hex');const a=Buffer.from(parts.v1),b=Buffer.from(expected);return a.length===b.length&&crypto.timingSafeEqual(a,b);}

function compact(o){return Object.fromEntries(Object.entries(o).filter(([,v])=>v!==''&&v!==null&&v!==undefined));}
function sender(){return compact({name:process.env.MELHOR_ENVIO_FROM_NAME||'Allmare',phone:process.env.MELHOR_ENVIO_FROM_PHONE||'',email:process.env.MELHOR_ENVIO_FROM_EMAIL||'',document:String(process.env.MELHOR_ENVIO_FROM_DOCUMENT||'').replace(/\D/g,''),company_document:String(process.env.MELHOR_ENVIO_FROM_COMPANY_DOCUMENT||'').replace(/\D/g,''),state_register:process.env.MELHOR_ENVIO_FROM_STATE_REGISTER||'',address:process.env.MELHOR_ENVIO_FROM_ADDRESS||'',complement:process.env.MELHOR_ENVIO_FROM_COMPLEMENT||'',number:process.env.MELHOR_ENVIO_FROM_NUMBER||'',district:process.env.MELHOR_ENVIO_FROM_DISTRICT||'',city:process.env.MELHOR_ENVIO_FROM_CITY||'',state_abbr:String(process.env.MELHOR_ENVIO_FROM_STATE||'').toUpperCase(),country_id:'BR',postal_code:cleanCep(process.env.MELHOR_ENVIO_FROM_POSTAL_CODE)});}
function recipient(c){return {name:c.name,phone:String(c.phone||'').replace(/\D/g,''),email:c.email,document:String(c.cpf||'').replace(/\D/g,''),address:c.street,complement:c.complement||'',number:c.number,district:c.district,city:c.city,state_abbr:String(c.state||'').toUpperCase(),country_id:'BR',postal_code:cleanCep(c.cep)};}
async function createLabel(order){
  if(order.shipment_id&&order.label_url)return order;
  try{
    const cart=await meRequest('/api/v2/me/cart',{method:'POST',body:JSON.stringify({service:Number(order.shipping.serviceId),from:sender(),to:recipient(order.customer),products:(order.items||[]).map((x,i)=>({name:x.name,quantity:Number(x.qty),unitary_value:Number(x.unit)})),volumes:[packageFor((order.items||[]).reduce((n,x)=>n+Number(x.qty||0),0))],options:{insurance_value:Number(order.total-order.shipping.price),receipt:false,own_hand:false,reverse:false,non_commercial:true,platform:'Allmare',tags:[{tag:order.id,url:process.env.PUBLIC_URL||''}]}})});
    const shipmentId=String(cart.id);
    await dbPatchOrder(order.id,{shipment_id:shipmentId,shipment_status:'cart',label_error:''});
    await meRequest('/api/v2/me/shipment/checkout',{method:'POST',body:JSON.stringify({orders:[shipmentId]})});
    await meRequest('/api/v2/me/shipment/generate',{method:'POST',body:JSON.stringify({orders:[shipmentId]})});
    const printed=await meRequest('/api/v2/me/shipment/print',{method:'POST',body:JSON.stringify({mode:'private',orders:[shipmentId]})});
    const details=await meRequest('/api/v2/me/orders/'+encodeURIComponent(shipmentId));
    const labelUrl=printed.url||printed.link||'';
    return await dbPatchOrder(order.id,{shipment_id:shipmentId,shipment_status:'generated',label_url:labelUrl,tracking_code:details.tracking||details.tracking_code||'',label_error:'',status:'preparing'});
  }catch(e){console.error('Etiqueta '+order.id+':',e.message);return await dbPatchOrder(order.id,{shipment_status:'error',label_error:e.message});}
}
async function processPayment(paymentId){const p=await getPayment(paymentId);const orderId=p.external_reference||p.metadata?.order_id;if(!orderId)return null;const order=(await dbListOrders()).find(x=>x.id===orderId);if(!order)return null;const amountOk=Math.abs(Number(p.transaction_amount)-Number(order.total))<0.02;if(p.status==='approved'&&!amountOk)throw new Error('Valor aprovado não corresponde ao pedido');const wasApproved=order.payment_status==='approved';const updated=await dbPatchOrder(order.id,{payment_status:p.status||'pending',provider_payment_id:String(p.id),status:p.status==='approved'?'paid':order.status});if(pool)await pool.query(`INSERT INTO allmare_payments(id,order_id,provider_payment_id,status,amount,payload,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,NOW(),NOW()) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,amount=EXCLUDED.amount,payload=EXCLUDED.payload,updated_at=NOW()`,['mp-'+p.id,order.id,String(p.id),p.status,Number(p.transaction_amount||0),JSON.stringify(p)]);if(p.status==='approved'){if(!wasApproved)await dbAddEvent({visitor_id:order.analytics?.visitorId||null,type:'payment_approved',path:'server:webhook',data:{orderId:order.id,name:order.customer?.name,email:order.customer?.email,phone:order.customer?.phone,total:order.total}});return createLabel(updated);}return updated;}

const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,admin:true,database:usingPostgres?'postgresql':'local-json'});
  if(req.method==='POST'&&url.pathname==='/api/admin/login'){if(!ADMIN_EMAIL||!ADMIN_PASSWORD)return json(res,503,{error:'ADMIN_EMAIL e ADMIN_PASSWORD precisam ser configurados no Render'});const b=await body(req);if(String(b.email||'').toLowerCase()!==ADMIN_EMAIL||String(b.password||'')!==ADMIN_PASSWORD)return json(res,401,{error:'E-mail ou senha inválidos'});return json(res,200,{token:token({role:'admin',email:ADMIN_EMAIL}),user:{name:'Administrador Allmare',email:ADMIN_EMAIL,role:'admin'}});}
  if(req.method==='POST'&&url.pathname==='/api/customer/login'){const b=await body(req);const c=await dbCustomerLogin(b);return json(res,200,{token:token({role:'customer',email:c.email,id:c.id}),user:c});}
  if(req.method==='GET'&&url.pathname==='/api/me'){const u=auth(req);return u?json(res,200,u):json(res,401,{error:'Sessão inválida'});}
  if(req.method==='POST'&&url.pathname==='/api/events'){const b=await body(req);await dbAddEvent({...b,data:{...(b.data||{}),referrer:b.data?.referrer||req.headers.referer||'',userAgent:String(req.headers['user-agent']||'').slice(0,300)}});return json(res,201,{ok:true});}
  if(req.method==='POST'&&url.pathname==='/api/wholesale'){const b=await body(req);await dbAddWholesale(b);return json(res,201,{ok:true});}
  if(req.method==='GET'&&url.pathname==='/api/shipping/quote'){const cep=cleanCep(url.searchParams.get('cep'));if(cep.length!==8)return json(res,400,{error:'CEP inválido'});return json(res,200,await quoteShipping(cep,url.searchParams.get('qty')));}
  if(req.method==='POST'&&url.pathname==='/api/orders'){const b=await body(req);if(!b.customer||!Array.isArray(b.items)||!b.items.length)return json(res,400,{error:'Pedido incompleto'});const qty=b.items.reduce((n,x)=>n+Math.max(1,Number(x.qty)||1),0);const shipping=await validateShipping(b.customer,b.shipping,qty);const subtotal=Math.floor(qty/3)*189+(qty%3)*99.9;const order=await dbCreateOrder({...b,shipping,subtotal,total:Number((subtotal+shipping.price).toFixed(2))});const checkoutUrl=await createPreference(order);return json(res,201,{order,checkoutUrl,demo:false});}
  if(req.method==='GET'&&url.pathname==='/api/orders/mine'){const u=auth(req);if(!u)return json(res,401,{error:'Faça login'});return json(res,200,await dbListOrders(u.email));}
  if(req.method==='GET'&&url.pathname==='/api/integrations/melhor-envio/callback'){const state=verify(url.searchParams.get('state')),code=url.searchParams.get('code'),base=String(process.env.PUBLIC_URL||'').replace(/\/$/,'');if(!state||state.role!=='me-oauth'||!code){res.writeHead(302,{Location:base+'/#admin'});return res.end();}try{const d=await meOauthToken({grant_type:'authorization_code',code,redirect_uri:meCallbackUrl()});await saveMeToken(d);res.writeHead(302,{Location:base+'/#admin'});return res.end();}catch(e){console.error('OAuth Melhor Envio:',e.message);res.writeHead(302,{Location:base+'/#admin'});return res.end();}}
  if(url.pathname.startsWith('/api/admin/')){
    const u=auth(req);if(!u||u.role!=='admin')return json(res,401,{error:'Acesso administrativo necessário'});
    if(req.method==='GET'&&url.pathname==='/api/admin/orders')return json(res,200,await dbListOrders());
    if(req.method==='GET'&&url.pathname==='/api/admin/wholesale')return json(res,200,await dbListWholesale());
    if(req.method==='GET'&&url.pathname==='/api/admin/events')return json(res,200,await dbListEvents());
    if(req.method==='GET'&&url.pathname==='/api/admin/stats')return json(res,200,await dbStats());
    if(req.method==='GET'&&url.pathname==='/api/admin/integrations/melhor-envio')return json(res,200,await meStatus());
    if(req.method==='POST'&&url.pathname==='/api/admin/integrations/melhor-envio/connect'){if(!pool)return json(res,409,{error:'Configure a DATABASE_URL do PostgreSQL antes de conectar'});if(!ME_CLIENT_ID||!ME_CLIENT_SECRET)return json(res,409,{error:'Configure MELHOR_ENVIO_CLIENT_ID e MELHOR_ENVIO_CLIENT_SECRET no Render'});const params=new URLSearchParams({client_id:ME_CLIENT_ID,redirect_uri:meCallbackUrl(),response_type:'code',state:token({role:'me-oauth',nonce:crypto.randomUUID()}),scope:ME_SCOPES});return json(res,200,{authorizationUrl:ME_BASE+'/oauth/authorize?'+params.toString(),callbackUrl:meCallbackUrl()});}
    const labelMatch=url.pathname.match(/^\/api\/admin\/orders\/([^/]+)\/label$/);
    if(req.method==='POST'&&labelMatch){const id=decodeURIComponent(labelMatch[1]);const o=(await dbListOrders()).find(x=>x.id===id);if(!o)return json(res,404,{error:'Pedido não encontrado'});if(o.payment_status!=='approved')return json(res,409,{error:'A etiqueta só pode ser comprada após pagamento aprovado'});return json(res,200,{ok:true,order:await createLabel({...o,shipment_id:o.shipment_status==='error'?'':o.shipment_id})});}
    if(req.method==='GET'&&labelMatch){const id=decodeURIComponent(labelMatch[1]);const o=(await dbListOrders()).find(x=>x.id===id);if(!o||!o.label_url)return json(res,404,{error:'Etiqueta ainda não disponível'});const label=await fetch(o.label_url,{headers:await meHeaders()});if(!label.ok)return json(res,502,{error:'Não foi possível baixar a etiqueta'});const bytes=Buffer.from(await label.arrayBuffer());res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="etiqueta-${id}.pdf"`,'Content-Length':bytes.length,'Cache-Control':'no-store'});return res.end(bytes);}
    if(req.method==='PATCH'&&url.pathname.startsWith('/api/admin/orders/')){const id=decodeURIComponent(url.pathname.split('/').pop());const b=await body(req);const allowed={};for(const k of ['status','tracking_code'])if(b[k]!==undefined)allowed[k]=b[k];const o=await dbPatchOrder(id,allowed);if(!o)return json(res,404,{error:'Pedido não encontrado'});return json(res,200,{ok:true,order:o});}
  }
  if(req.method==='POST'&&url.pathname==='/api/webhooks/mercadopago'){const b=await body(req);const paymentId=String(b.data?.id||url.searchParams.get('data.id')||url.searchParams.get('id')||'');if(!paymentId)return json(res,200,{ok:true,ignored:true});if(!validMpSignature(req,url,paymentId))return json(res,401,{error:'Assinatura inválida'});setImmediate(()=>processPayment(paymentId).catch(e=>console.error('Webhook Mercado Pago:',e.message)));return json(res,200,{ok:true});}
  let rel=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);let file=path.normalize(path.join(PUBLIC,rel));if(!file.startsWith(PUBLIC))return json(res,403,{error:'Acesso negado'});if(serve(res,file))return;if(!path.extname(rel))return serve(res,path.join(PUBLIC,'index.html'));json(res,404,{error:'Arquivo não encontrado'});
 }catch(e){console.error(e);json(res,500,{error:'Erro interno do servidor'});}
});

try{
  await initDatabase();
  server.listen(PORT,()=>console.log(`Allmare V23.1 funcionando em http://localhost:${PORT} | banco: ${usingPostgres?'PostgreSQL':'JSON local (fallback)'}`));
}catch(e){
  console.error('Falha ao inicializar PostgreSQL:',e);
  process.exit(1);
}
