import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import worker,{makePng} from './worker.mjs';
const origin='https://nicochristie.com';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('./migrations/0001.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('./migrations/0002_starting_count.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('./migrations/0003_sheets.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('./migrations/0004_sheet_cap.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('./migrations/0005_draw.sql',import.meta.url),'utf8'));
 const DB={prepare(query){const stmt=sql.prepare(query);let args=[];return {bind(...values){args=values.map(x=>x instanceof ArrayBuffer?new Uint8Array(x):x);return this;},async first(){return stmt.get(...args)||null},async all(){return {results:stmt.all(...args)}},async run(){return stmt.run(...args)}}}};
 const env={DB,ALLOWED_ORIGINS:origin+',http://127.0.0.1:8765',IP_SECRET:'test-only-secret',TURNSTILE_SECRET:'test-secret',TURNSTILE_SITEKEY:'test-sitekey',POST_LIMIT:{limit:async()=>({success:true})},VISIT_LIMIT:{limit:async()=>({success:true})},DRAW_LIMIT:{limit:async()=>({success:true})},DRAW_PAGE_CENTS:'50',DRAW_IP_CENTS:'150',DRAW_DAY_CENTS:'2000'};
 const request=(path,data,extra={})=>worker.fetch(new Request('https://api.example'+path,{method:data?'POST':'GET',headers:{origin,'content-type':'application/json','cf-connecting-ip':'192.0.2.1',...extra},body:data?JSON.stringify(data):undefined}),env);
 return {sql,env,request};
}
const rgb=new Uint8Array(800*560*3).fill(255);rgb.fill(0,0,1200);const pixels=Buffer.from(rgb).toString('base64');
function mockTurnstile(t,overrides={}){t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,hostname:'nicochristie.com',action:'post',...overrides}));}
test('server creates a valid bounded PNG solely from RGB pixels',async()=>{
 const png=await makePng(pixels);assert.deepEqual([...png.slice(0,8)],[137,80,78,71,13,10,26,10]);assert(png.length<256000);
 const view=new DataView(png.buffer);assert.equal(view.getUint32(16),800);assert.equal(view.getUint32(20),560);
 const length=view.getUint32(33);const raw=inflateSync(png.slice(41,41+length));assert.equal(raw.length,800*560*3+560);assert.equal(raw[1],0);assert.equal(raw.at(-1),255);
 await assert.rejects(()=>makePng('data:image/svg+xml,<script>'),/Invalid/);
 await assert.rejects(()=>makePng(Buffer.alloc(rgb.length,255).toString('base64')),/Paint something/);
});
test('write requires exact origin and bot verification, and rejects oversized body',async()=>{
 const {request}=fixture();const data={request_id:crypto.randomUUID(),pixels,token:''};
 assert.equal((await request('/api/wall',data,{origin:'https://evil.example'})).status,403);
 assert.equal((await request('/api/wall',data)).status,403);
 assert.equal((await request('/api/wall',data,{'content-length':'9000000'})).status,413);
});
test('posting, retry deduplication, image serving, and untrusted text stay safe',async t=>{
 mockTurnstile(t);const {request,sql}=fixture();const data={request_id:crypto.randomUUID(),pixels,token:'verified',title:'<script>alert(1)</script>',name:"Robert'); DROP TABLE wall_posts;--"};
 const response=await request('/api/wall',data);assert.equal(response.status,201);const {id}=await response.json();
 assert.equal((await request('/api/wall',data)).status,200);assert.equal(sql.prepare('SELECT COUNT(*) n FROM wall_posts').get().n,1);
 const listing=await (await request('/api/wall')).json();assert.equal(listing.posts[0].title,data.title);assert(!('ip_hash' in listing.posts[0]));assert.equal(listing.posts[0].image,'https://api.example/api/wall/image/'+id);
 const image=await request('/api/wall/image/'+id);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('x-content-type-options'),'nosniff');assert.match(image.headers.get('content-security-policy'),/sandbox/);
 const bytes=sql.prepare('SELECT bytes FROM wall_storage').get().bytes;assert(bytes>0);sql.prepare('DELETE FROM wall_posts WHERE id=?').run(id);assert.equal(sql.prepare('SELECT bytes FROM wall_storage').get().bytes,0);
});
test('wrong Turnstile hostname/action rejected',async t=>{
 mockTurnstile(t,{hostname:'evil.example'});const {request}=fixture();assert.equal((await request('/api/wall',{request_id:crypto.randomUUID(),pixels,token:'bad'})).status,403);
});
test('visit count is atomic, refresh-safe and independent of previews',async t=>{
 mockTurnstile(t,{action:'visit'});const {request,sql}=fixture();const data={session:crypto.randomUUID(),token:'ok'};
 const responses=await Promise.all(Array.from({length:8},()=>request('/api/visits',data)));assert(responses.every(r=>r.ok));
 assert.equal(sql.prepare("SELECT count FROM totals WHERE scope='public'").get().count,724);assert.equal(sql.prepare("SELECT count FROM totals WHERE scope='preview'").get().count,723);
 assert.equal((await request('/api/visits',{session:data.session})).status,200);
});
test('database enforces daily limits even under concurrent attempts',async t=>{
 mockTurnstile(t);const {request,sql}=fixture();const first=await (await request('/api/wall',{request_id:crypto.randomUUID(),pixels,token:'ok'})).json();
 const row=sql.prepare('SELECT * FROM wall_posts WHERE id=?').get(first.id);
 const insert=sql.prepare('INSERT INTO wall_posts VALUES(?,?,?,?,?,?,?)');
 for(let i=1;i<50;i++)insert.run(crypto.randomUUID(),crypto.randomUUID(),'test','test',row.image,row.ip_hash,row.created_at);
 const attempts=await Promise.all(Array.from({length:3},()=>request('/api/wall',{request_id:crypto.randomUUID(),pixels,token:'ok'})));
 assert(attempts.every(r=>r.status===429));assert.equal(sql.prepare('SELECT COUNT(*) n FROM wall_posts').get().n,50);
});
test('edge limiter rejects requests before parsing or database writes',async()=>{
 const {env,request,sql}=fixture();env.POST_LIMIT.limit=async()=>({success:false});assert.equal((await request('/api/wall',{request_id:crypto.randomUUID()})).status,429);assert.equal(sql.prepare('SELECT COUNT(*) n FROM wall_posts').get().n,0);
});

// A stand-in for the Anthropic client: every call streams one reply that used `usage`, and what it was asked is kept.
function fakeClaude(usage={input_tokens:1000,output_tokens:100}){
 const reply={id:'msg_1',type:'message',role:'assistant',model:'m',content:[{type:'text',text:'ok'}],stop_reason:'end_turn',usage};
 const claude={asked:[],messages:{stream(args){claude.asked.push(args);return {abort(){},finalMessage:async()=>reply,withResponse:async()=>({}),toReadableStream:()=>new Response('{"type":"message_stop"}\n').body};}}};
 return claude;
}
const call={page:'2026-11-16T00-00-00-000Z-abcd',model:'Sonnet',messages:[{role:'user',content:[{type:'text',text:'draw a cat'}]}]};
const settled=()=>new Promise(r=>setTimeout(r,10));
test('a drawing\'s first request needs the bot check, and its later ones do not',async t=>{
 mockTurnstile(t,{action:'sheet'});const {request,env,sql}=fixture();env.CLAUDE=fakeClaude();
 const unchecked=await request('/api/draw/messages',call);assert.equal(unchecked.status,403);assert.equal(unchecked.headers.get('x-check'),'1');assert.equal(unchecked.headers.get('access-control-expose-headers'),'x-check');assert.equal(env.CLAUDE.asked.length,0);
 assert.equal((await request('/api/draw/messages',{...call,token:'ok'},{origin:'https://evil.example'})).status,403);
 const first=await request('/api/draw/messages',{...call,token:'ok'});assert.equal(first.status,200);assert.equal(await first.text(),'{"type":"message_stop"}\n');
 assert.equal((await request('/api/draw/messages',call)).status,200);
 const asked=env.CLAUDE.asked[0];assert.equal(asked.model,'claude-sonnet-5-5');assert.match(asked.system,/homepage of Nico Christie/);assert.match(asked.system,/declare function write|function write\(/);assert.equal(asked.tools[0].name,'run');assert.deepEqual(asked.messages,call.messages);
 await settled();assert.deepEqual(sql.prepare('SELECT micros FROM draw_calls').all().map(r=>r.micros),[3000,3000]);
});
test('a call is refused when malformed or for a model the page does not have',async t=>{
 mockTurnstile(t,{action:'sheet'});const {request,env}=fixture();env.CLAUDE=fakeClaude();
 assert.equal((await request('/api/draw/messages',{...call,token:'ok',model:'Luna'})).status,422);
 assert.equal((await request('/api/draw/messages',{...call,messages:[]})).status,422);
 assert.equal((await request('/api/draw/messages',{...call,mode:'oils'})).status,422);
 assert.equal((await request('/api/draw/messages',{...call,page:'../x'})).status,422);
 assert.equal((await request('/api/draw/record',call)).status,404);assert.equal(env.CLAUDE.asked.length,0);
});
test('a drawing, a connection and a day each spend only up to their cap',async t=>{
 mockTurnstile(t,{action:'sheet'});const {request,env,sql}=fixture();env.CLAUDE=fakeClaude();
 const now=Math.floor(Date.now()/1000),spend=(page,ip,micros)=>sql.prepare('INSERT INTO draw_calls VALUES(?,?,?,?,?)').run(crypto.randomUUID(),page,ip,micros,now);
 assert.equal((await request('/api/draw/messages',{...call,token:'ok'})).status,200);await settled();
 spend(call.page,'elsewhere',500000);const full=await request('/api/draw/messages',call);assert.equal(full.status,402);assert.match(await full.text(),/Clear starts a new one/);
 const other={...call,page:'another-drawing',token:'ok'};assert.equal((await request('/api/draw/messages',other)).status,200);await settled();
 const mine=sql.prepare('SELECT ip_hash FROM draw_pages WHERE page=?').get(call.page).ip_hash;spend('a-third',mine,1500000);
 const tired=await request('/api/draw/messages',other);assert.equal(tired.status,402);assert.match(await tired.text(),/come back tomorrow/);
 sql.prepare('DELETE FROM draw_calls').run();spend('everyone','elsewhere',20000000);assert.equal((await request('/api/draw/messages',other)).status,402);
 assert.equal(env.CLAUDE.asked.length,2);
});
test('the database caps the drawings one connection starts in a day',async t=>{
 mockTurnstile(t,{action:'sheet'});const {request,env}=fixture();env.CLAUDE=fakeClaude();
 for(let i=0;i<30;i++)assert.equal((await request('/api/draw/messages',{...call,page:'drawing-'+i,token:'ok'})).status,200);
 const over=await request('/api/draw/messages',{...call,page:'drawing-30',token:'ok'});assert.equal(over.status,402);assert.match(await over.text(),/come back tomorrow/);
});
test('without OpenAI\'s key the brush\'s model is Sonnet',async t=>{
 mockTurnstile(t,{action:'sheet'});const {request,env}=fixture();env.CLAUDE=fakeClaude();
 assert.equal((await request('/api/draw/messages',{...call,token:'ok',model:'Sol',mode:'brush'})).status,200);
 assert.equal(env.CLAUDE.asked[0].model,'claude-sonnet-5-5');assert.match(env.CLAUDE.asked[0].system,/Paint with brush/);
});
test('DRAW_MODEL and DRAW_EFFORT take every call, for trying a model',async t=>{
 mockTurnstile(t,{action:'sheet'});const {request,env}=fixture();env.CLAUDE=fakeClaude();env.DRAW_MODEL='Opus';env.DRAW_EFFORT='low';
 assert.equal((await request('/api/draw/messages',{...call,token:'ok',model:'Sol',mode:'brush'})).status,200);
 assert.equal(env.CLAUDE.asked[0].model,'claude-opus-5-5');assert.deepEqual(env.CLAUDE.asked[0].output_config,{effort:'low'});
});
test('the agent\'s code searches only where search is set up',async t=>{
 mockTurnstile(t,{action:'sheet'});const {request,env}=fixture();env.CLAUDE=fakeClaude();
 assert.equal((await request('/api/draw/search',{page:call.page,endpoint:'web',params:{q:'whale'}})).status,403);
 assert.equal((await request('/api/draw/search',{page:call.page,token:'ok',endpoint:'web',params:{q:'whale'}})).status,503);
});
