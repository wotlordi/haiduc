(function(){
const $=id=>document.getElementById(id);
const CFG=window.VAULT_CONFIG||{};
const S={notes:new Map(),tasks:new Map(),cur:null,view:'notes',mode:'read',q:'',me:null,dirty:false,live:false};
let sb=null, saveTimer=null, pendingSave=null, channel=null;
const STATUS=[['todo','To do'],['doing','In progress'],['done','Done']];

function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function toast(msg){const t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>t.hidden=true,2400)}
function ago(ts){if(!ts)return'';const d=(Date.now()-ts)/1000;if(d<60)return'just now';if(d<3600)return Math.floor(d/60)+' min ago';if(d<86400)return Math.floor(d/3600)+' h ago';return new Date(ts).toLocaleDateString(undefined,{day:'numeric',month:'short'})}
function who(email){if(!email)return'';if(S.me&&email.toLowerCase()===S.me.toLowerCase())return'you';return email.split('@')[0]}

/* ---------- row mapping ---------- */
const ms=v=>v?new Date(v).getTime():0;
function fromNote(r){return{id:r.id,title:r.title,body:r.body||'',createdAt:ms(r.created_at),updatedAt:ms(r.updated_at),updatedBy:r.updated_by}}
function fromTask(r){return{id:r.id,title:r.title,status:r.status||'todo',due:r.due||'',noteId:r.note_id||'',assignee:r.assignee||'',createdAt:ms(r.created_at),createdBy:r.created_by}}
function toTask(t){return{id:t.id,title:t.title,status:t.status,due:t.due||null,note_id:t.noteId||null,assignee:t.assignee||null,created_at:new Date(t.createdAt||Date.now()).toISOString(),created_by:t.createdBy||null}}

/* ---------- lookups ---------- */
function sortedNotes(){return [...S.notes.values()].sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))}
function byTitle(t){t=String(t).trim().toLowerCase();for(const n of S.notes.values())if((n.title||'').trim().toLowerCase()===t)return n;return null}
function linksIn(body){const out=[];const re=/\[\[([^\[\]|]+)(?:\|[^\[\]]*)?\]\]/g;let m;while((m=re.exec(body||'')))out.push(m[1].trim());return out}
function backlinks(note){const t=(note.title||'').trim().toLowerCase();if(!t)return[];return sortedNotes().filter(n=>n.id!==note.id&&linksIn(n.body).some(l=>l.toLowerCase()===t))}
function newId(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,6)}

/* ---------- writes ---------- */
async function run(q,kind){
  const {error}=await q;
  if(error){console.error(error);toast(error.code==='42501'?'You don\'t have access to edit Haiduc.':'Could not save '+kind+'. Check your connection.');return false}
  return true;
}
function scheduleSave(){S.dirty=true;$('status').textContent='editing…';clearTimeout(saveTimer);saveTimer=setTimeout(flushSave,700)}
async function flushSave(){
  clearTimeout(saveTimer);const n=S.notes.get(S.cur);if(!n||!S.dirty)return;
  if(pendingSave)await pendingSave;
  S.dirty=false;n.updatedAt=Date.now();n.updatedBy=S.me;
  pendingSave=run(sb.from('notes').upsert({id:n.id,title:n.title||'Untitled',body:n.body||'',updated_at:new Date(n.updatedAt).toISOString(),updated_by:S.me}),'note');
  await pendingSave;pendingSave=null;setStatus();renderList();
}
function setStatus(){const s=$('status');s.textContent=S.live?'synced':'connecting…';s.className='status'}
async function createNote(title){
  let t=(title||'Untitled').trim()||'Untitled';
  if(!title){let i=1;while(byTitle(t))t='Untitled '+(++i)}
  const id=newId('n');const now=Date.now();
  S.notes.set(id,{id,title:t,body:'',createdAt:now,updatedAt:now,updatedBy:S.me});open(id,'edit');
  await run(sb.from('notes').insert({id,title:t,body:'',updated_by:S.me}),'note');
  setTimeout(()=>{const ti=$('titleIn');if(ti&&!title){ti.focus();ti.select()}},30);
}
async function saveTask(t){S.tasks.set(t.id,t);renderBoard();renderCounts();renderLinks();await run(sb.from('tasks').upsert(toTask(t)),'task')}

/* ---------- rendering ---------- */
function renderAll(){renderList();renderMain();renderLinks();renderCounts();setStatus()}
function renderCounts(){$('cNotes').textContent=S.notes.size;$('cTasks').textContent=[...S.tasks.values()].filter(t=>t.status!=='done').length}
function renderList(){
  const ul=$('list');const q=S.q.trim().toLowerCase();
  let notes=sortedNotes();if(q)notes=notes.filter(n=>(n.title||'').toLowerCase().includes(q)||(n.body||'').toLowerCase().includes(q));
  $('listLabel').textContent=q?`${notes.length} match${notes.length===1?'':'es'}`:'All notes';
  if(!notes.length){ul.innerHTML=`<li class="empty">${q?'No notes match that search.':(S.live?'No notes yet. Press + Note to start.':'Loading notes…')}</li>`;return}
  ul.innerHTML=notes.map(n=>{
    const m=ago(n.updatedAt)+(n.updatedBy&&who(n.updatedBy)!=='you'?' · '+who(n.updatedBy):'');
    return `<li><button data-id="${esc(n.id)}" aria-current="${S.view==='notes'&&n.id===S.cur}"><span class="t">${esc(n.title||'Untitled')}</span><span class="m">${esc(m)}</span></button></li>`}).join('');
}
function renderMarkdown(src){
  const withLinks=(src||'').replace(/\[\[([^\[\]|]+)(?:\|([^\[\]]*))?\]\]/g,(m,t,alias)=>{
    t=t.trim();const ex=byTitle(t);return `<a class="wl${ex?'':' missing'}" data-note="${esc(t)}">${esc((alias||t).trim())}</a>`});
  const html=marked.parse(withLinks,{gfm:true,breaks:true});
  return DOMPurify.sanitize(html,{ADD_ATTR:['data-note']}).replace(/==([^=\n]+)==/g,'<mark>$1</mark>');
}
function renderMain(){
  $('app').classList.toggle('tasks-mode',S.view==='tasks');
  $('navNotes').setAttribute('aria-pressed',S.view==='notes');$('navTasks').setAttribute('aria-pressed',S.view==='tasks');
  $('noteView').hidden=S.view!=='notes';$('taskView').hidden=S.view!=='tasks';
  const n=S.notes.get(S.cur);
  $('modeSeg').hidden=S.view!=='notes'||!n;$('delBtn').hidden=S.view!=='notes'||!n;$('linksBtn').hidden=S.view!=='notes'||!n;
  $('delBtn').classList.remove('arm');$('delBtn').textContent='Delete';
  if(S.view==='tasks'){$('crumbs').textContent='Tasks';renderBoard();return}
  $('mEdit').setAttribute('aria-pressed',S.mode==='edit');$('mRead').setAttribute('aria-pressed',S.mode==='read');
  const v=$('noteView');
  if(!n){
    $('crumbs').textContent='Haiduc';v.dataset.id='';
    if(!S.live){v.innerHTML='<div class="blank"><p>Loading Haiduc…</p></div>';return}
    v.innerHTML=`<div class="blank"><h2>${S.notes.size?'Pick a note':'No notes yet'}</h2><p>Notes are written in Markdown. Link notes together with <code>[[Note name]]</code>, and switch to Tasks to track work on a board.</p><button class="btn primary" id="blankNew">Create a note</button></div>`;
    $('blankNew').onclick=()=>createNote();return;
  }
  $('crumbs').textContent='Notes / '+(n.title||'Untitled');
  const meta=n.updatedAt?`Edited ${ago(n.updatedAt)}${n.updatedBy?' by '+esc(who(n.updatedBy)):''}`:'';
  if(S.mode==='edit'){
    if($('bodyIn')&&v.dataset.id===n.id){$('metaLine').innerHTML=meta;return}
    v.dataset.id=n.id;
    v.innerHTML=`<div class="note-inner"><input class="title-in" id="titleIn" aria-label="Note title" value="${esc(n.title)}"><div class="meta" id="metaLine">${meta}</div>
    <textarea class="body" id="bodyIn" aria-label="Note text" placeholder="Start writing…">${esc(n.body)}</textarea>
    <div class="hint"><code>[[Other note]]</code> link · <code># Heading</code> · <code>- [ ] to-do</code> · <code>**bold**</code> · <code>==highlight==</code></div></div>`;
    $('titleIn').oninput=e=>{n.title=e.target.value;$('crumbs').textContent='Notes / '+(n.title||'Untitled');scheduleSave()};
    $('bodyIn').oninput=e=>{n.body=e.target.value;autosize(e.target);scheduleSave()};
    autosize($('bodyIn'));
  }else{
    v.dataset.id='';
    v.innerHTML=`<div class="note-inner"><h1 class="title-in" style="margin:0">${esc(n.title||'Untitled')}</h1><div class="meta">${meta}</div><div class="prose" id="prose">${n.body?renderMarkdown(n.body):'<p class="hint">This note is empty. Switch to Edit to write.</p>'}</div></div>`;
    v.querySelectorAll('#prose input[type=checkbox]').forEach((cb,i)=>{cb.disabled=false;cb.onchange=()=>toggleCheck(n,i)});
  }
}
function autosize(t){t.style.height='auto';t.style.height=Math.max(t.scrollHeight,window.innerHeight*.6)+'px'}
function toggleCheck(n,idx){let i=-1;n.body=n.body.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[( |x|X)\]/gm,(m,p,c)=>{i++;return i===idx?p+(c===' '?'[x]':'[ ]'):m});S.dirty=true;flushSave()}
function renderLinks(){
  const L=$('links');const n=S.notes.get(S.cur);
  if(!n||S.view!=='notes'){L.innerHTML='<div class="label">Links</div><div class="none">Open a note to see what links to it.</div>';return}
  const back=backlinks(n);const out=[...new Set(linksIn(n.body))];const tasks=[...S.tasks.values()].filter(t=>t.noteId===n.id);
  const t0=(n.title||'').trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const snippet=src=>{const m=(src||'').match(new RegExp('[^\\n]{0,40}\\[\\['+t0+'[^\\]]*\\]\\][^\\n]{0,40}','i'));return m?m[0]:''};
  L.innerHTML=`<div class="label">Backlinks · ${back.length}</div>${back.length?'<ul>'+back.map(b=>`<li><button data-open="${esc(b.id)}">${esc(b.title)}</button><div class="x">${esc(snippet(b.body))}</div></li>`).join('')+'</ul>':'<div class="none">No other note links here yet.</div>'}
  <div class="label">Outgoing · ${out.length}</div>${out.length?'<ul>'+out.map(t=>{const ex=byTitle(t);return `<li><button data-title="${esc(t)}" style="${ex?'':'color:var(--muted)'}">${esc(t)}${ex?'':' (new)'}</button></li>`}).join('')+'</ul>':'<div class="none">Type [[Note name]] to link.</div>'}
  <div class="label">Tasks · ${tasks.length}</div>${tasks.length?'<ul>'+tasks.map(t=>`<li><button class="tk" data-tasks="1">${t.status==='done'?'✓ ':''}${esc(t.title)}</button></li>`).join('')+'</ul>':'<div class="none">No tasks linked to this note.</div>'}`;
}
function renderBoard(){
  const sel=$('tNote');const cur=sel.value;
  sel.innerHTML='<option value="">No linked note</option>'+sortedNotes().map(n=>`<option value="${esc(n.id)}">${esc(n.title)}</option>`).join('');sel.value=cur;
  const today=new Date().toISOString().slice(0,10);
  const all=[...S.tasks.values()].sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||(a.createdAt||0)-(b.createdAt||0));
  $('board').innerHTML=STATUS.map(([s,label],idx)=>{
    const items=all.filter(t=>(t.status||'todo')===s);
    return `<section class="col" data-s="${s}"><h3>${label}<span>${items.length}</span></h3>${items.length?items.map(t=>{
      const note=t.noteId&&S.notes.get(t.noteId);const late=t.due&&t.due<today&&s!=='done';
      const mine=t.assignee&&S.me&&t.assignee.toLowerCase()===S.me.toLowerCase();
      return `<article class="card" draggable="true" data-id="${esc(t.id)}"><div class="tt">${esc(t.title)}</div>
      <div class="row">${t.due?`<span class="chip${late?' late':''}">${late?'overdue · ':''}${esc(new Date(t.due+'T00:00').toLocaleDateString(undefined,{day:'numeric',month:'short'}))}</span>`:''}${note?`<span class="chip note-link" data-open="${esc(note.id)}">${esc(note.title)}</span>`:''}${t.assignee?`<span class="chip" title="Assigned to ${esc(t.assignee)}">@${esc(who(t.assignee))}</span>`:''}</div>
      <div class="acts">${idx>0?`<button data-move="${STATUS[idx-1][0]}" aria-label="Move back">←</button>`:''}${idx<2?`<button data-move="${STATUS[idx+1][0]}" aria-label="Move forward">→</button>`:''}<button data-assign="1">${mine?'Unassign':'Take it'}</button><button data-del="1" aria-label="Delete task">✕</button></div></article>`}).join(''):'<div class="none">Nothing here.</div>'}</section>`}).join('');
}

/* ---------- events ---------- */
$('taskForm').addEventListener('submit',async e=>{
  e.preventDefault();const title=$('tTitle').value.trim();if(!title)return;
  const t={id:newId('t'),title,status:'todo',due:$('tDue').value||'',noteId:$('tNote').value||'',assignee:'',createdAt:Date.now(),createdBy:S.me};
  $('tTitle').value='';$('tDue').value='';await saveTask(t);toast('Task added');
});
$('board').addEventListener('click',async e=>{
  const o=e.target.closest('[data-open]');if(o){open(o.dataset.open,'read');return}
  const card=e.target.closest('.card');if(!card)return;const t=S.tasks.get(card.dataset.id);if(!t)return;
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.move)await saveTask({...t,status:b.dataset.move});
  else if(b.dataset.assign){const mine=t.assignee&&t.assignee.toLowerCase()===S.me.toLowerCase();await saveTask({...t,assignee:mine?'':S.me})}
  else if(b.dataset.del){
    if(b.dataset.arm){S.tasks.delete(t.id);renderBoard();renderCounts();await run(sb.from('tasks').delete().eq('id',t.id),'task')}
    else{b.dataset.arm='1';b.textContent='Delete?';b.style.color='var(--warn)';setTimeout(()=>{if(b.isConnected){delete b.dataset.arm;b.textContent='✕';b.style.color=''}},3000)}
  }
});
let dragId=null;
$('board').addEventListener('dragstart',e=>{const c=e.target.closest('.card');if(c){dragId=c.dataset.id;e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',dragId)}catch(_){}}});
$('board').addEventListener('dragover',e=>{const col=e.target.closest('.col');if(col&&dragId){e.preventDefault();document.querySelectorAll('.col.drop').forEach(c=>c!==col&&c.classList.remove('drop'));col.classList.add('drop')}});
$('board').addEventListener('drop',async e=>{const col=e.target.closest('.col');document.querySelectorAll('.col.drop').forEach(c=>c.classList.remove('drop'));if(col&&dragId){e.preventDefault();const t=S.tasks.get(dragId);dragId=null;if(t&&t.status!==col.dataset.s)await saveTask({...t,status:col.dataset.s})}});
$('board').addEventListener('dragend',()=>{dragId=null;document.querySelectorAll('.col.drop').forEach(c=>c.classList.remove('drop'))});

function open(id,mode){if(S.dirty)flushSave();S.cur=id;S.view='notes';if(mode)S.mode=mode;lsSet('vault.cur',id);$('app').classList.remove('drawer');renderAll();$('noteView').scrollTop=0}
$('list').addEventListener('click',e=>{const b=e.target.closest('button[data-id]');if(b)open(b.dataset.id,'read')});
$('links').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.open)open(b.dataset.open,'read');
  else if(b.dataset.title){const ex=byTitle(b.dataset.title);ex?open(ex.id,'read'):createNote(b.dataset.title)}
  else if(b.dataset.tasks){S.view='tasks';renderAll()}
});
$('noteView').addEventListener('click',e=>{const a=e.target.closest('a.wl');if(!a)return;e.preventDefault();const ex=byTitle(a.dataset.note);ex?open(ex.id,'read'):createNote(a.dataset.note)});
$('navNotes').onclick=()=>{if(S.dirty)flushSave();S.view='notes';renderAll()};
$('navTasks').onclick=()=>{if(S.dirty)flushSave();S.view='tasks';$('app').classList.remove('drawer');renderAll()};
$('mEdit').onclick=()=>{S.mode='edit';renderMain();setTimeout(()=>$('bodyIn')&&$('bodyIn').focus(),20)};
$('mRead').onclick=()=>{if(S.dirty)flushSave();S.mode='read';renderMain();renderLinks()};
$('newNote').onclick=()=>createNote();
$('q').oninput=e=>{S.q=e.target.value;renderList()};
$('menuBtn').onclick=()=>$('app').classList.toggle('drawer');
$('linksBtn').onclick=()=>$('app').classList.toggle('show-links');
document.addEventListener('click',e=>{const app=$('app');if(app.classList.contains('drawer')&&!e.target.closest('#side')&&!e.target.closest('#menuBtn'))app.classList.remove('drawer')});
$('delBtn').onclick=async()=>{
  const b=$('delBtn');const n=S.notes.get(S.cur);if(!n)return;
  if(!b.classList.contains('arm')){b.classList.add('arm');b.textContent='Confirm delete';setTimeout(()=>{b.classList.remove('arm');b.textContent='Delete'},3000);return}
  clearTimeout(saveTimer);S.dirty=false;S.notes.delete(n.id);S.cur=null;renderAll();await run(sb.from('notes').delete().eq('id',n.id),'note');toast('Note deleted');
};
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='e'&&S.view==='notes'&&S.cur){e.preventDefault();S.mode==='edit'?$('mRead').click():$('mEdit').click()}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();flushSave()}
});
window.addEventListener('beforeunload',e=>{if(S.dirty){flushSave();e.preventDefault()}});

/* ---------- live data ---------- */
function isTyping(id){return id===S.cur&&S.mode==='edit'&&(S.dirty||['bodyIn','titleIn'].includes(document.activeElement&&document.activeElement.id))}
function onChange(table,p){
  const isNotes=table==='notes';const map=isNotes?S.notes:S.tasks;
  if(p.eventType==='DELETE'){const id=p.old&&p.old.id;if(!id)return;map.delete(id);if(isNotes&&id===S.cur)S.cur=null}
  else{const d=isNotes?fromNote(p.new):fromTask(p.new);
    if(isNotes&&isTyping(d.id))return;
    map.set(d.id,d);if(isNotes&&d.id===S.cur)$('noteView').dataset.id=''}
  if(isNotes)renderAll();else{renderCounts();renderLinks();if(S.view==='tasks')renderBoard()}
}
async function loadAll(){
  const [n,t]=await Promise.all([sb.from('notes').select('*'),sb.from('tasks').select('*')]);
  if(n.error||t.error){toast('Could not load your notes. Reload the page.');return}
  S.notes=new Map(n.data.map(r=>[r.id,fromNote(r)]));S.tasks=new Map(t.data.map(r=>[r.id,fromTask(r)]));
  if(!S.cur||!S.notes.has(S.cur)){const last=lsGet('vault.cur');S.cur=last&&S.notes.has(last)?last:(S.notes.size?sortedNotes()[0].id:null)}
  S.live=true;renderAll();
}
function subscribe(){
  if(channel)sb.removeChannel(channel);
  channel=sb.channel('vault')
    .on('postgres_changes',{event:'*',schema:'public',table:'notes'},p=>onChange('notes',p))
    .on('postgres_changes',{event:'*',schema:'public',table:'tasks'},p=>onChange('tasks',p))
    .subscribe(st=>{if(st==='SUBSCRIBED'&&S.live)loadAll()});
}
// refresh after the tab was asleep (laptop lid, phone background)
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&S.live&&!S.dirty)loadAll()});

/* ---------- auth ---------- */
function showLogin(msg,isErr){
  $('app').hidden=true;$('login').hidden=false;
  const m=$('loginMsg');m.textContent=msg||'';m.className='msg'+(isErr?' err':'');m.hidden=!msg;
}
async function enter(session){
  S.me=session.user.email;
  const {data,error}=await sb.from('members').select('email').limit(1);
  if(error||!data||!data.length){await sb.auth.signOut();showLogin(`${S.me} isn't on the members list. Ask the owner to add you.`,true);return}
  $('login').hidden=true;$('app').hidden=false;$('meEmail').textContent=S.me;
  renderAll();await loadAll();subscribe();
}
function authMsg(err){
  const m=(err&&err.message)||'';
  if(/invalid login credentials/i.test(m))return 'Wrong email or password. First time here? Use "Create account".';
  if(/already registered/i.test(m))return 'This email already has an account. Sign in instead, or use "Email me a link" if you never set a password.';
  if(/email not confirmed/i.test(m))return 'This account still needs email confirmation. Ask the owner to turn off "Confirm email" in Supabase, or use the link we emailed.';
  if(/rate limit/i.test(m))return 'Too many emails were sent in the last hour. Try again later, or sign in with your password.';
  return m||'Something went wrong. Try again.';
}
function creds(){return{email:$('loginEmail').value.trim(),password:$('loginPass').value}}
function busy(b,on,label){b.disabled=on;if(label)b.textContent=label}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();const {email,password}=creds();if(!email||!password)return;
  const b=$('loginBtn');busy(b,true,'Signing in…');
  const {error}=await sb.auth.signInWithPassword({email,password});
  busy(b,false,'Sign in');if(error)showLogin(authMsg(error),true);
});
$('signupBtn').onclick=async()=>{
  const {email,password}=creds();
  if(!email||password.length<6){showLogin('Enter your email and a password of at least 6 characters, then press "Create account".',true);return}
  const b=$('signupBtn');busy(b,true);
  const {data,error}=await sb.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});
  busy(b,false);
  if(error){showLogin(authMsg(error),true);return}
  if(data&&data.user&&Array.isArray(data.user.identities)&&data.user.identities.length===0){showLogin(authMsg({message:'already registered'}),true);return}
  if(!data.session)showLogin(`Account created. Check ${email} for a confirmation email, then sign in here.`);
};
$('magicBtn').onclick=async()=>{
  const email=$('loginEmail').value.trim();if(!email){showLogin('Enter your email first.',true);return}
  const b=$('magicBtn');busy(b,true);
  const {error}=await sb.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname}});
  busy(b,false);
  if(error)showLogin(authMsg(error),true);else showLogin(`Check ${email} for a sign-in link. Click only the newest email. After signing in, use "Set password" at the bottom left.`);
};
$('setPass').onclick=async()=>{
  const b=$('setPass');
  if(!b.dataset.open){
    const box=document.createElement('form');box.id='passBox';box.className='pass-box';
    box.innerHTML='<input id="newPass" type="password" minlength="6" autocomplete="new-password" placeholder="New password (6+ characters)" required><button class="btn primary" type="submit">Save</button>';
    b.closest('.account').before(box);b.dataset.open='1';b.textContent='Cancel';$('newPass').focus();
    box.onsubmit=async ev=>{ev.preventDefault();const p=$('newPass').value;if(p.length<6)return;
      const {error}=await sb.auth.updateUser({password:p});
      if(error)toast(authMsg(error));else{toast('Password saved. Next time, sign in with email and password.');box.remove();delete b.dataset.open;b.textContent='Set password'}};
  }else{const box=$('passBox');box&&box.remove();delete b.dataset.open;b.textContent='Set password'}
};
$('signOut').onclick=async()=>{if(S.dirty)await flushSave();if(channel)sb.removeChannel(channel);await sb.auth.signOut();S.notes.clear();S.tasks.clear();S.live=false;showLogin()};

function boot(){
  if(!CFG.SUPABASE_URL||!CFG.SUPABASE_ANON_KEY||CFG.SUPABASE_ANON_KEY.includes('YOUR-ANON-KEY')){showLogin('Haiduc is not connected yet: add your Supabase URL and anon key to config.js.',true);$('loginForm').hidden=true;return}
  sb=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY);
  let entered=false;
  sb.auth.onAuthStateChange((ev,session)=>{
    if(session&&!entered){entered=true;setTimeout(()=>enter(session),0)}
    if(!session&&ev==='SIGNED_OUT'){entered=false}
  });
  const hp=new URLSearchParams((location.hash||'').slice(1)+'&'+(location.search||'').slice(1));
  const linkErr=hp.get('error_description')||hp.get('error');
  sb.auth.getSession().then(({data})=>{
    if(!data.session&&!entered){
      showLogin(linkErr?('That sign-in link didn\'t work ('+linkErr.replace(/\+/g,' ')+'). It was probably expired or already used. Sign in with your password, or request a new link.'):'',!!linkErr);
      if(linkErr)history.replaceState(null,'',location.pathname);
    }
  });
}
boot();
})();
