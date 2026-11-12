import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import worker,{makePng} from './worker.mjs';
const origin='https://nicochristie.com';
function fixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('./migrations/0001.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('./migrations/0002_starting_count.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('./migrations/0003_sheets.sql',import.meta.url),'utf8'));
 const DB={prepare(query){const stmt=sql.prepare(query);let args=[];return {bind(...values){args=values.map(x=>x instanceof ArrayBuffer?new Uint8Array(x):x);return this;},async first(){return stmt.get(...args)||null},async all(){return {results:stmt.all(...args)}},async run(){return stmt.run(...args)}}}};
 const env={DB,ALLOWED_ORIGINS:origin+',http://127.0.0.1:8765',IP_SECRET:'test-only-secret',TURNSTILE_SECRET:'test-secret',TURNSTILE_SITEKEY:'test-sitekey',POST_LIMIT:{limit:async()=>({success:true})},VISIT_LIMIT:{limit:async()=>({success:true})},SHEET_LIMIT:{limit:async()=>({success:true})},SHEET_AGENT:'agent_test',SHEET_ENVIRONMENT:'env_test',SHEET_CENTS:'25'};
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

// A stand-in for the Anthropic client: every session's stream yields `events`, and what is sent to it is kept.
function fakeClaude(events=[]){
 const claude={sent:[],made:[],beta:{sessions:{
  create:async args=>{claude.made.push(args);return {id:'sesn_'+claude.made.length};},
  events:{stream:async()=>(async function*(){yield* events;})(),send:async(_id,{events})=>{claude.sent.push(...events);}}}}};
 return claude;
}
const turn={picture:'iVBORw0KGgo=',left:0,right:800,top:0,bottom:600,strokes:[{color:'black',points:[[1,2],[3,4]]}],lines:[{text:'Nico Christie',x:16,y:24,width:200,height:37}]};
test('a new sheet needs the bot check, gets a capped session, and keeps the session id to itself',async t=>{
 mockTurnstile(t,{action:'sheet'});const {request,env,sql}=fixture();env.CLAUDE=fakeClaude();
 assert.equal((await request('/api/sheets',{})).status,403);assert.equal(env.CLAUDE.made.length,0);
 assert.equal((await request('/api/sheets',{token:'ok'},{origin:'https://evil.example'})).status,403);
 const response=await request('/api/sheets',{token:'ok'});assert.equal(response.status,201);const {sheet}=await response.json();
 assert.deepEqual(env.CLAUDE.made[0],{agent:'agent_test',environment_id:'env_test',budget:{type:'limit',max_list_cost:{amount:'25',currency:'USD'}}});
 assert.equal(sql.prepare('SELECT session FROM sheets WHERE id=?').get(sheet).session,'sesn_1');assert.notEqual(sheet,'sesn_1');
 assert.equal((await request('/api/sheets/sesn_1/turns',turn)).status,404);
 assert.equal((await request('/api/sheets/'+crypto.randomUUID()+'/turns',turn)).status,404);
});
test('the database caps the sheets one connection starts in a day',async t=>{
 mockTurnstile(t,{action:'sheet'});const {request,env}=fixture();env.CLAUDE=fakeClaude();
 for(let i=0;i<8;i++)assert.equal((await request('/api/sheets',{token:'ok'})).status,201);
 assert.equal((await request('/api/sheets',{token:'ok'})).status,429);assert.equal(env.CLAUDE.made.length,8);
});
test('a turn streams the agent\'s ink, drops malformed calls, and ends the turn once ink is on the sheet',async t=>{
 mockTurnstile(t,{action:'sheet'});const {request,env}=fixture();
 env.CLAUDE=fakeClaude([{type:'session.status_running'},{type:'span.model_request_start'},
  {type:'agent.message',content:[{type:'text',text:'never shown'}]},
  {type:'agent.custom_tool_use',id:'t1',name:'draw',input:{paths:['M 0 0 L 9 9'],color:'red',width:99}},
  {type:'agent.custom_tool_use',id:'t2',name:'draw',input:{paths:'<script>',color:'red'}},
  {type:'session.status_idle',stop_reason:{type:'requires_action'}},{type:'agent.custom_tool_use',id:'late',name:'erase',input:{boxes:[]}}]);
 const {sheet}=await (await request('/api/sheets',{token:'ok'})).json();
 const response=await request('/api/sheets/'+sheet+'/turns',{...turn,greeted:{color:'pink',x:40,y:400,width:60,height:60}});assert.equal(response.status,200);
 const lines=(await response.text()).trim().split('\n').map(l=>JSON.parse(l));
 assert.deepEqual(lines,[{doing:'thinking'},{doing:'drawing'},{draw:{paths:['M 0 0 L 9 9'],color:'red',width:30}},{doing:'drawing'},{done:true}]);
 const [message,first,second,interrupt]=env.CLAUDE.sent;
 assert.match(message.content[1].text,/a small happy face in pink, in the box from x = 40 to 100/);assert.match(message.content[1].text,/16,24 200x37: Nico Christie/);assert.match(message.content[1].text,/1\. black: 1,2 3,4/);
 assert.equal(first.is_error,false);assert.equal(second.is_error,true);assert.equal(interrupt.type,'user.interrupt');
});
test('a turn is refused when malformed, and a sheet takes a bounded number of turns',async t=>{
 mockTurnstile(t,{action:'sheet'});const {request,env,sql}=fixture();env.CLAUDE=fakeClaude([{type:'session.status_running'},{type:'session.status_idle',stop_reason:{type:'end_turn'}}]);
 const {sheet}=await (await request('/api/sheets',{token:'ok'})).json(),path='/api/sheets/'+sheet+'/turns';
 assert.equal((await request(path,{...turn,picture:'<svg>'})).status,400);
 assert.equal((await request(path,{...turn,strokes:[{color:'ultraviolet',points:[[1,2]]}]})).status,400);
 assert.equal((await request(path,{...turn,lines:[{text:'x'.repeat(401),x:0,y:0,width:1,height:1}]})).status,400);
 assert.equal((await request(path,turn)).status,200);assert.equal(sql.prepare('SELECT turns FROM sheets WHERE id=?').get(sheet).turns,1);
 sql.prepare('UPDATE sheets SET turns=40 WHERE id=?').run(sheet);assert.equal((await request(path,turn)).status,429);
 assert.equal((await request('/api/sheets/'+sheet+'/stop',{})).status,200);assert.equal(env.CLAUDE.sent.at(-1).type,'user.interrupt');
});
