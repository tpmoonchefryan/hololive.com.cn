import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import PocketBase from 'pocketbase';
import {createServer} from 'vite';
import {pathToFileURL} from 'node:url';
// Caller owns the lifetime: invoke once, use both origins, and close in finally.
export async function startNativeBrowserSite({repositoryRoot, evidenceDirectory, pinnedBinaries, owner}) {
 if (!path.isAbsolute(repositoryRoot) || !path.isAbsolute(evidenceDirectory) || !owner?.task || !owner?.spawnGuard || !owner?.registry) throw new Error('Explicit QA/evidence/owner bindings required');
 if (!Array.isArray(pinnedBinaries) || pinnedBinaries.map(b=>b.version).join(',') !== '0.26.5,0.34.2') throw new Error('Both pinned PB versions required');
 for (const binding of pinnedBinaries) {
  if (!path.isAbsolute(binding.path) || !binding.sha256 || createHash('sha256').update(await fs.readFile(binding.path)).digest('hex') !== binding.sha256) throw new Error('PB binary binding mismatch');
 }
 process.env.TCRN_TASK_OWNER=owner.task; process.env.TCRN_SPAWN_GUARD=owner.spawnGuard; process.env.TCRN_SPAWN_REGISTRY=owner.registry;
 const {pocketbase,startOwned,unusedPort,waitFor,root:helperRoot}=await import(pathToFileURL(path.join(repositoryRoot,'tests/helpers/pocketbase.mjs')));
 if (await fs.realpath(helperRoot) !== await fs.realpath(repositoryRoot)) throw new Error('QA helper root binding mismatch');
 const root=repositoryRoot, dir=evidenceDirectory, circuits=[], cleanups=[];
 await fs.mkdir(dir,{recursive:true});
 const own = resource => { cleanups.push(()=>resource.close()); return resource; };
 const listen = async server => { await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});cleanups.push(()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())));return server; };
 let closePromise;
 const close=()=>closePromise ||= (async()=>{const failures=[];for(const cleanup of cleanups.reverse()){try{await cleanup()}catch(error){failures.push(error)}}if(failures.length)throw new AggregateError(failures,'Fixture cleanup failed')})();
 try { for (const binary of pinnedBinaries) {
 const appPort=await unusedPort();
const migrationNames=(await fs.readdir(path.join(root,'backend/pb_migrations'))).filter(n=>n.endsWith('.js'));
const database=own(await pocketbase(binary.path,migrationNames));
const pb=new PocketBase(database.url);pb.authStore.save(database.token);pb.autoCancellation(false);
const password='Acceptance-Local-2026!';
const admin=await pb.collection('users').create({email:'acceptance@example.invalid',password,passwordConfirm:password,verified:true,is_admin:true});
await pb.collection('users').create({email:'acceptance-service@example.invalid',password,passwordConfirm:password,is_admin:true,service_account:true});
const replacement=await pb.collection('users').create({email:'acceptance-replacement@example.invalid',password,passwordConfirm:password,verified:true,is_admin:true});
const settings=(await pb.collection('system_settings').getFullList())[0];
await pb.collection('system_settings').update(settings.id,{enable_local_login:true,admin_entrance_key_hash:createHash('sha256').update('acceptance').digest('hex')});
for(const record of await pb.collection('announcements').getFullList())await pb.collection('announcements').update(record.id,{is_active:false});
const banner=await pb.collection('announcements').create({content:{zh:'当前有效公告：这是全站整合验证使用的长公告，检查手机文字完整可读，详情链接与关闭按钮都可以操作。'.repeat(3),en:'Current valid announcement: this long local announcement checks wrapping, clear navigation and an operable details link. '.repeat(4),ja:'有効な現在のお知らせ。スマートフォンでも長い文章を読み、詳細リンクと閉じるボタンを操作できます。'.repeat(4)},is_active:true,type:'info',link:'/docs'});
const ids=[];
for(const category of ['公告','文档']) for(let index=1;index<=105;index++){
 const post=await pb.collection('posts').create({id:(category==='公告'?'post':'docs')+String(index).padStart(11,'0'),title:{zh:`${category}整合文章${index}`,en:`${category}IntegratedArticle${index}`,ja:`${category}統合記事${index}`},slug:`${category==='公告'?'post':'doc'}-integrated-${index}`,content:{zh:`<p>正文${index}</p>`,en:`<p>Body${index}</p>`,ja:`<p>本文${index}</p>`},summary:{zh:'隔离验收记录'},category,is_public:true,created:new Date(Date.UTC(2026,0,1,0,0,index)).toISOString()});ids.push(post.id);
}
const draft=await pb.collection('posts').create({title:{zh:'Private acceptance draft'},content:{zh:'<p>Private draft</p>'},is_public:false,category:'文档'});
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xoAAAAASUVORK5CYII=','base64');
for(let index=1;index<=201;index++){const form=new FormData();form.append('file',new Blob([image],{type:'image/png'}),`acceptance-image${index}.png`);await pb.collection('media').create(form);}
let panelText='Original server text';
let mode={fileRead:'ok',fileWrite:'ok',instance:'ok',cms:'ok',settingsRead:'ok',settingsWrite:'ok',postsRead:'ok'};
const nodes=[{uuid:'acceptance-node',available:true,remarks:'Local node',instances:[{instanceUuid:'acceptance-instance',status:3,config:{nickname:'Local test server'},info:{currentPlayers:0,maxPlayers:20}}]}];
const panel=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');let data={status:200,data:null};
 if(url.pathname==='/api/service/remote_services')data.data=nodes;
 else if(url.pathname==='/api/overview')data.data={remote:[],system:{}};
 else if(url.pathname.includes('/files/list'))data.data={items:[{name:'acceptance.txt',type:1,size:15}]};
 else if(url.pathname==='/api/files/'){let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}');if(body.text!==undefined){data.data='written';if(mode.fileWrite!=='ok'){res.statusCode=401;data={status:401,data:'Local write denied'};}else{panelText=body.text;}}else{data.data=panelText;if(mode.fileRead!=='ok'){res.statusCode=403;data={status:403,data:'Local read denied'};}}}
 else if(url.pathname.includes('/protected_instance/')){data.data='Local action succeeded';if(mode.instance!=='ok'){res.statusCode=403;data={status:403,data:'Local action denied'};}}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
});await listen(panel);
const cfg=(await pb.collection('mcsm_config').getFullList())[0];await pb.collection('mcsm_config').update(cfg.id,{enabled:true,panel_url:`http://127.0.0.1:${panel.address().port}`,api_key:'synthetic-acceptance-secret'});
const mcsmPort=await unusedPort();const mcsm=own(await startOwned(process.execPath,[path.join(root,'backend/scripts/mcsm_proxy.js')],{PB_URL:database.url,PB_EMAIL:'acceptance-service@example.invalid',PB_PASS:password,MCSM_PROXY_PORT:String(mcsmPort),MCSM_CONFIG_CACHE_TTL_MS:'1',MCSM_PROXY_LOG_LEVEL:'error'}));await waitFor(`http://127.0.0.1:${mcsmPort}/`,mcsm);
const mapServer=http.createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');
 if(req.url==='/tile'){res.setHeader('Content-Type','application/json');res.end('{"tile":"loaded"}');return;}
 res.setHeader('Content-Type','text/html');
 if(req.url==='/foreign'){res.end(`<button onclick="top.postMessage({type:'hololive:map-escape',version:1},'*')">Foreign exact close</button>`);return;}
 res.end(`<html><head></head><body><h1>Acceptance map</h1><button id="zoom">Zoom +</button><p id="zoomvalue">Zoom 1; center 0,0</p><p id="security">Checking isolation</p>
 <div id="viewport" style="width:300px;height:180px;overflow:hidden;touch-action:none;border:1px solid"><div id="layer" style="width:600px;height:600px;background:repeating-linear-gradient(0deg,#abd 0 1px,transparent 1px 30px),repeating-linear-gradient(90deg,#abd 0 1px,#edf 1px 30px)">Map tiles</div></div>
 <div id="negative"></div><button id="burst">Three queued old-source closes</button><output id="emissions">0 emitted; delivery unknown</output><iframe src="foreign" title="Foreign map source"></iframe>
 <script>let parentDOM=false,storage=false,token=false;try{parentDOM=!!parent.document.body}catch{};try{storage=!!localStorage}catch{};try{token=!!parent.localStorage.getItem('pocketbase_auth')}catch{};fetch('tile').then(r=>r.json()).then(r=>{document.getElementById('security').textContent=JSON.stringify({parentDOM,storage,token,tile:r.tile});parent.postMessage({kind:'acceptance-map',parentDOM,storage,token,tile:r.tile},'*')});
 let zoom=1,x=0,y=0,drag;const viewport=document.getElementById('viewport'),layer=document.getElementById('layer');function render(){layer.style.transform='translate('+x+'px,'+y+'px) scale('+zoom+')';document.getElementById('zoomvalue').textContent='Zoom '+zoom+'; center '+x+','+y}document.getElementById('zoom').onclick=()=>{zoom+=1;render()};viewport.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY};viewport.setPointerCapture(e.pointerId)};viewport.onpointermove=e=>{if(!drag)return;x+=e.clientX-drag.x;y+=e.clientY-drag.y;drag={x:e.clientX,y:e.clientY};render()};viewport.onpointerup=()=>{drag=null};viewport.onpointercancel=()=>{drag=null};viewport.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(1,Math.min(5,zoom+(e.deltaY<0?1:-1)));render()},{passive:false});
 const negatives=[null,'close',[],{type:1,version:1},{type:'hololive:map-escape',version:2},{type:'hololive:map-escape',version:1,extra:true},{kind:'unrelated'}];negatives.forEach((message,index)=>{const button=document.createElement('button');button.textContent='Malformed/unrelated '+index;button.onclick=()=>parent.postMessage(message,'*');document.getElementById('negative').append(button)});document.getElementById('burst').onclick=()=>{const emittingSource=window;for(let i=0;i<3;i++)emittingSource.parent.postMessage({type:'hololive:map-escape',version:1},'*');document.getElementById('emissions').textContent='3 emitted; delivery unknown'};
 </script></body></html>`);
});await listen(mapServer);
const mapRecord=await pb.collection('server_maps').create({name:'Acceptance map',url:`http://127.0.0.1:${mapServer.address().port}`,sort_order:1});
const mapPort=await unusedPort();const map=own(await startOwned(process.execPath,[path.join(root,'backend/scripts/map_proxy.js')],{PB_URL:database.url,MAP_PROXY_PORT:String(mapPort),MAP_PROXY_LOG_LEVEL:'error'}));await waitFor(`http://127.0.0.1:${mapPort}/`,map);
const upstream=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const request=JSON.parse(raw||'{}');const prompt=request.messages?.[0]?.content || request.input?.[0]?.content?.[0]?.text || '';
 // Synthetic translation only; the application still uses its real authenticated proxy.
 const targets=String(prompt).match(/目标语言: ([^\n]+)/)?.[1].split(',').map(lang=>lang.trim()).filter(lang=>['zh','en','ja'].includes(lang)) || [];
 const text=JSON.stringify(Object.fromEntries(targets.map(lang=>[lang,'Local synthetic translation '+lang])));
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.endsWith('/chat/completions')?{choices:[{message:{content:text}}]}:{output_text:text,output:[{type:'message',content:[{type:'output_text',text}]}]}));
});await listen(upstream);
const translation=(await pb.collection('translation_config').getFullList())[0];
await pb.collection('translation_config').update(translation.id,{enabled:true,engine:'ai',ai_provider:'right_code',right_code_base_url:`http://127.0.0.1:${upstream.address().port}`,right_code_api_key:'synthetic-local-translation-key',right_code_endpoint:'responses'});
const aiPort=await unusedPort();const ai=own(await startOwned(process.execPath,[path.join(root,'backend/scripts/ai_translate_proxy.js')],{PB_URL:database.url,AI_TRANSLATE_PROXY_PORT:String(aiPort),AI_TRANSLATE_ALLOWED_ORIGIN:`http://127.0.0.1:${appPort}`,AI_TRANSLATE_CONFIG_CACHE_TTL_MS:'1',AI_TRANSLATE_PROXY_LOG_LEVEL:'error'}));await waitFor(`http://127.0.0.1:${aiPort}/`,ai);
const armed=new Map(),held=new Map(),events=[];let sequence=0;
const redact=value=>{if(Array.isArray(value))return value.map(redact);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/token|authorization|password|secret|api_key/i.test(key)?'[redacted]':redact(item)]));return value};
const snapshot=()=>({mode,armed:[...armed],requests:events});
const persist=()=>fs.writeFile(path.join(dir,`native-responses-${binary.version}.json`),JSON.stringify(snapshot(),null,2),{mode:0o600});
const controlPage=`<h1>Native fixture controls</h1><form action="/__acceptance-control"><label>Action <select name="action"><option>arm</option><option>release</option><option>revoke</option><option>restore</option></select></label><label>Key <input name="key" required></label><label>Route contains <input name="match" placeholder="/collections/posts/records"></label><label>User ID <input name="user"></label>${Object.keys(mode).map(name=>'<label>'+name+' <select name="'+name+'"><option value="">Keep</option><option>ok</option><option>error</option><option>empty</option><option>loading</option></select></label>').join('')}<button>Apply control</button></form><a href="/__acceptance-control">Read captured requests</a><button onclick="window.fixtureApp=window.open('/acceptance/webadmin/login','fixture-app')">Open app</button><button onclick="window.fixtureApp?.focus()">Request app focus</button><button onclick="window.focus()">Request controls focus</button><button onclick="window.fixtureApp?.close()">Close opened app</button><output id="focus">Focus transition unknown</output><script>for(const type of ['focus','blur'])window.addEventListener(type,()=>{document.getElementById('focus').textContent=type+' '+new Date().toISOString();fetch('/__acceptance-control?action=focus&event='+type)})</script>`;
const vite=own(await createServer({root,configFile:path.join(root,'vite.config.js'),define:{'import.meta.env.VITE_POCKETBASE_URL':JSON.stringify('/acceptance-pb'),'import.meta.env.VITE_ADMIN_KEY':JSON.stringify('acceptance')},server:{host:'127.0.0.1',port:appPort,strictPort:true,proxy:{'/ai-api':{target:`http://127.0.0.1:${aiPort}`,rewrite:p=>p.replace(/^\/ai-api/,'')},'/acceptance-pb':{target:database.url,rewrite:p=>p.replace(/^\/acceptance-pb/,'')},'/mcsm-api':{target:`http://127.0.0.1:${mcsmPort}`,rewrite:p=>p.replace(/^\/mcsm-api/,'')},'/map-proxy':{target:`http://127.0.0.1:${mapPort}`}}}}));
cleanups.push(()=>{for(const release of held.values())release();held.clear()});
vite.middlewares.stack.unshift({route:'',handle:async(req,res,next)=>{
 try {
 if(req.url?.startsWith('/acceptance-pb/api/collections/server_maps/records')&&req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({page:1,perPage:100,totalPages:1,totalItems:1,items:[{...mapRecord,url:`http://127.0.0.1:${appPort}/map-proxy/http/127.0.0.1:${mapServer.address().port}/`}]}));return;}
 if(req.url?.startsWith('/__acceptance-control')){
  const u=new URL(req.url,'http://local');if(u.pathname.endsWith('/ui')){res.setHeader('Content-Type','text/html');res.end(controlPage);return;}
  const key=u.searchParams.get('key'),action=u.searchParams.get('action');
  if(action==='arm'&&key&&u.searchParams.get('match'))armed.set(key,u.searchParams.get('match'));
  if(action==='release'&&held.has(key)){held.get(key)();held.delete(key)}
  if(action==='revoke'||action==='restore'){const id=u.searchParams.get('user');if(![admin.id,replacement.id].includes(id))throw new Error('Only owned synthetic users may change');await pb.collection('users').update(id,{is_admin:action==='restore'});}
  if(action==='focus')events.push({kind:'native-control-focus',event:u.searchParams.get('event'),at:new Date().toISOString()});
  for(const k of Object.keys(mode))if(u.searchParams.get(k))mode[k]=u.searchParams.get(k);
  await persist();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot()));return;
 }
 const route=req.url?.replace(/^\/acceptance-pb/,'');
 const holdEntry=[...armed].find(([,match])=>route?.includes(match));
 if(holdEntry&&req.url.startsWith('/acceptance-pb/')&&(req.method==='GET'||route.endsWith('/auth-refresh'))){
  const [key]=holdEntry;armed.delete(key);const id=++sequence;
  const safeURL=new URL(route,'http://local');for(const name of [...safeURL.searchParams.keys()])if(/token|authorization|password|secret|api_key/i.test(name))safeURL.searchParams.set(name,'[redacted]');
  const entry={id,key,method:req.method,route:safeURL.pathname+safeURL.search,query:safeURL.search,arrival:new Date().toISOString(),state:'capturing'};events.push(entry);
  res.on('close',()=>{if(!res.writableEnded){entry.state='aborted';void persist()}});
  const requestChunks=[];for await(const chunk of req)requestChunks.push(chunk);const requestBody=Buffer.concat(requestChunks);
  const response=await fetch(database.url+route,{method:req.method,headers:{...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},...(req.method!=='GET'&&requestBody.length?{body:requestBody}:{})});
  const body=Buffer.from(await response.arrayBuffer());entry.status=response.status;try{entry.body=redact(JSON.parse(body.toString()))}catch{entry.body='[non-JSON body]'};entry.headers=redact(Object.fromEntries([...response.headers].filter(([name])=>!['set-cookie','authorization'].includes(name))));entry.state=res.destroyed?'aborted':'held';await persist();
  if(!res.destroyed)await new Promise(resolve=>{held.set(key,resolve);res.once('close',()=>{held.delete(key);resolve()})});
  if(!res.destroyed){res.statusCode=response.status;for(const [name,value] of response.headers)if(!['transfer-encoding','connection','content-length','content-encoding','set-cookie'].includes(name))res.setHeader(name,value);res.end(body);entry.state='released'}
  entry.release=new Date().toISOString();await persist();return;
 }
 if(req.url?.startsWith('/acceptance-pb/api/collections/cms_sections/records') && mode.cms!=='ok'){res.setHeader('Content-Type','application/json');if(mode.cms==='error'){res.statusCode=503;res.end('{"message":"Local backend offline"}')}else if(mode.cms==='empty'){res.end('{"items":[],"page":1,"totalItems":0,"totalPages":0}')}else setTimeout(next,2000);return;}
 if(req.url?.startsWith('/acceptance-pb/api/collections/system_settings/records')){if(req.method==='PATCH'&&mode.settingsWrite==='error'){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end('{\"message\":\"Local save failure\"}');return;}if(req.method==='GET'&&mode.settingsRead!=='ok'){res.statusCode=mode.settingsRead==='error'?503:404;res.setHeader('Content-Type','application/json');res.end('{\"message\":\"Local settings unavailable\"}');return;}}
 if(req.url?.startsWith('/acceptance-pb/api/collections/posts/records')&&req.method==='GET'&&mode.postsRead==='error'){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end('{\"message\":\"Local list failure\"}');return;}
 next();
 } catch(error) { next(error); }
}});
await vite.listen();
const velocity=(await pb.collection('velocity_settings').getFullList())[0];
await pb.collection('velocity_settings').update(velocity.id,{last_sync_status:'error',proxy_status:'inactive'});
const runtime={directory:database.directory,servicePid:database.service.child.pid,url:`http://127.0.0.1:${appPort}`,pbUrl:database.url,adminId:admin.id,adminEmail:admin.email,replacementId:replacement.id,replacementEmail:replacement.email,password,recordIds:ids,draftId:draft.id,bannerId:banner.id,cmsIds:(await pb.collection('cms_sections').getFullList()).map(r=>r.id),mapOrigin:`http://127.0.0.1:${mapServer.address().port}`,mapPort,mcsmPort,settingsId:settings.id,velocityId:velocity.id,mcsmConfigId:cfg.id,superuserToken:database.token};circuits.push({...runtime,version:binary.version,controlUrl:runtime.url+'/__acceptance-control/ui',aiUpstreamUrl:`http://127.0.0.1:${upstream.address().port}`});
 } await fs.writeFile(path.join(dir,'site-runtime.json'),JSON.stringify({owner:owner.task,circuits},null,2),{mode:0o600});
 return {circuits,close};
 } catch(error) {try{await close()}catch(cleanupError){throw new AggregateError([error,cleanupError],'Fixture setup and cleanup failed')}throw error;}
}
