import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import PocketBase from 'pocketbase';
import {pathToFileURL} from 'node:url';
// Caller owns the lifetime: invoke once, use both origins, and close in finally.
export async function startNativeBrowserSite({repositoryRoot, evidenceDirectory, pinnedBinaries, owner, signal, uploadFixture, onNormalStop}) {
 const envNames=['TCRN_TASK_OWNER','TCRN_SPAWN_GUARD','TCRN_SPAWN_REGISTRY','NODE_ENV','VITE_USER_NODE_ENV','BROWSER','BROWSER_ARGS'];
 const previousEnv=Object.fromEntries(envNames.map(name=>[name,{present:Object.hasOwn(process.env,name),value:process.env[name]}]));
 const root=repositoryRoot, dir=evidenceDirectory, circuits=[], cleanups=[], captureReceipts=[], resources=[], captureJobs=new Set(), cleanupFailures=[], captureErrors=[];
 let currentCircuit, captureDir;
 const check=()=>signal?.throwIfAborted();
 const ownCleanup=cleanup=>{const circuit=currentCircuit;cleanups.push(async()=>{try{await cleanup(circuit)}catch(error){if(circuit)circuit.liveFailures++;throw error}})};
 const own=resource=>{resources.push(resource);ownCleanup(circuit=>resource.close(resource.directory?{retainDirectory:(circuit?.liveFailures||0)>0}:undefined));check();return resource};
 const listen=async(server,port=0)=>{
  ownCleanup(()=>new Promise((resolve,reject)=>{
   server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve());
   server.closeAllConnections();
  }));
  check();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve()})});check();return server;
 };
 let closePromise;
 const close=()=>closePromise ||= (async()=>{
  const failures=cleanupFailures;
  for(const cleanup of [...cleanups].reverse()){try{await cleanup()}catch(error){failures.push(error)}}
  await Promise.allSettled([...captureJobs]);
  failures.push(...captureErrors);
  if(captureDir){try{if(!(await fs.readdir(captureDir)).length)await fs.rmdir(captureDir)}catch(error){failures.push(error)}}
  const captureDirectoryRetained=captureDir?await fs.stat(captureDir).then(()=>true,()=>false):false;
  for(const [name,binding] of Object.entries(previousEnv)){if(binding.present)process.env[name]=binding.value;else delete process.env[name]}
  const resourceOutcomes=await Promise.all(resources.map(async resource=>({pid:resource.child?.pid||resource.service?.child.pid||null,exitCode:resource.child?.exitCode??resource.service?.child.exitCode??null,signal:resource.child?.signalCode??resource.service?.child.signalCode??null,directory:resource.directory||null,directoryExists:resource.directory?await fs.stat(resource.directory).then(()=>true,()=>false):null})));
  const outcome={resourceOutcomes,captureDirectory:captureDir||null,captureDirectoryRetained,environmentRestored:envNames.every(name=>Object.hasOwn(process.env,name)===previousEnv[name].present&&process.env[name]===previousEnv[name].value),captureReceipts,failures:failures.map(error=>({name:error.name,message:error.message}))};
  if(failures.length){const error=new AggregateError(failures,'Fixture cleanup failed');error.fixtureCleanup=outcome;throw error}
  return outcome;
 })();
 try {
 check();
 if (!path.isAbsolute(repositoryRoot) || !path.isAbsolute(evidenceDirectory) || !owner?.task || !owner?.spawnGuard || !owner?.registry) throw new Error('Explicit QA/evidence/owner bindings required');
 if (!Array.isArray(pinnedBinaries) || pinnedBinaries.map(b=>b.version).join(',') !== '0.26.5,0.34.2') throw new Error('Both pinned PB versions required');
 for (const binding of pinnedBinaries) {
  check();const bytes=await fs.readFile(binding.path);check();
  if (!path.isAbsolute(binding.path) || !binding.sha256 || createHash('sha256').update(bytes).digest('hex') !== binding.sha256) throw new Error('PB binary binding mismatch');
 }
 if(!uploadFixture || !path.isAbsolute(uploadFixture.path))throw new Error('Owned non-executable upload fixture binding required');
 const jarBytes=await fs.readFile(uploadFixture.path);check();
 if(createHash('sha256').update(jarBytes).digest('hex')!==uploadFixture.sha256 || (await fs.stat(uploadFixture.path)).mode&0o111)throw new Error('Upload fixture byte/mode mismatch');
 check();
 process.env.TCRN_TASK_OWNER=owner.task; process.env.TCRN_SPAWN_GUARD=owner.spawnGuard; process.env.TCRN_SPAWN_REGISTRY=owner.registry;
 const {createServer}=await import('vite');check();
 const {pocketbase,startOwned,unusedPort,waitFor,root:helperRoot}=await import(pathToFileURL(path.join(repositoryRoot,'tests/helpers/pocketbase.mjs')));check();
 if (await fs.realpath(helperRoot) !== await fs.realpath(repositoryRoot)) throw new Error('QA helper root binding mismatch');
 check();await fs.mkdir(dir,{recursive:true,mode:0o700});check();if(((await fs.stat(dir)).mode&0o777)!==0o700)throw new Error('Private evidence directory mode0700 required');check();
 captureDir=await fs.mkdtemp(path.join(dir,'native-captures-'));check();await fs.chmod(captureDir,0o700);
 const capture=async(version,viewport,operation,value)=>{
  const bytes=Buffer.from(JSON.stringify(value,null,2));
  const filename=path.join(captureDir,`${operation}-pb${version}-${viewport}.json`);
  await fs.writeFile(filename,bytes,{flag:'wx',mode:0o600});
  const stat=await fs.stat(filename);
  const receipt={path:filename,operation,pb:version,viewport,bytes:stat.size,mode:stat.mode&0o777,sha256:createHash('sha256').update(bytes).digest('hex')};
  captureReceipts.push(receipt);return receipt;
 };
 for (const binary of pinnedBinaries) {
 currentCircuit={version:binary.version,liveFailures:0};
 const requestJobs=new Set();
 check();const appPort=await unusedPort();check();
const migrationNames=(await fs.readdir(path.join(root,'backend/pb_migrations'))).filter(n=>n.endsWith('.js'));
const database=own(await pocketbase(binary.path,migrationNames,{}, {signal}));
const pb=new PocketBase(database.url);const send=pb.send.bind(pb);pb.send=async(...args)=>{check();const result=await send(...args);check();return result};pb.authStore.save(database.token);pb.autoCancellation(false);
check();const password='Acceptance-Local-2026!';
const ordinary=await pb.collection('users').create({email:'acceptance-ordinary@example.invalid',password,passwordConfirm:password,verified:true,is_admin:false,service_account:false});check();
const admin=await pb.collection('users').create({email:'acceptance@example.invalid',password,passwordConfirm:password,verified:true,is_admin:true});
await pb.collection('users').create({email:'acceptance-service@example.invalid',password,passwordConfirm:password,is_admin:true,service_account:true});
const replacement=await pb.collection('users').create({email:'acceptance-replacement@example.invalid',password,passwordConfirm:password,verified:true,is_admin:true});
const settings=(await pb.collection('system_settings').getFullList())[0];
await pb.collection('system_settings').update(settings.id,{enable_local_login:true,admin_entrance_key_hash:createHash('sha256').update('acceptance').digest('hex')});
for(const record of await pb.collection('announcements').getFullList())await pb.collection('announcements').update(record.id,{is_active:false});
const announcementInputs={};
const now=Date.now();
for(const [name,start,end,active] of [['expired',now-120000,now-60000,true],['future',now+3600000,now+7200000,true],['inactive',now-60000,now+3600000,false],['overlap',now-60000,now+3600000,false],['short',now+30000,now+60000,false]]){
 check();const record=await pb.collection('announcements').create({content:{zh:'公告边界 '+name,en:'Announcement boundary '+name,ja:'公告境界 '+name},is_active:active,type:'info',start_time:new Date(start).toISOString(),end_time:new Date(end).toISOString(),link:'/docs'});announcementInputs[name]=record.id;
}
const banner=await pb.collection('announcements').create({content:{zh:'当前有效公告：这是全站整合验证使用的长公告，检查手机文字完整可读，详情链接与关闭按钮都可以操作。'.repeat(3),en:'Current valid announcement: this long local announcement checks wrapping, clear navigation and an operable details link. '.repeat(4),ja:'有効な現在のお知らせ。スマートフォンでも長い文章を読み、詳細リンクと閉じるボタンを操作できます。'.repeat(4)},is_active:true,type:'info',link:'/docs'});
const ids=[];
for(const category of ['公告','文档']) for(let index=1;index<=105;index++){check();
 const post=await pb.collection('posts').create({id:(category==='公告'?'post':'docs')+String(index).padStart(11,'0'),title:{zh:`${category}整合文章${index}`,en:`${category}IntegratedArticle${index}`,ja:`${category}統合記事${index}`},slug:`${category==='公告'?'post':'doc'}-integrated-${index}`,content:{zh:`<p>正文${index}</p>`,en:`<p>Body${index}</p>`,ja:`<p>本文${index}</p>`},summary:{zh:'隔离验收记录'},category,is_public:true,created:new Date(Date.UTC(2026,0,1,0,0,index)).toISOString()});ids.push(post.id);
}
const draft=await pb.collection('posts').create({title:{zh:'Private acceptance draft'},content:{zh:'<p>Private draft</p>'},is_public:false,category:'文档'});
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xoAAAAASUVORK5CYII=','base64');
for(let index=1;index<=201;index++){check();const form=new FormData();form.append('file',new Blob([image],{type:'image/png'}),`acceptance-image${index}.png`);await pb.collection('media').create(form);}
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
const mcsmPort=await unusedPort();const mcsm=own(await startOwned(process.execPath,[path.join(root,'backend/scripts/mcsm_proxy.js')],{PB_URL:database.url,PB_EMAIL:'acceptance-service@example.invalid',PB_PASS:password,MCSM_PROXY_PORT:String(mcsmPort),MCSM_CONFIG_CACHE_TTL_MS:'1',MCSM_PROXY_LOG_LEVEL:'error'}));await waitFor(`http://127.0.0.1:${mcsmPort}/`,mcsm,{signal});
const mapServer=http.createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');
 if(req.url==='/tile'){res.setHeader('Content-Type','application/json');res.end('{"tile":"loaded"}');return;}
 res.setHeader('Content-Type','text/html');
 if(req.url==='/foreign'){res.end(`<button onclick="top.postMessage({type:'hololive:map-escape',version:1},'*')">Foreign exact close</button>`);return;}
 res.end(`<html><head></head><body><h1>Acceptance map</h1><button id="zoom">Zoom +</button><p id="zoomvalue">Zoom 2; center 0,0</p><p id="security">Checking isolation</p>
 <div id="viewport" role="region" aria-label="Interactive map tiles" style="width:300px;height:180px;overflow:hidden;touch-action:none;border:1px solid"><div id="layer" style="width:600px;height:600px;background:repeating-linear-gradient(0deg,#abd 0 1px,transparent 1px 30px),repeating-linear-gradient(90deg,#abd 0 1px,#edf 1px 30px)">Map tiles</div></div>
 <div id="negative"></div><button id="burst">Three queued old-source closes</button><output id="emissions">0 emitted; delivery unknown</output><iframe src="foreign" title="Foreign map source"></iframe>
 <script>let parentDOM=false,storage=false,token=false;try{parentDOM=!!parent.document.body}catch{};try{storage=!!localStorage}catch{};try{token=!!parent.localStorage.getItem('pocketbase_auth')}catch{};fetch('tile').then(r=>r.json()).then(r=>{document.getElementById('security').textContent=JSON.stringify({parentDOM,storage,token,tile:r.tile});parent.postMessage({kind:'acceptance-map',parentDOM,storage,token,tile:r.tile},'*')});
 let zoom=2,x=0,y=0,drag;const viewport=document.getElementById('viewport'),layer=document.getElementById('layer');function render(){layer.style.transform='translate('+x+'px,'+y+'px) scale('+zoom+')';document.getElementById('zoomvalue').textContent='Zoom '+zoom+'; center '+x+','+y}document.getElementById('zoom').onclick=()=>{zoom+=1;render()};viewport.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY};viewport.setPointerCapture(e.pointerId)};viewport.onpointermove=e=>{if(!drag)return;x+=e.clientX-drag.x;y+=e.clientY-drag.y;drag={x:e.clientX,y:e.clientY};render()};viewport.onpointerup=()=>{drag=null};viewport.onpointercancel=()=>{drag=null};viewport.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(1,Math.min(5,zoom+(e.deltaY<0?1:-1)));render()},{passive:false});
 const negatives=[null,'close',[],{type:1,version:1},{type:'hololive:map-escape',version:2},{type:'hololive:map-escape',version:1,extra:true},{kind:'unrelated'}];negatives.forEach((message,index)=>{const button=document.createElement('button');button.textContent='Malformed/unrelated '+index;button.onclick=()=>parent.postMessage(message,'*');document.getElementById('negative').append(button)});document.getElementById('burst').onclick=()=>{const emittingSource=window;for(let i=0;i<3;i++)emittingSource.parent.postMessage({type:'hololive:map-escape',version:1},'*');document.getElementById('emissions').textContent='3 emitted; delivery unknown'};
 </script></body></html>`);
});await listen(mapServer);
const mapRecord=await pb.collection('server_maps').create({name:'Acceptance map',url:`http://127.0.0.1:${mapServer.address().port}`,sort_order:1});
const mapPort=await unusedPort();const map=own(await startOwned(process.execPath,[path.join(root,'backend/scripts/map_proxy.js')],{PB_URL:database.url,MAP_PROXY_PORT:String(mapPort),MAP_PROXY_LOG_LEVEL:'error'}));await waitFor(`http://127.0.0.1:${mapPort}/`,map,{signal});
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
const aiPort=await unusedPort();const ai=own(await startOwned(process.execPath,[path.join(root,'backend/scripts/ai_translate_proxy.js')],{PB_URL:database.url,AI_TRANSLATE_PROXY_PORT:String(aiPort),AI_TRANSLATE_ALLOWED_ORIGIN:`http://127.0.0.1:${appPort}`,AI_TRANSLATE_CONFIG_CACHE_TTL_MS:'1',AI_TRANSLATE_PROXY_LOG_LEVEL:'error'}));await waitFor(`http://127.0.0.1:${aiPort}/`,ai,{signal});
const delayed=new Set();cleanups.push(()=>{for(const timer of delayed)clearTimeout(timer);delayed.clear()});
const armed=new Map(),held=new Map(),events=[],socketEntries=new WeakMap();let sequence=0,captureSequence=0,viewport='unknown';
const redact=value=>{if(Array.isArray(value))return value.map(redact);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/token|authorization|password|secret|api_key/i.test(key)?'[redacted]':redact(item)]));return value};
const snapshot=()=>({mode,panelText,armed:[...armed],requests:events,announcementInputs,viewport,requestedViewport:viewport});
const persist=()=>{const job=capture(binary.version,viewport,`response-${String(++captureSequence).padStart(6,'0')}`,snapshot());captureJobs.add(job);job.then(()=>captureJobs.delete(job),error=>{captureJobs.delete(job);captureErrors.push(error)});return job};
const controlPage=`<h1>Native fixture controls</h1><form action="/__acceptance-control"><label>Action <select name="action"><option>arm</option><option>release</option><option>revoke</option><option>restore</option><option>local-login</option><option>announcement</option><option>viewport</option><option>velocity</option><option>normal-stop</option></select></label><label>Key <input name="key"></label><label>Exact route path <input name="match" placeholder="/api/collections/posts/records"></label><label>Method <select name="method"><option>GET</option><option>POST</option><option>PATCH</option></select></label><label>Record ID <input name="record"></label><label>Local login <select name="enabled"><option>true</option><option>false</option></select></label><label>Announcement scenario <select name="scenario"><option>current</option><option>expired</option><option>future</option><option>inactive</option><option>overlap</option><option>short</option></select></label><label>Viewport <select name="viewport"><option>1280x720</option><option>390x844</option></select></label><label>User ID <input name="user"></label>${Object.keys(mode).map(name=>'<label>'+name+' <select name="'+name+'"><option value="">Keep</option><option>ok</option><option>error</option><option>empty</option><option>loading</option></select></label>').join('')}<button>Apply control</button></form><a href="/__acceptance-control">Read captured requests</a><button onclick="window.fixtureApp=window.open('/acceptance/webadmin/login','fixture-app')">Open app</button><button onclick="window.fixtureApp?.focus()">Request app focus</button><button onclick="window.focus()">Request controls focus</button><button onclick="window.fixtureApp?.close()">Close opened app</button><output id="focus">Focus transition unknown</output><script>for(const type of ['focus','blur'])window.addEventListener(type,()=>{document.getElementById('focus').textContent=type+' '+new Date().toISOString();fetch('/__acceptance-control?action=focus&event='+type)})</script>`;
const captureFailures=[];
const appServer=http.createServer((req,res)=>vite.middlewares(req,res));
ownCleanup(async()=>{await new Promise((resolve,reject)=>{appServer.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve());appServer.closeAllConnections()});await Promise.allSettled([...requestJobs])});
const vite=own(await createServer({root,configFile:path.join(root,'vite.config.js'),define:{'import.meta.env.VITE_POCKETBASE_URL':JSON.stringify('/acceptance-pb'),'import.meta.env.VITE_ADMIN_KEY':JSON.stringify('acceptance')},server:{middlewareMode:true,hmr:{server:appServer},host:'127.0.0.1',port:appPort,strictPort:true,proxy:{'/ai-api':{target:`http://127.0.0.1:${aiPort}`,rewrite:p=>p.replace(/^\/ai-api/,'')},'/acceptance-pb':{target:database.url,rewrite:p=>p.replace(/^\/acceptance-pb/,'')},'/mcsm-api':{target:`http://127.0.0.1:${mcsmPort}`,rewrite:p=>p.replace(/^\/mcsm-api/,'')},'/map-proxy':{target:`http://127.0.0.1:${mapPort}`}}}}));
cleanups.push(()=>{for(const release of held.values())release();held.clear()});
vite.middlewares.stack.unshift({route:'',handle:(req,res,next)=>{
 const job=(async()=>{try {
 if(req.url?.startsWith('/acceptance-pb/api/collections/server_maps/records')&&req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({page:1,perPage:100,totalPages:1,totalItems:1,items:[{...mapRecord,url:`http://127.0.0.1:${appPort}/map-proxy/http/127.0.0.1:${mapServer.address().port}/`}]}));return;}
 if(req.url?.startsWith('/__acceptance-control')){
  const u=new URL(req.url,'http://local');if(u.pathname.endsWith('/ui')){res.setHeader('Content-Type','text/html');res.end(controlPage);return;}
  const key=u.searchParams.get('key'),action=u.searchParams.get('action');
  if(action==='viewport'){const value=u.searchParams.get('viewport');if(!['1280x720','390x844'].includes(value))throw new Error('Bound viewport required');viewport=value;}
  if(action==='arm'){
   const method=u.searchParams.get('method')||'GET',match=u.searchParams.get('match'),record=u.searchParams.get('record')||'';
   if(!key||armed.has(key)||held.has(key)||!['GET','POST','PATCH'].includes(method)||!match?.startsWith('/api/')||match.includes('?'))throw new Error('One unique exact method/path binding required');
   const allowed=['posts','cms_sections','system_settings','translation_config','velocity_settings','users','announcements'];
   const collection=match.match(/^\/api\/collections\/([^/]+)\//)?.[1];
   if(!allowed.includes(collection))throw new Error('Only owned fixture collections');
   if(record){await pb.collection(collection).getOne(record);if(!match.endsWith('/records/'+record))throw new Error('Record/path binding mismatch');}
   if(method==='PATCH'&&!record)throw new Error('PATCH requires owned record ID');
   armed.set(key,{method,path:match,record});
  }
  if(action==='local-login'){const enabled=u.searchParams.get('enabled');if(!['true','false'].includes(enabled))throw new Error('Explicit local-login boolean required');await pb.collection('system_settings').update(settings.id,{enable_local_login:enabled==='true'});}
  if(action==='announcement'){
   const scenario=u.searchParams.get('scenario');if(!['current',...Object.keys(announcementInputs)].includes(scenario))throw new Error('Owned announcement scenario required');
   for(const recordId of [banner.id,...Object.values(announcementInputs)])await pb.collection('announcements').update(recordId,{is_active:false});
   const recordId=scenario==='current'?banner.id:announcementInputs[scenario];
   const patch={is_active:scenario!=='inactive'};
   if(scenario==='short'){const time=Date.now();patch.start_time=new Date(time+10000).toISOString();patch.end_time=new Date(time+20000).toISOString();}
   if(scenario==='overlap'){await pb.collection('announcements').update(banner.id,{is_active:true});}
   await pb.collection('announcements').update(recordId,patch);
   events.push({kind:'announcement-control',at:new Date().toISOString(),scenario,actual:await pb.collection('announcements').getFullList()});
  }
  if(action==='velocity')await pb.collection('velocity_settings').update(velocity.id,{proxy_status:'inactive',last_sync_status:'error'});
  if(action==='release'&&held.has(key)){held.get(key)();held.delete(key)}
  if(action==='revoke'||action==='restore'){const id=u.searchParams.get('user');if(![admin.id,replacement.id].includes(id))throw new Error('Only owned synthetic users may change');await pb.collection('users').update(id,{is_admin:action==='restore'});}
  if(action==='focus')events.push({kind:'native-control-focus',event:u.searchParams.get('event'),at:new Date().toISOString()});
  for(const k of Object.keys(mode))if(u.searchParams.get(k))mode[k]=u.searchParams.get(k);
  await persist();res.setHeader('Content-Type','application/json');res.end(JSON.stringify(snapshot()));if(action==='normal-stop'){if(!onNormalStop)throw new Error('Normal stop caller binding required');onNormalStop();}return;
 }
 if(req.url?.startsWith('/acceptance-pb/api/collections/cms_sections/records') && mode.cms!=='ok'){res.setHeader('Content-Type','application/json');if(mode.cms==='error'){res.statusCode=503;res.end('{"message":"Local backend offline"}')}else if(mode.cms==='empty'){res.end('{"items":[],"page":1,"totalItems":0,"totalPages":0}')}else {const timer=setTimeout(()=>{delayed.delete(timer);if(!res.destroyed)next()},2000);delayed.add(timer);}return;}
 if(req.url?.startsWith('/acceptance-pb/api/collections/system_settings/records')){if(req.method==='PATCH'&&mode.settingsWrite==='error'){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end('{\"message\":\"Local save failure\"}');return;}if(req.method==='GET'&&mode.settingsRead!=='ok'){res.statusCode=mode.settingsRead==='error'?503:404;res.setHeader('Content-Type','application/json');res.end('{\"message\":\"Local settings unavailable\"}');return;}}
 if(req.url?.startsWith('/acceptance-pb/api/collections/posts/records')&&req.method==='GET'&&mode.postsRead==='error'){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end('{\"message\":\"Local list failure\"}');return;}
 const route=req.url?.replace(/^\/acceptance-pb/,'');
 const pathname=route?new URL(route,'http://local').pathname:null;
 const holdEntry=[...armed].find(([,match])=>pathname===match.path&&req.method===match.method);
 if(req.url?.startsWith('/acceptance-pb/api/collections/')){
  const [key,binding]=holdEntry||[null,{path:pathname,record:''}];if(key)armed.delete(key);const id=++sequence;
  const safeURL=new URL(route,'http://local');for(const name of [...safeURL.searchParams.keys()])if(/token|authorization|password|secret|api_key/i.test(name))safeURL.searchParams.set(name,'[redacted]');
  const entry={id,key,method:req.method,route:safeURL.pathname+safeURL.search,query:safeURL.search,arrival:new Date().toISOString(),state:'capturing'};events.push(entry);
  res.on('close',()=>{entry.clientClose=new Date().toISOString();entry.clientResponseEnded=res.writableEnded;if(!res.writableEnded)entry.state='aborted';void persist().catch(error=>{captureFailures.push(error)})});
  const socket=req.socket;
  if(!socketEntries.has(socket)){const entries=[];socketEntries.set(socket,entries);socket.once('close',()=>{const at=new Date().toISOString();for(const item of entries)item.socketClose=at;void persist().catch(error=>{captureFailures.push(error)})})}
  socketEntries.get(socket).push(entry);
  const requestChunks=[];for await(const chunk of req)requestChunks.push(chunk);const requestBody=Buffer.concat(requestChunks);
  entry.requestBytes=requestBody.length;entry.requestSHA256=createHash('sha256').update(requestBody).digest('hex');entry.contentType=req.headers['content-type']||null;
  try{entry.requestBody=redact(JSON.parse(requestBody.toString()))}catch{entry.requestBody='[binary/multipart body bound by hash]'}
  const response=await fetch(database.url+route,{method:req.method,headers:{...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},...(req.method!=='GET'&&requestBody.length?{body:requestBody}:{})});
  const body=Buffer.from(await response.arrayBuffer());entry.status=response.status;try{entry.body=redact(JSON.parse(body.toString()))}catch{entry.body='[non-JSON body]'};entry.headers=redact(Object.fromEntries([...response.headers].filter(([name])=>!['set-cookie','authorization'].includes(name))));entry.backendResponded=new Date().toISOString();
  const actualRecord=binding.record||entry.body?.id;
  if(['POST','PATCH'].includes(req.method)&&actualRecord){const collection=binding.path.match(/^\/api\/collections\/([^/]+)\//)?.[1];try{entry.backendPersistence=redact(await pb.collection(collection).getOne(actualRecord));entry.persistenceReadAt=new Date().toISOString()}catch(error){entry.persistenceError={status:error.status,message:error.message}}}
  entry.state=res.destroyed?'aborted':key?'held':'forwarding';await persist();
  if(key&&!res.destroyed)await new Promise(resolve=>{held.set(key,resolve);res.once('close',()=>{held.delete(key);resolve()})});
  if(!res.destroyed){res.statusCode=response.status;for(const [name,value] of response.headers)if(!['transfer-encoding','connection','content-length','content-encoding','set-cookie'].includes(name))res.setHeader(name,value);res.end(body);entry.state='released';entry.release=new Date().toISOString()}
  entry.settledAt=new Date().toISOString();await persist();return;
 }
 next();
 } catch(error) { next(error); }})();requestJobs.add(job);job.then(()=>requestJobs.delete(job),()=>requestJobs.delete(job));
}});
check();await new Promise((resolve,reject)=>{appServer.once('error',reject);appServer.listen(appPort,'127.0.0.1',()=>{appServer.removeListener('error',reject);resolve()})});check();
cleanups.push(async()=>{await persist();if(captureFailures.length)throw new AggregateError(captureFailures,'Capture failures')});
const velocity=(await pb.collection('velocity_settings').getFullList())[0];
const currentJar=new FormData();currentJar.append('velocity_jar',new Blob([jarBytes],{type:'application/java-archive'}),'owned-current-core-input.jar');currentJar.append('jar_version','owned-current-upload-input-v1');currentJar.append('last_sync_status','error');currentJar.append('proxy_status','inactive');await pb.collection('velocity_settings').update(velocity.id,currentJar);check();
const runtime={directory:database.directory,servicePid:database.service.child.pid,url:`http://127.0.0.1:${appPort}`,pbUrl:database.url,ordinaryId:ordinary.id,ordinaryEmail:ordinary.email,announcementInputs,uploadFixture,adminId:admin.id,adminEmail:admin.email,replacementId:replacement.id,replacementEmail:replacement.email,password,recordIds:ids,draftId:draft.id,bannerId:banner.id,cmsIds:(await pb.collection('cms_sections').getFullList()).map(r=>r.id),mapOrigin:`http://127.0.0.1:${mapServer.address().port}`,mapPort,mcsmPort,settingsId:settings.id,velocityId:velocity.id,mcsmConfigId:cfg.id,superuserToken:database.token};circuits.push({...runtime,version:binary.version,controlUrl:runtime.url+'/__acceptance-control/ui',aiUpstreamUrl:`http://127.0.0.1:${upstream.address().port}`});
 } check();const runtimeReceipt=await capture('both','unknown','site-runtime',{owner:owner.task,circuits});
 return {circuits,close,previousEnv,captureDir,captureReceipts,runtimeReceipt};
 } catch(error) {try{error.fixtureCleanup=await close();if(error.fixtureResource)error.fixtureCleanup.partialResource=error.fixtureResource}catch(cleanupError){const combined=new AggregateError([error,cleanupError],'Fixture setup and cleanup failed');combined.fixtureCleanup=cleanupError.fixtureCleanup;if(error.fixtureResource&&combined.fixtureCleanup)combined.fixtureCleanup.partialResource=error.fixtureResource;throw combined}throw error;}
}
