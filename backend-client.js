import {API_BASE} from './backend-config.js';
export const apiUrl=path=>API_BASE+path;
let configPromise,scriptPromise;
const config=()=>configPromise||(configPromise=fetch(apiUrl('/api/config')).then(r=>{if(!r.ok)throw Error('Could not connect. Please try again.');return r.json();}).catch(e=>{configPromise=null;throw e;}));
function turnstileScript(){
 if(window.turnstile)return Promise.resolve();
 return scriptPromise||(scriptPromise=new Promise((resolve,reject)=>{
  const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';s.async=true;
  s.onload=resolve;s.onerror=()=>{s.remove();scriptPromise=null;reject(Error('Could not load the bot check. Please try again.'));};document.head.append(s);
 }));
}
// With `quiet`, a visitor Turnstile would stop to question is not questioned: the check fails at once, and nothing shows.
export async function challenge(action,host,quiet=false){
 const [{sitekey}]=await Promise.all([config(),turnstileScript()]);
 return new Promise((resolve,reject)=>{
  const box=document.createElement('div');box.className='site-bot-check';(host||document.body).append(box);
  let widget,done=false;
  const timer=setTimeout(()=>finish(Error('Bot check timed out. Please try again.')),120000);
  function finish(error,token){if(done)return;done=true;clearTimeout(timer);if(widget!==undefined)window.turnstile.remove(widget);box.remove();error?reject(error):resolve(token);}
  try{widget=window.turnstile.render(box,{sitekey,action,appearance:'interaction-only',size:'flexible',callback:token=>finish(null,token),'error-callback':()=>finish(Error('Bot check failed. Please try again.')),'expired-callback':()=>finish(Error('Bot check expired. Please try again.')),...(quiet&&{'before-interactive-callback':()=>finish(Error('Bot check wants an answer.'))})});}catch(e){finish(e);}
 });
}
export function canvasPixels(canvas){
 const small=document.createElement('canvas');small.width=800;small.height=560;
 const ctx=small.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,800,560);ctx.drawImage(canvas,0,0,800,560);
 const rgba=ctx.getImageData(0,0,800,560).data,rgb=new Uint8Array(800*560*3);
 for(let i=0,j=0;i<rgba.length;i+=4){rgb[j++]=rgba[i];rgb[j++]=rgba[i+1];rgb[j++]=rgba[i+2];}
 const chunks=[];for(let i=0;i<rgb.length;i+=8192)chunks.push(String.fromCharCode(...rgb.subarray(i,i+8192)));
 return btoa(chunks.join(''));
}
export async function recordVisit(host){
 const initial=await fetch(apiUrl('/api/visits')).then(r=>{if(!r.ok)throw Error('Counter unavailable');return r.json();});
 if(!Number.isSafeInteger(initial.count)||initial.count<0)throw Error('Counter unavailable');
 host.textContent=String(initial.count||0).padStart(7,'0');
 host.title=location.protocol==='http:'?'Preview visits; separate from live site visits':'723 starting visits, plus verified browser sessions';
 let session;try{session=sessionStorage.getItem('nico-session');if(!session){session=crypto.randomUUID();sessionStorage.setItem('nico-session',session);}}catch{session=crypto.randomUUID();}
 const send=token=>fetch(apiUrl('/api/visits'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,token})});
 // A known session skips the challenge on refresh; a new one is verified first.
 let r=await send();if(r.status===403){const token=await challenge('visit',host.parentElement);r=await send(token);}
 if(!r.ok)throw Error('Could not record visit');const {count}=await r.json();host.textContent=String(count).padStart(7,'0');return count;
}
