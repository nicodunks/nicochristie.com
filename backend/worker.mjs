import {sheets} from './sheet.mjs';
const WIDTH=800, HEIGHT=560, PIXELS=WIDTH*HEIGHT*3, MAX_BODY=PIXELS*4/3+8192;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder=new TextEncoder();
class Problem extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new Problem(status,message)};
const json=(data,status=200)=>Response.json(data,{status});
const allowed=env=>env.ALLOWED_ORIGINS.split(',');
const scopeFor=origin=>origin.startsWith('http://')?'preview':'public';
async function hash(secret,value){
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function body(request,max){
 if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'Expected JSON.');
 if(Number(request.headers.get('content-length'))>max)fail(413,'Drawing is too large.');
 const reader=request.body?.getReader();if(!reader)fail(400,'Missing request.');
 let size=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail(413,'Drawing is too large.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 try{const result=JSON.parse(new TextDecoder().decode(bytes));if(!result||Array.isArray(result)||typeof result!=='object')throw Error();return result;}catch{fail(400,'Invalid request.');}
}
async function verify(request,env,token,action){
 if(!env.TURNSTILE_SECRET||!env.IP_SECRET)fail(503,'Posting is temporarily unavailable.');
 if(typeof token!=='string'||!token||token.length>2048)fail(403,'Please complete the bot check.');
 const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET,response:token,remoteip:request.headers.get('cf-connecting-ip')}),signal:AbortSignal.timeout(10000)});
 const result=await response.json();
 if(!response.ok||!result.success||result.action!==action||result.hostname!==new URL(request.headers.get('origin')).hostname)fail(403,'Bot check expired. Please try again.');
}
// Accept only a fixed-size RGB raster. Never decode visitor-supplied image files.
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(name,data){
 const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);out.set(encoder.encode(name),4);out.set(data,8);
 let crc=0xffffffff;for(let i=4;i<out.length-4;i++)crc=crcTable[(crc^out[i])&255]^(crc>>>8);view.setUint32(out.length-4,(crc^0xffffffff)>>>0);return out;
}
export async function makePng(encoded){
 if(typeof encoded!=='string'||encoded.length!==PIXELS*4/3)fail(400,'Invalid drawing pixels.');
 let decoded;try{decoded=atob(encoded);}catch{fail(400,'Invalid drawing pixels.');}
 const raw=new Uint8Array(decoded.length);for(let i=0;i<raw.length;i++)raw[i]=decoded.charCodeAt(i);
 if(raw.length!==PIXELS)fail(400,'Invalid drawing size.');
 if(!raw.some(v=>v<250))fail(400,'Paint something first!');
 const scanlines=new Uint8Array(PIXELS+HEIGHT);
 for(let y=0;y<HEIGHT;y++)scanlines.set(raw.subarray(y*WIDTH*3,(y+1)*WIDTH*3),y*(WIDTH*3+1)+1);
 const compressed=new Uint8Array(await new Response(new Blob([scanlines]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
 if(compressed.length+57>256000)fail(413,'This drawing is too detailed to post. Try a simpler drawing.');
 const ihdr=new Uint8Array(13),view=new DataView(ihdr.buffer);view.setUint32(0,WIDTH);view.setUint32(4,HEIGHT);ihdr[8]=8;ihdr[9]=2;
 const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',compressed),chunk('IEND',new Uint8Array())];
 const png=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){png.set(p,offset);offset+=p.length;}return png;
}
function text(value,fallback,max){if(value===undefined||value==='')return fallback;if(typeof value!=='string'||value.length>max)fail(400,'Title or name is too long.');return value.trim()||fallback;}
async function route(request,env){
 const url=new URL(request.url),path=url.pathname,origin=request.headers.get('origin');
 if(origin&&!allowed(env).includes(origin))fail(403,'Origin not allowed.');
 if(request.method==='OPTIONS')return new Response(null,{status:204});
 if(path==='/api/config'&&request.method==='GET')return json({sitekey:env.TURNSTILE_SITEKEY,width:WIDTH,height:HEIGHT});
 if(path==='/api/visits'&&request.method==='GET')return json(await env.DB.prepare('SELECT count FROM totals WHERE scope=?').bind(scopeFor(origin||'https://nicochristie.com')).first());
 if(path==='/api/wall'&&request.method==='GET'){
  const {results}=await env.DB.prepare('SELECT id,title,name,created_at FROM wall_posts ORDER BY created_at DESC,id DESC LIMIT 50').all();
  return json({posts:results.map(p=>({...p,created_at:new Date(p.created_at*1000).toISOString(),image:`${url.origin}/api/wall/image/${p.id}`}))});
 }
 const image=path.match(/^\/api\/wall\/image\/([0-9a-f-]{36})$/);
 if(image&&request.method==='GET'){
  const row=await env.DB.prepare('SELECT image FROM wall_posts WHERE id=?').bind(image[1]).first();
  if(!row)fail(404,'Not found.');
  return new Response(new Uint8Array(row.image),{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=300','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 if(path.startsWith('/api/sheets'))return sheets(request,env,path,{fail,json,body,verify,hash});
 if(request.method!=='POST'||!['/api/visits','/api/wall'].includes(path))fail(404,'Not found.');
 if(!origin||!allowed(env).includes(origin))fail(403,'Origin required.');
 if(!env.IP_SECRET)fail(503,'Service not ready.');
 const ip=request.headers.get('cf-connecting-ip');if(!ip)fail(403,'Client address missing.');
 // Keyed hashes are stored, never raw IP addresses.
 const ipHash=await hash(env.IP_SECRET,ip);
 const limiter=path==='/api/wall'?env.POST_LIMIT:env.VISIT_LIMIT;
 if(!(await limiter.limit({key:ipHash})).success)fail(429,'Too many attempts. Try again in a minute.');
 const data=await body(request,path==='/api/wall'?MAX_BODY:4096),now=Math.floor(Date.now()/1000);
 if(path==='/api/visits'){
  if(!UUID.test(data.session||''))fail(400,'Invalid session.');
  const scope=scopeFor(origin),token=await hash(env.IP_SECRET,scope+':'+data.session);
  const exists=await env.DB.prepare('SELECT 1 FROM visits WHERE token=?').bind(token).first();
  if(!exists){await verify(request,env,data.token,'visit');await env.DB.prepare('INSERT OR IGNORE INTO visits(token,scope,ip_hash,created_at) VALUES(?,?,?,?)').bind(token,scope,ipHash,now).run();}
  return json(await env.DB.prepare('SELECT count FROM totals WHERE scope=?').bind(scope).first());
 }
 if(!UUID.test(data.request_id||''))fail(400,'Invalid post ID.');
 // Only a verified request may learn whether a retry already succeeded.
 await verify(request,env,data.token,'post');
 const existing=await env.DB.prepare('SELECT id FROM wall_posts WHERE request_id=?').bind(data.request_id).first();if(existing)return json(existing);
 const title=text(data.title,'Untitled masterpiece',80),name=text(data.name,'Anonymous',40);
 const png=await makePng(data.pixels),id=crypto.randomUUID();
 await env.DB.prepare('INSERT OR IGNORE INTO wall_posts(id,request_id,title,name,image,ip_hash,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,data.request_id,title,name,png.buffer,ipHash,now).run();
 return json(await env.DB.prepare('SELECT id FROM wall_posts WHERE request_id=?').bind(data.request_id).first(),201);
}
export default{
 async fetch(request,env){
  let response;try{response=await route(request,env);}catch(error){
   const message=String(error.message);
   if(/post_limit|visit_limit/.test(message))response=json({error:'Daily posting or hourly visit limit reached. Please try later.'},429);
   else if(/sheet_limit|sheet_busy/.test(message))response=json({error:'No more sheets today. Please try later.'},429);
   else if(/wall_busy|wall_full/.test(message))response=json({error:'The wall is full for now. Please try later.'},429);
   else response=json({error:error instanceof Problem?error.message:'Service unavailable. Please try again.'},error instanceof Problem?error.status:503);
  }
  const headers=new Headers(response.headers),origin=request.headers.get('origin');
  headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');headers.set('Vary','Origin');
  if(!headers.has('Cache-Control'))headers.set('Cache-Control','no-store');
  if(origin&&allowed(env).includes(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Allow-Methods','GET,POST,OPTIONS');headers.set('Access-Control-Allow-Headers','Content-Type');headers.set('Access-Control-Max-Age','600');}
  return new Response(response.body,{status:response.status,headers});
 },
 async scheduled(_event,env){
  const old=Math.floor(Date.now()/1000)-172800;
  await env.DB.prepare('DELETE FROM visits WHERE created_at<?').bind(old).run();
  await env.DB.prepare('DELETE FROM sheets WHERE created_at<?').bind(old).run();
 }
};
