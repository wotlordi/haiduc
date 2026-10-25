(function(){
const PEND_KEY_INIT='haiduc.pending.v1';
const $=id=>document.getElementById(id);
const CFG=window.VAULT_CONFIG||{};
const PH=window.matchMedia('(max-width:720px)');
const S={pend:(()=>{const p=lsJSON(PEND_KEY_INIT,null)||{};return{tasks:p.tasks||{},noteDel:p.noteDel||{}}})(),hist:null,tv:(()=>{try{return localStorage.getItem('haiduc.tv')==='gantt'?'gantt':'board'}catch(e){return 'board'}})(),editDates:null,unsaved:new Map(),phList:true,notes:new Map(),tasks:new Map(),cur:null,view:'notes',mode:'read',q:'',me:null,dirty:false,live:false};
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
function fromNote(r){return{id:r.id,title:r.title,body:r.body||'',folder:r.folder||'',createdAt:ms(r.created_at),updatedAt:ms(r.updated_at),updatedBy:r.updated_by}}
function fromTask(r){return{id:r.id,title:r.title,status:r.status||'todo',start:r.start_date||'',due:r.due||'',noteId:r.note_id||'',assignee:r.assignee||'',createdAt:ms(r.created_at),createdBy:r.created_by}}
function toTask(t){const r={id:t.id,title:t.title,status:t.status,start_date:t.start||null,due:t.due||null,note_id:t.noteId||null,assignee:t.assignee||null,created_at:new Date(t.createdAt||Date.now()).toISOString(),created_by:t.createdBy||null};if(S.noStartCol)delete r.start_date;return r}

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
/* Saving: every edit is copied to this device at once (draft), then sent to the server.
   A note only counts as saved after the server confirms it; failed saves are retried. */
const DRAFT='haiduc.draft.';
let saving=null,again=false,retryTimer=null,saveState='saved';
function draftPut(n){try{localStorage.setItem(DRAFT+n.id,JSON.stringify({title:n.title,body:n.body,folder:n.folder||'',at:Date.now(),createdAt:n.createdAt||Date.now()}))}catch(e){}}
function draftDel(id){try{localStorage.removeItem(DRAFT+id)}catch(e){}}
function draftsAll(){const out={};try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith(DRAFT)){try{out[k.slice(DRAFT.length)]=JSON.parse(localStorage.getItem(k))}catch(e){}}}}catch(e){}return out}
function markDirty(n){S.unsaved.set(n.id,(S.unsaved.get(n.id)||0)+1);draftPut(n);saveCache();setSaveState('dirty');clearTimeout(saveTimer);saveTimer=setTimeout(flushSave,1200)}
function scheduleSave(){const n=S.notes.get(S.cur);if(n)markDirty(n)}
async function flushSave(){
  clearTimeout(saveTimer);clearTimeout(retryTimer);
  if(saving){again=true;return saving}
  if(!S.unsaved.size){setSaveState('saved');return}
  setSaveState('saving');
  saving=(async()=>{
    let failed=false;
    for(const [id,ver] of [...S.unsaved]){
      const n=S.notes.get(id);if(!n){S.unsaved.delete(id);draftDel(id);continue}
      const ts=Date.now();
      const row={id:n.id,title:n.title||'Untitled',body:n.body||'',updated_at:new Date(ts).toISOString(),updated_by:S.me};
      if(!S.noFolderCol)row.folder=n.folder||null;
      let res;try{res=await sb.from('notes').upsert(row)}catch(e){res={error:e}}
      if(res.error&&/folder/.test(res.error.message||'')){S.noFolderCol=true;delete row.folder;
        toast('Groups can\'t be stored yet. Run the small database update in Supabase (SQL Editor).');
        try{res=await sb.from('notes').upsert(row)}catch(e){res={error:e}}}
      if(res.error){failed=true;console.error(res.error);continue}
      n.updatedAt=ts;n.updatedBy=S.me;
      if(S.unsaved.get(id)===ver){S.unsaved.delete(id);draftDel(id)}
    }
    return failed;
  })();
  const failed=await saving;saving=null;
  if(again){again=false;return flushSave()}
  if(failed){if(!navigator.onLine)setSaveState('offline');else{setSaveState('error');retryTimer=setTimeout(flushSave,5000)}}
  else if(S.unsaved.size){setSaveState('dirty');saveTimer=setTimeout(flushSave,400)}
  else setSaveState('saved');
  bkAutoSoon();
  saveCache();renderList();
}
function setSaveState(st){
  saveState=st;const b=$('saveBtn');
  if(b){b.dataset.state=st;const L={dirty:['Save','Save'],saving:['Saving…','…'],saved:['Saved ✓','✓'],error:['Not saved · Retry','Retry'],offline:['Saved on this device','Offline']}[st];b.innerHTML=`<span class="sv-l">${L[0]}</span><span class="sv-s">${L[1]}</span>`;b.title=L[0];b.disabled=st==='saving'||st==='saved'}
  setStatus();
}
function setStatus(){const s=$('status');const off=!navigator.onLine;
  const ob=$('offBar');if(ob){ob.hidden=!off;const k=pendCount();ob.textContent=off?(k?`You're offline. ${k} change${k===1?' is':'s are'} kept on this device and will upload when you're back online.`:'You\'re offline. You can keep reading and writing; changes upload when you\'re back online.'):''}
  if(off){const k=pendCount();s.textContent=k?`offline · ${k} waiting`:'offline';s.className='status off';return}
  if(saveState!=='dirty'&&saveState!=='saving'&&Object.keys(S.pend.tasks).length+Object.keys(S.pend.noteDel).length){s.textContent='uploading…';s.className='status';return}
  if(!S.live){s.textContent='connecting…';s.className='status';return}
  s.textContent={dirty:'unsaved changes',saving:'saving…',saved:'all saved',error:'not saved, retrying'}[saveState];
  s.className='status'+(saveState==='error'?' off':'');
}
async function createNote(title,folder){
  let t=(title||'Untitled').trim()||'Untitled';
  if(!title){let i=1;while(byTitle(t))t='Untitled '+(++i)}
  const id=newId('n');const now=Date.now();
  const note={id,title:t,body:'',folder:folder||'',createdAt:now,updatedAt:now,updatedBy:S.me};S.notes.set(id,note);open(id,'edit');
  markDirty(note);flushSave();
  setTimeout(()=>{const ti=$('titleIn');if(ti&&!title){ti.focus();ti.select()}},30);
}
async function saveTask(t){
  S.tasks.set(t.id,t);renderBoard();renderCounts();renderLinks();
  S.pend.tasks[t.id]=t;persistPend();saveCache();setStatus();await flushPending();
}
/* ---------- offline: local copy of everything + queue of changes waiting to upload ---------- */
const CACHE_KEY='haiduc.cache.v1',PEND_KEY='haiduc.pending.v1';
let cacheTimer=null,pFlushing=false,pTimer=null;
function lsJSON(k,d){try{return JSON.parse(localStorage.getItem(k)||'null')??d}catch(e){return d}}
function saveCache(){clearTimeout(cacheTimer);cacheTimer=setTimeout(()=>{if(!S.me)return;
  try{localStorage.setItem(CACHE_KEY,JSON.stringify({me:S.me,at:Date.now(),notes:[...S.notes.values()],tasks:[...S.tasks.values()],unsaved:[...S.unsaved.keys()]}))}catch(e){console.warn('local copy too large',e)}},600)}
function clearLocal(){try{localStorage.removeItem(CACHE_KEY);localStorage.removeItem(PEND_KEY)}catch(e){}S.pend={tasks:{},noteDel:{}}}
function persistPend(){try{localStorage.setItem(PEND_KEY,JSON.stringify(S.pend))}catch(e){}}
function pendCount(){return Object.keys(S.pend.tasks).length+Object.keys(S.pend.noteDel).length+S.unsaved.size}
function applyPend(notes,tasks){for(const [id,v] of Object.entries(S.pend.tasks)){if(v===null)tasks.delete(id);else tasks.set(id,v)}for(const id of Object.keys(S.pend.noteDel))notes.delete(id)}
const isNetErr=e=>!navigator.onLine||/fetch|network|load failed|timeout|offline/i.test((e&&(e.message||e.details))||'');
async function upsertTaskRow(t){let row=toTask(t),res;try{res=await sb.from('tasks').upsert(row)}catch(e){res={error:e}}
  if(res.error&&/start_date/.test(res.error.message||'')){S.noStartCol=true;delete row.start_date;toast('Start dates can\'t be stored yet. Run the small database update in Supabase (SQL Editor).');try{res=await sb.from('tasks').upsert(row)}catch(e){res={error:e}}}
  return res}
async function flushPending(){
  if(pFlushing||!sb)return;pFlushing=true;clearTimeout(pTimer);let failed=null;
  for(const [id,v] of Object.entries(S.pend.tasks)){let res;
    if(v===null){try{res=await sb.from('tasks').delete().eq('id',id)}catch(e){res={error:e}}}else res=await upsertTaskRow(v);
    if(res.error){failed=res.error;break}
    if(S.pend.tasks[id]===v)delete S.pend.tasks[id]}
  if(!failed)for(const id of Object.keys(S.pend.noteDel)){let res;try{res=await sb.from('notes').delete().eq('id',id)}catch(e){res={error:e}}
    if(res.error){failed=res.error;break}delete S.pend.noteDel[id]}
  persistPend();pFlushing=false;setStatus();
  if(failed){console.error(failed);if(!isNetErr(failed)&&!S.pendWarned){S.pendWarned=true;toast('Some task changes couldn\'t upload. They\'re kept on this device and will retry.')}
    if(navigator.onLine)pTimer=setTimeout(flushPending,15000)}
  else S.pendWarned=false;
}
function applyDrafts(map){let restored=0;const drafts=draftsAll();
  for(const [id,d] of Object.entries(drafts)){
    if(S.unsaved.has(id)||!d||S.pend.noteDel[id])continue;const srv=map.get(id);
    if(srv&&(srv.updatedAt>=d.at||(srv.body===d.body&&srv.title===d.title&&(d.folder===undefined||(srv.folder||'')===(d.folder||''))))){draftDel(id);continue}
    const note=srv?{...srv,title:d.title,body:d.body,folder:d.folder??srv.folder}:{id,title:d.title||'Untitled',body:d.body||'',folder:d.folder||'',createdAt:d.createdAt||d.at,updatedAt:d.at,updatedBy:S.me};
    map.set(id,note);S.unsaved.set(id,1);restored++}
  return restored}
function showCached(c){
  S.me=c.me;const notes=new Map((c.notes||[]).map(n=>[n.id,n])),tasks=new Map((c.tasks||[]).map(t=>[t.id,t]));
  applyPend(notes,tasks);S.notes=notes;S.tasks=tasks;
  for(const id of (c.unsaved||[]))if(S.notes.has(id))S.unsaved.set(id,1);
  applyDrafts(S.notes);
  if(!S.cur||!S.notes.has(S.cur)){const last=lsGet('vault.cur');S.cur=last&&S.notes.has(last)?last:(S.notes.size?sortedNotes()[0].id:null)}
  $('login').hidden=true;$('app').hidden=false;$('meEmail').textContent=S.me;renderAll();
}
window.addEventListener('online',()=>{setStatus();if(S.unsaved.size)flushSave();flushPending();if(S.live)loadAll()});
window.addEventListener('offline',()=>setStatus());

/* ---------- dates ---------- */
function todayISO(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)}
function msISO(ms){const d=new Date(ms||Date.now());return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)}
const d2n=s=>{const [y,m,d]=s.split('-').map(Number);return Math.round(Date.UTC(y,m-1,d)/864e5)};
const n2d=n=>new Date(n*864e5).toISOString().slice(0,10);
const fmtD=s=>s?new Date(s+'T00:00').toLocaleDateString(undefined,{day:'numeric',month:'short'}):'';
function taskSpan(t){const s=t.start||(t.due&&msISO(t.createdAt)<=t.due?msISO(t.createdAt):t.due)||msISO(t.createdAt);const e=t.due&&t.due>=s?t.due:s;return{s:d2n(s),e:d2n(e),noStart:!t.start,noDue:!t.due}}

/* ---------- rendering ---------- */
function renderAll(){renderList();renderMain();if(S.view==='graph'&&G.visible)graphBuild(),gKick(.2);renderLinks();renderCounts();setStatus();saveCache()}
function renderCounts(){const open=[...S.tasks.values()].filter(t=>t.status!=='done').length;$('tbCount').textContent=open?open:'';$('cNotes').textContent=S.notes.size;$('cTasks').textContent=[...S.tasks.values()].filter(t=>t.status!=='done').length}
function renderList(){
  const ul=$('list');const q=S.q.trim().toLowerCase();
  const tl=$('tagList');if(tl){const tags=allTags();tl.innerHTML=tags.map(([t,c])=>`<button class="tag${q==='#'+t?' on':''}" data-tag="${esc(t)}">#${esc(t)} <span>${c}</span></button>`).join('');tl.hidden=!tags.length}
  let notes=sortedNotes();if(q.startsWith('#')&&q.length>1){const t=q.slice(1);notes=notes.filter(n=>tagsIn(n.body).has(t))}else if(q)notes=notes.filter(n=>(n.title||'').toLowerCase().includes(q)||(n.body||'').toLowerCase().includes(q));
  $('listLabel').textContent=q?`${notes.length} match${notes.length===1?'':'es'}`:'All notes';
  if(!notes.length&&!(allGroups().length&&!q)){ul.innerHTML=`<li class="empty">${q?'No notes match that search.':(S.live?'No notes yet. Press + Note to start.':'Loading notes…')}</li>`;return}
  const item=n=>{const m=ago(n.updatedAt)+(n.updatedBy&&who(n.updatedBy)!=='you'?' · '+who(n.updatedBy):'')+(q&&n.folder?' · '+n.folder:'');
    return `<li><button data-id="${esc(n.id)}" aria-current="${S.view==='notes'&&n.id===S.cur}"><span class="t">${esc(n.title||'Untitled')}</span><span class="m">${esc(m)}</span></button></li>`};
  const groups=allGroups();
  const nf=S.addingGroup?`<li class="grp-newform"><form id="addGroupForm"><label for="dndNewIn">New group</label><div class="row"><input id="dndNewIn" maxlength="60" placeholder="Group name, e.g. Merge game"><button class="btn primary" type="submit">Create</button><button class="btn" type="button" id="dndNewCancel">Cancel</button></div></form></li>`:S.newGroupFor&&S.notes.get(S.newGroupFor)?`<li class="grp-newform"><form id="dndNewForm"><label for="dndNewIn">New group for <b>${esc(S.notes.get(S.newGroupFor).title||'Untitled')}</b></label><div class="row"><input id="dndNewIn" maxlength="60" placeholder="Group name"><button class="btn primary" type="submit">Create</button><button class="btn" type="button" id="dndNewCancel">Cancel</button></div></form></li>`:'';
  const focusNf=()=>{const i=$('dndNewIn');if(i&&document.activeElement!==i)i.focus()};
  if(q||!groups.length){ul.innerHTML=nf+notes.map(item).join('');focusNf();return}
  const closed=groupsClosed();let html='';
  for(const g of groups){const gn=notes.filter(n=>n.folder===g);
    const open=!closed.has(g);
    html+=`<li class="grp" data-group="${esc(g)}">${S.renaming===g
      ?`<form class="grp-rename" data-g="${esc(g)}"><input id="grpRenameIn" value="${esc(g)}" aria-label="New group name" maxlength="60"><button class="btn primary" type="submit">OK</button><button class="btn" type="button" data-grp-cancel="1">Cancel</button></form>`
      :`<div class="grp-head"><button class="grp-toggle" data-grp-toggle="${esc(g)}" aria-expanded="${open}"><span class="caret">${open?'▾':'▸'}</span><span class="gname">${esc(g)}</span><span class="gcount">${gn.length}</span></button><button class="grp-act" data-grp-new="${esc(g)}" title="New note in ${esc(g)}" aria-label="New note in ${esc(g)}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button><button class="grp-act" data-grp-rename="${esc(g)}" title="Rename group" aria-label="Rename group ${esc(g)}">⋯</button></div>`}
      ${open?`<ul class="grp-notes">${gn.length?gn.map(item).join(''):`<li class="grp-empty">Empty. Drag notes here, or press + to write one. <button class="link-btn" data-grp-remove="${esc(g)}">Remove group</button></li>`}</ul>`:''}</li>`}
  const loose=notes.filter(n=>!n.folder);
  if(loose.length)html+=`<li class="grp loose"><div class="grp-head"><span class="gname muted">Not in a group</span><span class="gcount">${loose.length}</span></div><ul class="grp-notes">${loose.map(item).join('')}</ul></li>`;
  ul.innerHTML=nf+html;focusNf();
  const ri=$('grpRenameIn');if(ri&&document.activeElement!==ri){ri.focus();ri.select()}
}
/* ---------- groups (folders) ---------- */
function emptyGroups(){return lsJSON('haiduc.emptyGroups',[])}
function setEmptyGroups(l){try{localStorage.setItem('haiduc.emptyGroups',JSON.stringify(l))}catch(e){}}
function allGroups(){const used=new Set([...S.notes.values()].map(n=>n.folder).filter(Boolean));
  const empty=emptyGroups();const still=empty.filter(g=>!used.has(g));if(still.length!==empty.length)setEmptyGroups(still);
  return [...new Set([...used,...still])].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}))}
function addEmptyGroup(g){g=cleanGroup(g);if(!g)return false;if(allGroups().includes(g)){toast(`There's already a group called ${g}.`);return false}
  setEmptyGroups([...emptyGroups(),g]);setGroupClosed(g,false);return true}
function groupsClosed(){try{return new Set(JSON.parse(localStorage.getItem('haiduc.closedGroups')||'[]'))}catch(e){return new Set()}}
function setGroupClosed(g,closed){const s=groupsClosed();closed?s.add(g):s.delete(g);try{localStorage.setItem('haiduc.closedGroups',JSON.stringify([...s]))}catch(e){}}
function cleanGroup(s){return String(s||'').replace(/\s+/g,' ').trim().slice(0,60)}
function moveToGroup(id,g){const n=S.notes.get(id);if(!n)return;g=cleanGroup(g);if((n.folder||'')===g)return;n.folder=g;markDirty(n);flushSave();renderAll();toast(g?`Moved to ${g}`:'Removed from group')}
function renameGroup(from,to){to=cleanGroup(to);S.renaming=null;if(!to||to===from){renderList();return}
  let k=0;S.notes.forEach(n=>{if(n.folder===from){n.folder=to;markDirty(n);k++}});
  const eg=emptyGroups();if(eg.includes(from))setEmptyGroups(eg.map(x=>x===from?to:x));
  const c=groupsClosed();if(c.has(from)){setGroupClosed(from,false);setGroupClosed(to,true)}
  flushSave();renderAll();toast(`Renamed group to ${to} (${k} note${k===1?'':'s'})`)}
$('list').addEventListener('click',e=>{
  const t=e.target.closest('[data-grp-toggle]');if(t){const g=t.dataset.grpToggle;setGroupClosed(g,t.getAttribute('aria-expanded')==='true');renderList();return}
  const nw=e.target.closest('[data-grp-new]');if(nw){setGroupClosed(nw.dataset.grpNew,false);createNote(null,nw.dataset.grpNew);return}
  const rn=e.target.closest('[data-grp-rename]');if(rn){S.renaming=rn.dataset.grpRename;renderList();return}
  if(e.target.closest('[data-grp-cancel]')){S.renaming=null;renderList()}
});
$('list').addEventListener('submit',e=>{const f=e.target.closest('.grp-rename');if(!f)return;e.preventDefault();renameGroup(f.dataset.g,$('grpRenameIn').value)});

/* #tags (Obsidian style): ignored inside code blocks and `inline code`; '# Heading' (with a space) stays a heading */
const TAG_RE=/(^|[\s(\[,;])#([\p{L}_][\p{L}\p{N}_\/-]*)#?(?=$|[\s.,;:!?)\]])/gu;
function mapOutsideCode(src,fn){let fence=false;return (src||'').split('\n').map(line=>{
  if(/^\s*(```|~~~)/.test(line)){fence=!fence;return line}
  if(fence)return line;
  return line.split(/(`[^`]*`)/).map((part,i)=>i%2?part:fn(part)).join('');
}).join('\n')}
function tagsIn(body){const out=new Set();mapOutsideCode(body,t=>{t.replace(TAG_RE,(m,pre,tag)=>{out.add(tag.toLowerCase());return m});return t});return out}
function allTags(){const c=new Map();S.notes.forEach(n=>tagsIn(n.body).forEach(t=>c.set(t,(c.get(t)||0)+1)));return [...c].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0]))}
function showTag(tag){if(S.unsaved.size)flushSave();S.q='#'+tag;$('q').value=S.q;S.view='notes';S.phList=true;renderAll()}
function keepIndents(src){let fence=false;return (src||'').split('\n').map(l=>{
  if(/^\s*(```|~~~)/.test(l)){fence=!fence;return l}if(fence)return l;
  const m=l.match(/^((?:\t| {4})+)(?!\s*(?:[-*+]|\d+\.)\s)(?=\S)/);if(!m)return l;
  const n=(m[1].match(/\t| {4}/g)||[]).length;return '&emsp;&emsp;'.repeat(n)+l.slice(m[1].length)}).join('\n')}
function renderMarkdown(src){
  src=keepIndents(src);
  src=mapOutsideCode(src,t=>t.replace(TAG_RE,(m,pre,tag)=>`${pre}<a class="tag" data-tag="${esc(tag.toLowerCase())}">#${esc(tag)}</a>`));
  const withLinks=(src||'').replace(/\[\[([^\[\]|]+)(?:\|([^\[\]]*))?\]\]/g,(m,t,alias)=>{
    t=t.trim();const ex=byTitle(t);return `<a class="wl${ex?'':' missing'}" data-note="${esc(t)}">${esc((alias||t).trim())}</a>`});
  const html=marked.parse(withLinks,{gfm:true,breaks:true});
  return DOMPurify.sanitize(html,{ADD_ATTR:['data-note','data-tag']}).replace(/==([^=\n]+)==/g,'<mark>$1</mark>');
}
function renderMain(){
  const phone=PH.matches;
  $('app').classList.toggle('ph-list',phone&&S.view==='notes'&&((S.phList&&!S.backupOpen)||(!S.backupOpen&&!S.notes.get(S.cur)&&!(S.hist&&S.hist.noteId==='__deleted'))));
  $('tabbar').hidden=!phone||$('app').hidden;
  $('tbNotes').setAttribute('aria-pressed',S.view==='notes');$('tbTasks').setAttribute('aria-pressed',S.view==='tasks');$('tbGraph').setAttribute('aria-pressed',S.view==='graph');
  $('app').classList.toggle('tasks-mode',S.view==='tasks'||S.view==='graph');$('app').classList.toggle('graph-mode',S.view==='graph');$('app').classList.toggle('backup-mode',!!S.backupOpen&&S.view==='notes');
  $('navNotes').setAttribute('aria-pressed',S.view==='notes');$('navTasks').setAttribute('aria-pressed',S.view==='tasks');$('navGraph').setAttribute('aria-pressed',S.view==='graph');
  $('noteView').hidden=S.view!=='notes';$('taskView').hidden=S.view!=='tasks';$('graphView').hidden=S.view!=='graph';
  const n=S.notes.get(S.cur);
  $('modeSeg').hidden=S.view!=='notes'||!n;$('delBtn').hidden=S.view!=='notes'||!n;$('histBtn').hidden=S.view!=='notes'||!n;$('histBtn').setAttribute('aria-pressed',!!(S.hist&&n&&S.hist.noteId===n.id));$('saveBtn').hidden=S.view!=='notes'||!n;setSaveState(saveState);$('linksBtn').hidden=S.view!=='notes'||!n;
  $('delBtn').classList.remove('arm');$('delBtn').textContent='Delete';
  if(S.view==='tasks'){$('crumbs').textContent='Tasks';renderBoard();return}
  if(S.view==='graph'){$('crumbs').textContent='Graph';graphShow();return}
  if(S.backupOpen){graphHide();renderBackup();return}
  graphHide();
  $('mEdit').setAttribute('aria-pressed',S.mode==='edit');$('mRead').setAttribute('aria-pressed',S.mode==='read');
  const v=$('noteView');
  if(S.view==='notes'&&S.hist&&S.hist.noteId==='__deleted'){renderHistory();return}
  if(!n){
    $('crumbs').textContent='Haiduc';v.dataset.id='';
    if(!S.live){v.innerHTML='<div class="blank"><p>Loading Haiduc…</p></div>';return}
    v.innerHTML=`<div class="blank"><h2>${S.notes.size?'Pick a note':'No notes yet'}</h2><p>Notes are written in Markdown. Link notes together with <code>[[Note name]]</code>, and switch to Tasks to track work on a board.</p><button class="btn primary" id="blankNew">Create a note</button></div>`;
    $('blankNew').onclick=()=>createNote();return;
  }
  if(S.hist&&S.hist.noteId===n.id){renderHistory();return}
  $('crumbs').textContent='Notes / '+(n.title||'Untitled');
  const meta=n.updatedAt?`Edited ${ago(n.updatedAt)}${n.updatedBy?' by '+esc(who(n.updatedBy)):''}`:'';
  if(S.mode==='edit'){
    if($('bodyIn')&&v.dataset.id===n.id){
      $('metaLine').innerHTML=meta;
      if(!S.unsaved.has(n.id)){const ta=$('bodyIn'),ti=$('titleIn');
        if(ta.value!==n.body){const pos=Math.min(ta.selectionStart,n.body.length);ta.value=n.body;ta.setSelectionRange(pos,pos);paintHl()}
        if(ti.value!==n.title&&document.activeElement!==ti)ti.value=n.title}
      return}
    v.dataset.id=n.id;
    v.innerHTML=`<div class="note-inner"><input class="title-in" id="titleIn" aria-label="Note title" value="${esc(n.title)}"><div class="meta" id="metaLine">${meta}</div>
    <div class="fmt" id="fmtBar" role="toolbar" aria-label="Formatting">
      <button type="button" data-f="undo" title="Undo (${kc('undo')})" aria-label="Undo">↶</button><button type="button" data-f="redo" title="Redo (${kc('redo')})" aria-label="Redo">↷</button><span class="fmt-sep"></span>
      <button type="button" data-f="h1" title="Heading 1 (${kc('h1')})">H1</button><button type="button" data-f="h2" title="Heading 2 (${kc('h2')})">H2</button><button type="button" data-f="h3" title="Heading 3 (${kc('h3')})">H3</button>
      <button type="button" data-f="b" title="Bold (${kc('b')})"><b>B</b></button><button type="button" data-f="i" title="Italic (${kc('i')})"><i>I</i></button><button type="button" data-f="u" title="Underline (${kc('u')})" aria-label="Underline"><u>U</u></button><button type="button" data-f="s" title="Strikethrough (${kc('s')})" aria-label="Strikethrough"><s>S</s></button><button type="button" data-f="hl" title="Highlight (${kc('hl')})"><mark class="fmt-mark">H</mark></button>
      <button type="button" data-f="ul" title="List (${kc('ul')})">• List</button><button type="button" data-f="todo" title="To-do (${kc('todo')})">☐ To-do</button>
      <button type="button" data-f="link" title="Link to note (${kc('link')})">[[ ]]</button><button type="button" data-f="tag" title="Tag">#</button>
      <button type="button" class="fmt-keys" id="keysBtn" title="Keyboard shortcuts (${kc('help')})" aria-label="Keyboard shortcuts">⌨</button>
    </div>
    <div class="editor"><pre class="hl" id="bodyHl" aria-hidden="true"></pre><textarea class="body" id="bodyIn" aria-label="Note text" placeholder="Start writing…" spellcheck="true" aria-autocomplete="list" aria-controls="linkPop">${esc(n.body)}</textarea><div class="link-pop" id="linkPop" role="listbox" hidden></div></div>
    <div class="hint"><code>[[Other note]]</code> link · <code>#tag</code> · <code># Heading</code> · <code>- [ ] to-do</code> · <code>**bold**</code> · <code>==highlight==</code></div></div>`;
    const eid=n.id;
    $('titleIn').oninput=e=>{const cur=S.notes.get(eid);if(!cur)return;cur.title=e.target.value;$('crumbs').textContent='Notes / '+(cur.title||'Untitled');markDirty(cur)};
    $('bodyIn').oninput=e=>{const cur=S.notes.get(eid);if(!cur)return;cur.body=e.target.value;paintHl();autosize(e.target);markDirty(cur);linkSuggest()};
    $('bodyIn').onkeydown=linkKeys;
    $('bodyIn').addEventListener('click',linkSuggest);
    $('bodyIn').addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement!==$('bodyIn'))linkClose()},150));
    $('linkPop').addEventListener('pointerdown',e=>e.preventDefault()); // keep the keyboard open on phones
    $('linkPop').addEventListener('click',e=>{const it=e.target.closest('[data-i]');if(it){LS.i=+it.dataset.i;linkAccept()}});
    $('fmtBar').onmousedown=e=>e.preventDefault();
    $('fmtBar').onclick=e=>{if(e.target.closest('#keysBtn')){showKeys();return}const b=e.target.closest('[data-f]');if(b)applyFmt(b.dataset.f)};
    paintHl();autosize($('bodyIn'));
  }else{
    v.dataset.id='';
    v.innerHTML=`<div class="note-inner"><h1 class="title-in" style="margin:0">${esc(n.title||'Untitled')}</h1><div class="meta">${meta}</div><div class="prose" id="prose">${n.body?renderMarkdown(n.body):'<p class="hint">This note is empty. Switch to Edit to write.</p>'}</div></div>`;
    if(PH.matches)v.querySelector('.note-inner').insertAdjacentHTML('beforeend','<section class="links-inline" id="linksInline"></section>');
    v.querySelectorAll('#prose input[type=checkbox]').forEach((cb,i)=>{cb.disabled=false;cb.onchange=()=>toggleCheck(n,i)});
  }
}
/* Edit-mode formatting: a colored copy of the text sits behind the transparent textarea.
   Only color and weight change (monospace bold keeps the same width), so the cursor stays aligned. */
function hlLine(line){
  const h=line.match(/^( {0,3})(#{1,6})(\s.*|$)/);
  if(h)return `<span class="hh hh${h[2].length}">${esc(line)}</span>`;
  let s=esc(line);
  s=s.replace(/\[\[[^\[\]]+\]\]/g,m=>`<span class="hk">${m}</span>`)
     .replace(/\*\*[^*]+\*\*/g,m=>`<span class="hb">${m}</span>`)
     .replace(/==[^=]+==/g,m=>`<span class="hm">${m}</span>`)
     .replace(/~~[^~]+~~/g,m=>`<span class="hs">${m}</span>`)
     .replace(/&lt;u&gt;.*?&lt;\/u&gt;/g,m=>`<span class="hu">${m}</span>`)
     .replace(/(^|[\s(\[,;])(#[\p{L}_][\p{L}\p{N}_\/-]*)/gu,(m,p,t)=>`${p}<span class="ht">${t}</span>`)
     .replace(/^(\s*)([-*+]|\d+\.)(\s+\[[ xX]\])?(?=\s)/,(m,sp,b,c)=>`${sp}<span class="hl-b">${b}${c||''}</span>`);
  return s;
}
function paintHl(){const ta=$('bodyIn'),hl=$('bodyHl');if(!ta||!hl)return;let fence=false;
  hl.innerHTML=ta.value.split('\n').map(l=>{if(/^\s*(```|~~~)/.test(l)){fence=!fence;return `<span class="hc">${esc(l)}</span>`}return fence?`<span class="hc">${esc(l)}</span>`:hlLine(l)}).join('\n')+'\n ';}
function applyFmt(f){
  const ta=$('bodyIn');if(!ta)return;const v=ta.value;let s=ta.selectionStart,e=ta.selectionEnd;
  const ls=v.lastIndexOf('\n',s-1)+1;let le=v.indexOf('\n',e);if(le<0)le=v.length;
  const set=(text,from,to,ns,ne)=>{ta.focus();ta.setSelectionRange(from,to);if(!document.execCommand('insertText',false,text)){ta.setRangeText(text,from,to,'end')}ta.setSelectionRange(ns,ne);ta.dispatchEvent(new Event('input'))};
  const lineFx=fn=>{const lines=v.slice(ls,le).split('\n').map(fn).join('\n');set(lines,ls,le,ls+lines.length,ls+lines.length)};
  const heading=n=>lineFx(l=>{const m=l.match(/^ {0,3}(#{1,6})\s+/);const rest=m?l.slice(m[0].length):l;return m&&m[1].length===n?rest:'#'.repeat(n)+' '+rest});
  const prefix=p=>lineFx(l=>l.startsWith(p)?l.slice(p.length):p+l.replace(/^([-*+]\s+(\[[ xX]\]\s+)?)/,''));
  const wrap=(o,c,ph)=>{
    const sel=v.slice(s,e);
    // already wrapped (markers just outside or inside the selection)? then remove them
    const outside=v.slice(s-o.length,s)===o&&v.slice(e,e+c.length)===c&&!(o==='*'&&(v[s-2]==='*'||v[e+1]==='*'));
    if(sel&&outside){set(sel,s-o.length,e+c.length,s-o.length,e-o.length);return}
    if(sel.length>=o.length+c.length&&sel.startsWith(o)&&sel.endsWith(c)&&!(o==='*'&&sel.startsWith('**'))){const inner=sel.slice(o.length,sel.length-c.length);set(inner,s,e,s,s+inner.length);return}
    const t=sel||ph;set(o+t+c,s,e,s+o.length,s+o.length+t.length)};
  // Tab / Shift+Tab: move the selected lines right or left (a tab is 4 spaces wide)
  const indent=right=>{
    const multi=v.slice(s,e).includes('\n');
    let first=0,total=0;
    const lines=v.slice(ls,le).split('\n').map((l,i)=>{let n;
      if(right)n='\t'+l;else n=l.replace(/^(\t| {1,4})/,'');
      const d=n.length-l.length;if(i===0)first=d;total+=d;return n}).join('\n');
    if(!total)return;
    set(lines,ls,le,multi?ls:Math.max(ls,s+first),multi?ls+lines.length:Math.max(ls,e+first))};
  const todoToggle=()=>lineFx(l=>{const m=l.match(/^(\s*[-*+]\s+)\[( |x|X)\]\s?/);if(m)return m[1]+(m[2]===' '?'[x] ':'[ ] ')+l.slice(m[0].length);
    const b=l.match(/^(\s*)[-*+]\s+/);return b?b[1]+'- [ ] '+l.slice(b[0].length):'- [ ] '+l});
  if(f==='h1')heading(1);else if(f==='h2')heading(2);else if(f==='h3')heading(3);
  else if(f==='b')wrap('**','**','bold text');else if(f==='i')wrap('*','*','italic text');else if(f==='hl')wrap('==','==','highlighted text');else if(f==='u')wrap('<u>','</u>','underlined text');else if(f==='s')wrap('~~','~~','crossed-out text');
  else if(f==='undo'||f==='redo'){ta.focus();document.execCommand(f)}
  else if(f==='indent'||f==='outdent')indent(f==='indent');
  else if(f==='todoToggle')todoToggle();
  else if(f==='ul')prefix('- ');else if(f==='todo')prefix('- [ ] ');
  else if(f==='link')wrap('[[',']]','Note name');
  else if(f==='tag'){const sel=v.slice(s,e).replace(/\s+/g,'-')||'tag';set('#'+sel,s,e,s+1,s+1+sel.length)}
}
/* ---------- [[link]] suggestions while typing ---------- */
const LS={open:false,items:[],i:0,start:0,end:0,q:''};
function linkContext(){const ta=$('bodyIn');if(!ta||ta.selectionStart!==ta.selectionEnd&&!/^\]\]/.test(ta.value.slice(ta.selectionEnd)))return null;
  const v=ta.value,pos=ta.selectionStart,ls=v.lastIndexOf('\n',pos-1)+1;const before=v.slice(ls,pos);
  const k=before.lastIndexOf('[[');if(k<0)return null;const q=before.slice(k+2);
  if(/[\[\]|]/.test(q)||q.length>60)return null;
  // when the toolbar inserted [[Note name]] with the name selected, replace the selection
  const selEnd=ta.selectionEnd;
  return{start:ls+k+2,end:Math.max(pos,selEnd),q:ta.selectionStart!==selEnd?'':q}}
function linkSuggest(){
  const c=linkContext();if(!c){linkClose();return}
  const q=c.q.trim().toLowerCase(),self=S.cur;
  let list=[...S.notes.values()].filter(n=>n.id!==self&&(n.title||'').trim());
  if(q)list=list.filter(n=>n.title.toLowerCase().includes(q));
  list.sort((x,y)=>{const a=x.title.toLowerCase(),b=y.title.toLowerCase();return (q?(b.startsWith(q)-a.startsWith(q)):0)||(y.updatedAt||0)-(x.updatedAt||0)});
  const items=list.slice(0,8).map(n=>({title:n.title,folder:n.folder||''}));
  if(c.q.trim()&&![...S.notes.values()].some(n=>n.title.trim().toLowerCase()===q))items.push({title:c.q.trim(),isNew:true});
  if(!items.length){linkClose();return}
  Object.assign(LS,{open:true,items,i:Math.min(LS.open?LS.i:0,items.length-1),start:c.start,end:c.end,q:c.q});
  const pop=$('linkPop');
  pop.innerHTML=items.map((it,i)=>`<div class="lp-item${i===LS.i?' on':''}" role="option" aria-selected="${i===LS.i}" data-i="${i}">${it.isNew?`<span class="lp-t"><span class="lp-new">+ New note:</span> ${esc(it.title)}</span>`:`<span class="lp-t">${lpMark(it.title,q)}</span>${it.folder?`<span class="lp-g">${esc(it.folder)}</span>`:''}`}</div>`).join('')+'<div class="lp-hint">↑↓ choose · Enter insert · Esc close</div>';
  pop.hidden=false;linkPlace();
}
function lpMark(t,q){if(!q)return esc(t);const i=t.toLowerCase().indexOf(q);if(i<0)return esc(t);return esc(t.slice(0,i))+'<b>'+esc(t.slice(i,i+q.length))+'</b>'+esc(t.slice(i+q.length))}
function linkPlace(){
  // find where the cursor is by laying the text out in an invisible copy of the editor
  const ta=$('bodyIn'),pop=$('linkPop'),ed=ta.parentElement;
  const m=document.createElement('pre');m.className='hl lp-mirror';m.setAttribute('aria-hidden','true');
  m.innerHTML=esc(ta.value.slice(0,LS.start-2))+'<span id="lpCaret">[[</span>';ed.appendChild(m);
  const mk=m.querySelector('#lpCaret');const top=mk.offsetTop+mk.offsetHeight+4;let left=mk.offsetLeft;m.remove();
  const w=Math.min(320,ed.clientWidth);left=Math.max(0,Math.min(left,ed.clientWidth-w));
  pop.style.left=left+'px';pop.style.top=top+'px';pop.style.width=w+'px';
  const r=pop.getBoundingClientRect(),vh=window.visualViewport?window.visualViewport.height:window.innerHeight;
  if(r.bottom>vh-8)pop.scrollIntoView({block:'nearest'});
}
function linkClose(){LS.open=false;const p=$('linkPop');if(p)p.hidden=true}
/* ---------- keyboard shortcuts: ⌘ on Mac, Ctrl on Windows/Linux ---------- */
const IS_MAC=/Mac|iPhone|iPad/.test((navigator.userAgentData&&navigator.userAgentData.platform)||navigator.platform||navigator.userAgent);
const KEYS={undo:['Z'],redo:['Shift','Z'],u:['U'],s:['Shift','X'],b:['B'],i:['I'],link:['K'],hl:['Shift','H'],h1:['Alt','1'],h2:['Alt','2'],h3:['Alt','3'],ul:['Shift','8'],todo:['Enter'],edit:['E'],save:['S'],help:['/']};
function kc(id){if(id==='redo'&&!IS_MAC)return 'Ctrl+Y';const k=KEYS[id];if(!k)return'';return IS_MAC?'⌘'+k.map(x=>x==='Shift'?'⇧':x==='Alt'?'⌥':x).join(''):'Ctrl+'+k.join('+')}
function modKey(e){return IS_MAC?e.metaKey&&!e.ctrlKey:e.ctrlKey&&!e.metaKey}
function editorShortcut(e){
  if(!modKey(e))return false;const k=e.key.toLowerCase(),c=e.code;let f=null;
  if(!e.shiftKey&&!e.altKey){if(k==='b')f='b';else if(k==='i')f='i';else if(k==='u')f='u';else if(k==='k')f='link';else if(k==='enter')f='todoToggle'}
  else if(e.shiftKey&&!e.altKey){if(c==='KeyX')f='s';else if(c==='KeyH')f='hl';else if(c==='Digit8')f='ul'}
  else if(e.altKey&&!e.shiftKey){if(c==='Digit1')f='h1';else if(c==='Digit2')f='h2';else if(c==='Digit3')f='h3'}
  if(!f)return false;e.preventDefault();linkClose();applyFmt(f);if(f==='link')linkSuggest();return true}
function showKeys(){
  let d=$('keysDlg');if(d){d.remove();return}
  const rows=[['Undo','undo'],['Redo','redo'],['Bold','b'],['Italic','i'],['Underline','u'],['Strikethrough','s'],['Highlight','hl'],['Link to a note','link'],['Heading 1 / 2 / 3','h1'],['Bullet list','ul'],['To-do on / off','todo'],['Move lines right / left','tab'],['Switch Edit / Read','edit'],['Save now','save'],['Show this list','help']];
  d=document.createElement('div');d.id='keysDlg';d.className='keys-dlg';d.setAttribute('role','dialog');d.setAttribute('aria-label','Keyboard shortcuts');
  d.innerHTML=`<div class="keys-box"><div class="hist-head"><h2>Keyboard shortcuts</h2><button class="btn" id="keysClose">Close</button></div>
    <table>${rows.map(([l,id])=>`<tr><td>${l}</td><td><kbd>${id==='tab'?'Tab / Shift+Tab':id==='h1'?kc('h1').replace(/1$/,'1 / 2 / 3'):kc(id)}</kbd></td></tr>`).join('')}</table>
    <p class="hint">Bold, italic and highlight switch off when pressed again. Type <code>[[</code> to pick a note to link.</p></div>`;
  document.body.appendChild(d);const close=()=>{d.remove();const ta=$('bodyIn');if(ta)ta.focus()};
  $('keysClose').onclick=close;d.addEventListener('click',e=>{if(e.target===d)close()});d.addEventListener('keydown',e=>{if(e.key==='Escape')close()});$('keysClose').focus()}
function linkKeys(e){
  if(editorShortcut(e))return;
  if(e.key==='Tab'&&!LS.open&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();applyFmt(e.shiftKey?'outdent':'indent');return}
  if(!LS.open)return;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();LS.i=(LS.i+(e.key==='ArrowDown'?1:-1)+LS.items.length)%LS.items.length;
    [...$('linkPop').querySelectorAll('.lp-item')].forEach((el,i)=>{el.classList.toggle('on',i===LS.i);el.setAttribute('aria-selected',i===LS.i)});return}
  if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();linkAccept();return}
  if(e.key==='Escape'){e.preventDefault();linkClose()}
}
function linkAccept(){
  const it=LS.items[LS.i];if(!it)return;const ta=$('bodyIn');const v=ta.value;
  let end=LS.end;const hasClose=v.slice(end,end+2)===']]';
  const text=it.title+(hasClose?'':']]');ta.focus();ta.setSelectionRange(LS.start,end);
  if(!document.execCommand('insertText',false,text))ta.setRangeText(text,LS.start,end,'end');
  const caret=LS.start+it.title.length+2;ta.setSelectionRange(caret,caret);
  linkClose();ta.dispatchEvent(new Event('input'));linkClose();
}
function autosize(t){if(t){t.style.height='';t.scrollTop=0}}
document.addEventListener('scroll',e=>{if(e.target&&e.target.id==='bodyIn')e.target.scrollTop=0},true);
function toggleCheck(n,idx){n=S.notes.get(n.id)||n;let i=-1;n.body=n.body.replace(/^(\s*(?:[-*+]|\d+\.)\s+)\[( |x|X)\]/gm,(m,p,c)=>{i++;return i===idx?p+(c===' '?'[x]':'[ ]'):m});markDirty(n);flushSave()}
function renderLinks(){
  const L=$('links');const n=S.notes.get(S.cur);
  if(!n||S.view!=='notes'){L.innerHTML='<div class="label">Links</div><div class="none">Open a note to see what links to it.</div>';return}
  const back=backlinks(n);const out=[...new Set(linksIn(n.body))];const tasks=[...S.tasks.values()].filter(t=>t.noteId===n.id);
  const t0=(n.title||'').trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const snippet=src=>{const m=(src||'').match(new RegExp('[^\\n]{0,40}\\[\\['+t0+'[^\\]]*\\]\\][^\\n]{0,40}','i'));return m?m[0]:''};
  const html=`<div class="label">Backlinks · ${back.length}</div>${back.length?'<ul>'+back.map(b=>`<li><button data-open="${esc(b.id)}">${esc(b.title)}</button><div class="x">${esc(snippet(b.body))}</div></li>`).join('')+'</ul>':'<div class="none">No other note links here yet.</div>'}
  <div class="label">Outgoing · ${out.length}</div>${out.length?'<ul>'+out.map(t=>{const ex=byTitle(t);return `<li><button data-title="${esc(t)}" style="${ex?'':'color:var(--muted)'}">${esc(t)}${ex?'':' (new)'}</button></li>`}).join('')+'</ul>':'<div class="none">Type [[Note name]] to link.</div>'}
  <div class="label">Tasks · ${tasks.length}</div>${tasks.length?'<ul>'+tasks.map(t=>`<li><button class="tk" data-tasks="1">${t.status==='done'?'✓ ':''}${esc(t.title)}</button></li>`).join('')+'</ul>':'<div class="none">No tasks linked to this note.</div>'}`;
  L.innerHTML=html;const inl=$('linksInline');if(inl)inl.innerHTML=html;
}
function renderBoard(){
  const sel=$('tNote');const cur=sel.value;
  sel.innerHTML='<option value="">No linked note</option>'+sortedNotes().map(n=>`<option value="${esc(n.id)}">${esc(n.title)}</option>`).join('');sel.value=cur;
  if(S.tv==='gantt'){renderGantt();return}
  const today=todayISO();
  const all=[...S.tasks.values()].sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||(a.createdAt||0)-(b.createdAt||0));
  $('board').innerHTML=STATUS.map(([s,label],idx)=>{
    const items=all.filter(t=>(t.status||'todo')===s);
    return `<section class="col" data-s="${s}"><h3>${label}<span>${items.length}</span></h3>${items.length?items.map(t=>{
      const note=t.noteId&&S.notes.get(t.noteId);const late=t.due&&t.due<today&&s!=='done';
      const mine=t.assignee&&S.me&&t.assignee.toLowerCase()===S.me.toLowerCase();
      return `<article class="card" draggable="true" data-id="${esc(t.id)}"><div class="tt">${esc(t.title)}</div>
      ${S.editDates===t.id?`<div class="date-edit"><label>Start<input type="date" data-dfield="start" value="${esc(t.start||'')}"></label><label>Due<input type="date" data-dfield="due" value="${esc(t.due||'')}"></label><button data-dates-done="1">Done</button></div>`:''}
      <div class="row"><button class="chip date-chip${late?' late':''}" data-edit-dates="1" title="Change dates">${late?'overdue · ':''}${t.start&&t.due?`${esc(fmtD(t.start))} → ${esc(fmtD(t.due))}`:t.due?`due ${esc(fmtD(t.due))}`:t.start?`from ${esc(fmtD(t.start))}`:'+ Dates'}</button>${note?`<span class="chip note-link" data-open="${esc(note.id)}">${esc(note.title)}</span>`:''}${t.assignee?`<span class="chip" title="Assigned to ${esc(t.assignee)}">@${esc(who(t.assignee))}</span>`:''}</div>
      <div class="acts">${idx>0?`<button data-move="${STATUS[idx-1][0]}" aria-label="Move back">←</button>`:''}${idx<2?`<button data-move="${STATUS[idx+1][0]}" aria-label="Move forward">→</button>`:''}<button data-assign="1">${mine?'Unassign':'Take it'}</button><button data-del="1" aria-label="Delete task">✕</button></div></article>`}).join(''):'<div class="none">Nothing here.</div>'}</section>`}).join('');
}

/* ---------- history: earlier versions kept by the database ---------- */
const fmtWhen=iso=>new Date(iso).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
async function openHistory(noteId){
  if(S.unsaved.size)await flushSave();
  S.hist={noteId,list:null,sel:null,err:null};S.view='notes';
  if(noteId==='__deleted'){S.cur='__deleted';S.phList=false}
  renderAll();
  let q=sb.from('note_versions').select('id,note_id,title,body,saved_at,saved_by,reason').order('saved_at',{ascending:false}).limit(100);
  q=noteId==='__deleted'?q.eq('reason','deleted'):q.eq('note_id',noteId);
  const {data,error}=await q;
  if(!S.hist||S.hist.noteId!==noteId)return;
  if(error){console.error(error);S.hist.err=/note_versions|relation|schema cache|does not exist/i.test(error.message||'')?'setup':'net'}
  else S.hist.list=noteId==='__deleted'?data.filter(v=>!S.notes.has(v.note_id)):data;
  renderHistory();
}
function renderHistory(){
  const H=S.hist,v=$('noteView');v.dataset.id='';const del=H.noteId==='__deleted';const n=S.notes.get(H.noteId);
  $('crumbs').textContent=del?'Deleted notes':'Notes / '+((n&&n.title)||'Untitled')+' / History';
  let body;
  if(H.err==='setup')body=`<p class="hint">History isn't switched on yet. In Supabase, open <b>SQL Editor → New query</b>, paste the contents of <code>supabase/add-note-history.sql</code> and press <b>Run</b>. From then on, earlier versions are kept automatically.</p>`;
  else if(H.err)body='<p class="hint">Couldn\'t load the history. Check your connection and try again.</p>';
  else if(!H.list)body='<p class="hint">Loading…</p>';
  else if(H.sel){const ver=H.list.find(x=>x.id===H.sel);
    body=`<div class="hist-actions"><button class="btn" data-h="back">‹ All versions</button><button class="btn primary" data-h="restore">${del?'Restore this note':'Restore this version'}</button></div>
    <div class="meta">${del?'Deleted':'Saved'} ${esc(fmtWhen(ver.saved_at))}${ver.saved_by?' · by '+esc(who(ver.saved_by)):''}</div>
    <h2 class="hist-title">${esc(ver.title||'Untitled')}</h2><div class="prose hist-preview">${ver.body?renderMarkdown(ver.body):'<p class="hint">(empty)</p>'}</div>`}
  else if(!H.list.length)body=del?'<p class="hint">No deleted notes.</p>':'<p class="hint">No earlier versions yet. From now on, a copy is kept whenever this note changes (while you type, at most one every 5 minutes) and whenever a note is deleted.</p>';
  else body=`<ul class="hist-list">${H.list.map(x=>`<li><button data-h="pick" data-vid="${x.id}"><span class="hw">${esc(fmtWhen(x.saved_at))}${x.saved_by?' · '+esc(who(x.saved_by)):''}${x.reason==='before restore'?' · before a restore':''}</span><span class="ht2">${esc(del?(x.title||'Untitled'):((x.body||'').replace(/\s+/g,' ').slice(0,110)||'(empty)'))}</span></button></li>`).join('')}</ul>`;
  v.innerHTML=`<div class="note-inner"><div class="hist-head"><h1 class="title-in" style="margin:0">${del?'Deleted notes':'History'}</h1><button class="btn" data-h="close">Close</button></div>
    ${del?'':`<p class="hint">Earlier versions of <b>${esc((n&&n.title)||'Untitled')}</b>. Pick one to see it and restore it. Restoring keeps the current text in History too.</p>`}${body}</div>`;
}
async function restoreVersion(){
  const H=S.hist;const ver=H&&H.list&&H.list.find(x=>x.id===H.sel);if(!ver)return;
  if(H.noteId==='__deleted'){
    const note={id:ver.note_id,title:ver.title||'Untitled',body:ver.body||'',createdAt:Date.now(),updatedAt:Date.now(),updatedBy:S.me};
    S.notes.set(note.id,note);markDirty(note);await flushSave();S.hist=null;open(note.id,'read');toast('Note restored.');return}
  const cur=S.notes.get(H.noteId);if(!cur)return;
  const {error}=await sb.from('note_versions').insert({note_id:cur.id,title:cur.title,body:cur.body,saved_by:S.me,reason:'before restore'});
  if(error){toast('Couldn\'t restore: the current text could not be backed up first. Try again.');return}
  cur.title=ver.title||'Untitled';cur.body=ver.body||'';markDirty(cur);await flushSave();
  S.hist=null;S.mode='read';renderAll();toast('Restored the version from '+fmtWhen(ver.saved_at)+'. The text you replaced is in History.');
}
$('noteView').addEventListener('click',e=>{const b=e.target.closest('[data-h]');if(!b||!S.hist)return;
  const k=b.dataset.h;
  if(k==='close'){const del=S.hist.noteId==='__deleted';S.hist=null;if(del){S.cur=null;S.phList=true}renderAll()}
  else if(k==='pick'){S.hist.sel=+b.dataset.vid;renderHistory();$('noteView').scrollTop=0}
  else if(k==='back'){S.hist.sel=null;renderHistory()}
  else if(k==='restore')restoreVersion();
});
$('histBtn').onclick=()=>{const n=S.notes.get(S.cur);if(!n)return;if(S.hist&&S.hist.noteId===n.id){S.hist=null;renderAll()}else openHistory(n.id)};
$('deletedBtn').onclick=()=>openHistory('__deleted');

/* ---------- graph view (notes = dots, [[links]] = lines) ---------- */
const G={nodes:[],links:[],byId:new Map(),pos:new Map(),cam:{x:0,y:0,k:1},alpha:1,raf:0,hover:null,drag:null,pointers:new Map(),fitted:false,colors:null,visible:false};
const GROUP_COLORS=['#3a72b0','#c0662f','#3d8a57','#8a4fb0','#b0435f','#2f8a8a','#9a7d1f','#5b6ab8'];
function gColor(folder){if(!folder)return null;let h=0;for(const c of folder)h=(h*31+c.charCodeAt(0))>>>0;return GROUP_COLORS[h%GROUP_COLORS.length]}
function gOpt(id){const el=$(id.replace(/^#/,''));return !!(el&&el.checked)}
function gReadColors(){const cs=getComputedStyle(document.documentElement);const v=k=>cs.getPropertyValue(k).trim();
  G.colors={bg:v('--surface'),fg:v('--fg'),muted:v('--muted'),line:v('--line'),accent:v('--accent'),warn:v('--warn'),panel:v('--panel'),font:v('--ui')||'sans-serif'}}
function graphBuild(){
  const nodes=[],links=[],by=new Map();const add=n=>{by.set(n.id,n);nodes.push(n)};
  S.notes.forEach(n=>add({id:'n:'+n.id,noteId:n.id,label:n.title||'Untitled',kind:'note',folder:n.folder||''}));
  const showTags=gOpt('#gTags'),showMissing=gOpt('#gMissing');
  const pairs=new Set();
  S.notes.forEach(n=>{const src='n:'+n.id;const seen=new Set();
    for(const t of linksIn(n.body)){const ex=byTitle(t);let tid;
      if(ex)tid='n:'+ex.id;else{if(!showMissing)continue;tid='m:'+t.toLowerCase();if(!by.has(tid))add({id:tid,label:t,kind:'missing'})}
      if(tid===src||seen.has(tid))continue;seen.add(tid);const key=[src,tid].sort().join('|');if(pairs.has(key))continue;pairs.add(key);links.push({s:src,t:tid})}
    if(showTags)for(const tg of tagsIn(n.body)){const tid='t:'+tg;if(!by.has(tid))add({id:tid,label:'#'+tg,kind:'tag'});links.push({s:src,t:tid,tag:true})}});
  for(const n of nodes)n.deg=0;for(const l of links){by.get(l.s).deg++;by.get(l.t).deg++}
  let keep=new Set(nodes.map(n=>n.id));
  if(gOpt('#gLocal')&&S.cur&&by.has('n:'+S.cur)){const c='n:'+S.cur;keep=new Set([c]);
    for(let d=0;d<2;d++){const add2=[];for(const l of links){if(keep.has(l.s))add2.push(l.t);if(keep.has(l.t))add2.push(l.s)}add2.forEach(x=>keep.add(x))}}
  if(!gOpt('#gOrphans'))for(const n of nodes)if(n.kind==='note'&&n.deg===0&&n.noteId!==S.cur)keep.delete(n.id);
  G.nodes=nodes.filter(n=>keep.has(n.id));G.links=links.filter(l=>keep.has(l.s)&&keep.has(l.t));G.byId=new Map(G.nodes.map(n=>[n.id,n]));
  G.adj=new Map(G.nodes.map(n=>[n.id,new Set()]));for(const l of G.links){G.adj.get(l.s).add(l.t);G.adj.get(l.t).add(l.s)}
  // positions survive rebuilds; new dots start near a neighbour (or on a small spiral)
  let i=0;for(const n of G.nodes){let p=G.pos.get(n.id);
    if(!p){const nb=[...G.adj.get(n.id)].map(x=>G.pos.get(x)).find(Boolean);const a=i*2.4,r=30+8*Math.sqrt(i);
      p=nb?{x:nb.x+(Math.random()-.5)*40,y:nb.y+(Math.random()-.5)*40,vx:0,vy:0}:{x:Math.cos(a)*r,y:Math.sin(a)*r,vx:0,vy:0};G.pos.set(n.id,p)}
    n.p=p;n.r=n.kind==='note'?4+Math.sqrt(n.deg)*2.2:n.kind==='tag'?3.5:3;i++}
  // legend of groups
  const groups=[...new Set(G.nodes.filter(n=>n.folder).map(n=>n.folder))].sort();
  $('gLegend').innerHTML=groups.map(g=>`<span><i style="background:${gColor(g)}"></i>${esc(g)}</span>`).join('')+(G.nodes.some(n=>n.kind==='note'&&!n.folder)?'<span><i class="none"></i>No group</span>':'')+(G.nodes.some(n=>n.kind==='tag')?'<span><i class="tag"></i>Tag</span>':'')+(G.nodes.some(n=>n.kind==='missing')?'<span><i class="missing"></i>Note not written yet</span>':'');
  const em=$('gEmpty');em.hidden=!!G.nodes.length;if(!G.nodes.length)em.textContent=S.notes.size?'Nothing to show with these options.':'No notes yet. Write a note and link others with [[Note name]] to see them here.';
  G.alpha=Math.max(G.alpha,.6);
}
function gStep(){
  const N=G.nodes,L=G.links;if(!N.length)return;const a=G.alpha;
  for(let i=0;i<N.length;i++){const p=N[i].p;for(let j=i+1;j<N.length;j++){const q=N[j].p;let dx=p.x-q.x,dy=p.y-q.y,d2=dx*dx+dy*dy;if(d2<1){dx=Math.random()-.5;dy=Math.random()-.5;d2=1}
    if(d2>160000)continue;const f=520*a/d2;p.vx+=dx*f;p.vy+=dy*f;q.vx-=dx*f;q.vy-=dy*f}}
  for(const l of L){const p=G.byId.get(l.s).p,q=G.byId.get(l.t).p;const dx=q.x-p.x,dy=q.y-p.y,d=Math.sqrt(dx*dx+dy*dy)||1;const f=(d-(l.tag?55:75))*.06*a/d;p.vx+=dx*f;p.vy+=dy*f;q.vx-=dx*f;q.vy-=dy*f}
  for(const n of N){const p=n.p;const g=n.deg?.02:.05;p.vx-=p.x*g*a;p.vy-=p.y*g*a;
    if((G.drag&&G.drag.node===n)||G.hover===n){p.vx=p.vy=0;continue}
    p.vx*=.82;p.vy*=.82;p.x+=Math.max(-30,Math.min(30,p.vx));p.y+=Math.max(-30,Math.min(30,p.vy))}
  G.alpha*=.985;
}
function gResize(){const c=$('gCanvas'),w=$('gWrap');const dpr=window.devicePixelRatio||1;const W=w.clientWidth,H=w.clientHeight;
  if(c.width!==Math.round(W*dpr)||c.height!==Math.round(H*dpr)){c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);c.style.width=W+'px';c.style.height=H+'px'}G.W=W;G.H=H;G.dpr=dpr}
function gFit(){if(!G.nodes.length||!G.W)return;let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const n of G.nodes){x0=Math.min(x0,n.p.x);y0=Math.min(y0,n.p.y);x1=Math.max(x1,n.p.x);y1=Math.max(y1,n.p.y)}
  const k=Math.min(2,Math.max(.2,Math.min((G.W-100)/((x1-x0)||1),(G.H-130)/((y1-y0)||1))));G.cam={k,x:G.W/2-(x0+x1)/2*k,y:(G.H-30)/2-(y0+y1)/2*k}}
const toScreen=p=>({x:p.x*G.cam.k+G.cam.x,y:p.y*G.cam.k+G.cam.y});
const toWorld=(x,y)=>({x:(x-G.cam.x)/G.cam.k,y:(y-G.cam.y)/G.cam.k});
function gDraw(){
  const c=$('gCanvas'),ctx=c.getContext('2d'),C=G.colors;ctx.setTransform(G.dpr,0,0,G.dpr,0,0);ctx.clearRect(0,0,G.W,G.H);
  const k=G.cam.k,q=($('gSearch').value||'').trim().toLowerCase();
  const focus=G.hover||(G.drag&&G.drag.node)||null;const near=focus?G.adj.get(focus.id):null;
  const lit=n=>!focus||n===focus||near.has(n.id);const match=n=>!q||n.label.toLowerCase().includes(q);
  ctx.save();ctx.translate(G.cam.x,G.cam.y);ctx.scale(k,k);
  ctx.lineWidth=1/k;
  for(const l of G.links){const s=G.byId.get(l.s),t=G.byId.get(l.t);const on=focus&&(s===focus||t===focus);
    ctx.strokeStyle=on?C.accent:C.line;ctx.globalAlpha=focus&&!on?.25:q&&!(match(s)&&match(t))?.25:on?1:.9;ctx.lineWidth=(on?1.8:1)/k;
    ctx.beginPath();ctx.moveTo(s.p.x,s.p.y);ctx.lineTo(t.p.x,t.p.y);ctx.stroke()}
  for(const n of G.nodes){const dim=!lit(n)||(q&&!match(n));ctx.globalAlpha=dim?.25:1;
    ctx.beginPath();ctx.arc(n.p.x,n.p.y,n.r,0,Math.PI*2);
    if(n.kind==='missing'){ctx.fillStyle=C.bg;ctx.fill();ctx.setLineDash([2/k,2/k]);ctx.strokeStyle=C.muted;ctx.lineWidth=1.2/k;ctx.stroke();ctx.setLineDash([])}
    else{ctx.fillStyle=n.kind==='tag'?C.muted:(gColor(n.folder)||C.fg);ctx.fill()}
    if(n.noteId&&n.noteId===S.cur){ctx.strokeStyle=C.warn;ctx.lineWidth=2.5/k;ctx.beginPath();ctx.arc(n.p.x,n.p.y,n.r+3/k*1.5,0,Math.PI*2);ctx.stroke()}
    if(q&&match(n)&&!dim){ctx.strokeStyle=C.accent;ctx.lineWidth=2/k;ctx.beginPath();ctx.arc(n.p.x,n.p.y,n.r+2,0,Math.PI*2);ctx.stroke()}}
  ctx.restore();
  // labels in screen space so text stays crisp
  ctx.font=`12px ${C.font}`;ctx.textAlign='center';ctx.textBaseline='top';
  for(const n of G.nodes){const show=n===focus||(near&&near.has(n.id))||(q&&match(n))||k>=.9||(G.nodes.length<=40&&k>=.35)||(n.deg>=4&&k>=.5)||(n.noteId===S.cur);if(!show)continue;
    const s=toScreen(n.p);if(s.x<-80||s.x>G.W+80||s.y<-20||s.y>G.H+20)continue;
    const dim=!lit(n)||(q&&!match(n));const txt=n.label.length>28?n.label.slice(0,27)+'…':n.label;
    ctx.globalAlpha=dim?.3:1;ctx.lineWidth=3;ctx.strokeStyle=C.bg;ctx.strokeText(txt,s.x,s.y+n.r*k+4);ctx.fillStyle=n===focus?C.accent:n.kind==='missing'?C.muted:C.fg;ctx.fillText(txt,s.x,s.y+n.r*k+4)}
  ctx.globalAlpha=1;
}
function gLoop(){G.raf=0;if(!G.visible)return;gResize();
  for(let i=0;i<(G.fitted?1:250);i++)gStep();if(!G.fitted||!G.userCam)gFit();G.fitted=true;
  gDraw();if(G.alpha>.004||G.drag||G.panning)G.raf=requestAnimationFrame(gLoop)}
function gKick(a){G.alpha=Math.max(G.alpha,a||.3);if(!G.raf&&G.visible)G.raf=requestAnimationFrame(gLoop)}
function graphShow(){G.visible=true;G.userCam=false;gReadColors();graphBuild();gResize();gKick(.5)}
function graphHide(){G.visible=false;if(G.raf){cancelAnimationFrame(G.raf);G.raf=0}}
function gHit(x,y){const w=toWorld(x,y);let best=null,bd=1e9;for(const n of G.nodes){const dx=n.p.x-w.x,dy=n.p.y-w.y,d=Math.sqrt(dx*dx+dy*dy);const r=Math.max(n.r,12/G.cam.k);if(d<r&&d<bd){bd=d;best=n}}return best}
function gLocalXY(e){const r=$('gCanvas').getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
function gZoomAt(x,y,f){G.userCam=true;const k=Math.min(4,Math.max(.15,G.cam.k*f));const w=toWorld(x,y);G.cam.k=k;G.cam.x=x-w.x*k;G.cam.y=y-w.y*k;gKick(0)}
const gc=()=>$('gCanvas');
gc().addEventListener('pointerdown',e=>{const {x,y}=gLocalXY(e);gc().setPointerCapture(e.pointerId);G.pointers.set(e.pointerId,{x,y});
  if(G.pointers.size===2){G.drag=null;const [a,b]=[...G.pointers.values()];G.pinch={d:Math.hypot(a.x-b.x,a.y-b.y)};return}
  const n=gHit(x,y)||(e.pointerType==='mouse'?G.hover:null);G.down={x,y,t:Date.now(),node:n};
  if(n){G.drag={node:n};const w=toWorld(x,y);n.p.x=w.x;n.p.y=w.y;gKick(.3)}else{G.panning={x,y,cx:G.cam.x,cy:G.cam.y}}});
gc().addEventListener('pointermove',e=>{const {x,y}=gLocalXY(e);
  if(G.pointers.has(e.pointerId))G.pointers.set(e.pointerId,{x,y});
  if(G.pinch&&G.pointers.size===2){const [a,b]=[...G.pointers.values()];const d=Math.hypot(a.x-b.x,a.y-b.y);gZoomAt((a.x+b.x)/2,(a.y+b.y)/2,d/G.pinch.d);G.pinch.d=d;return}
  if(G.drag){const w=toWorld(x,y);G.drag.node.p.x=w.x;G.drag.node.p.y=w.y;G.drag.node.p.vx=G.drag.node.p.vy=0;gKick(.15);return}
  if(G.panning){G.userCam=true;G.cam.x=G.panning.cx+(x-G.panning.x);G.cam.y=G.panning.cy+(y-G.panning.y);gKick(0);return}
  const h=gHit(x,y);if(h!==G.hover){G.hover=h;gc().style.cursor=h?'pointer':'grab';gKick(0)}});
function gUp(e){const {x,y}=gLocalXY(e);G.pointers.delete(e.pointerId);if(G.pointers.size<2)G.pinch=null;
  const d=G.down;G.down=null;const wasDrag=G.drag;G.drag=null;G.panning=null;
  if(d&&d.node&&Math.hypot(x-d.x,y-d.y)<6&&Date.now()-d.t<500){const n=d.node;
    if(n.kind==='note')open(n.noteId,'read');else if(n.kind==='tag')showTag(n.label.slice(1));else if(n.kind==='missing')createNote(n.label);return}
  if(wasDrag)gKick(.2)}
gc().addEventListener('pointerup',gUp);gc().addEventListener('pointercancel',gUp);
gc().addEventListener('pointerleave',()=>{if(G.hover&&!G.drag){G.hover=null;gKick(0)}});
gc().addEventListener('wheel',e=>{e.preventDefault();const {x,y}=gLocalXY(e);gZoomAt(x,y,Math.exp(-e.deltaY*.0015))},{passive:false});
$('gOptBtn').onclick=()=>{const o=$('gOpts');o.classList.toggle('open');$('gOptBtn').setAttribute('aria-expanded',o.classList.contains('open'));setTimeout(()=>gKick(0),0)};
$('gReset').onclick=()=>{G.userCam=false;gFit();gKick(0)};
$('gSearch').oninput=()=>gKick(0);
for(const id of ['#gLocal','#gTags','#gMissing','#gOrphans'])$(id.slice(1)).onchange=()=>{graphBuild();G.fitted=false;G.userCam=false;gKick(.6)};
window.addEventListener('resize',()=>{if(G.visible)gKick(0)});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(G.visible){gReadColors();gKick(0)}});

/* ---------- timeline (Gantt) ---------- */
const STAT_LABEL={todo:'To do',doing:'In progress',done:'Done'};
function renderGantt(){
  const g=$('gantt');const list=[...S.tasks.values()].map(t=>({t,...taskSpan(t)})).sort((x,y)=>x.s-y.s||x.e-y.e);
  if(!list.length){g.innerHTML='<div class="none g-empty">No tasks yet. Add one above with a start and due date to see it on the timeline.</div>';return}
  const DW=PH.matches?24:30,tn=d2n(todayISO());
  let lo=Math.min(tn,...list.map(x=>x.s))-3,hi=Math.max(tn,...list.map(x=>x.e))+10;
  lo-=((new Date(lo*864e5).getUTCDay()+6)%7);if(hi-lo<35)hi=lo+35;
  const days=[];for(let n=lo;n<=hi;n++)days.push(n);const W=days.length*DW;
  const months=[];days.forEach((n,i)=>{const d=new Date(n*864e5);if(i===0||d.getUTCDate()===1)months.push({i,label:d.toLocaleDateString(undefined,{month:'long',year:'numeric',timeZone:'UTC'})})});
  const bg=days.map((n,i)=>{const wd=new Date(n*864e5).getUTCDay();return wd===0||wd===6?`<div class="g-we" style="left:${i*DW}px;width:${DW}px"></div>`:''}).join('');
  const todayX=(tn-lo)*DW;
  g.innerHTML=`<div class="g-legend"><span class="g-k s-todo"></span>To do<span class="g-k s-doing"></span>In progress<span class="g-k s-done"></span>Done<span class="g-hint">Drag a bar to move it, drag its edges to change start or due.</span></div>
  <div class="g-scroll" id="gScroll"><div class="g-table" style="--dw:${DW}px;width:calc(var(--gn) + ${W}px)">
    <div class="g-row g-head"><div class="g-name g-corner">Task</div><div class="g-track" style="width:${W}px">
      ${months.map((m,k)=>`<div class="g-month" style="left:${m.i*DW}px;width:${((months[k+1]?months[k+1].i:days.length)-m.i)*DW}px">${esc(m.label)}</div>`).join('')}
      ${days.map((n,i)=>{const d=new Date(n*864e5);return `<div class="g-day${n===tn?' today':''}" style="left:${i*DW}px;width:${DW}px"><span>${'MTWTFSS'[(d.getUTCDay()+6)%7]}</span>${d.getUTCDate()}</div>`}).join('')}
    </div></div>
    ${list.map(({t,s,e,noStart,noDue})=>{const late=t.due&&t.due<todayISO()&&t.status!=='done';
      return `<div class="g-row"><div class="g-name" title="${esc(t.title)}"><span class="g-dot s-${t.status}"></span><span class="g-tt">${esc(t.title)}</span></div>
      <div class="g-track" style="width:${W}px">${bg}<div class="g-today" style="left:${todayX+DW/2}px"></div>
        <div class="g-bar s-${t.status}${late?' late':''}${(e-s+1)*DW<100?' short':''}${noDue?' nodue':''}${noStart?' nostart':''}" data-id="${esc(t.id)}" style="left:${(s-lo)*DW+2}px;width:${(e-s+1)*DW-4}px" title="${esc(t.title)}: ${esc(fmtD(n2d(s)))} → ${noDue?'no due date':esc(fmtD(t.due))} · ${STAT_LABEL[t.status]}">
          <span class="g-h l"></span><span class="g-lbl">${esc(t.title)}</span><span class="g-h r"></span></div></div></div>`}).join('')}
  </div></div>`;
  g.dataset.lo=lo;g.dataset.dw=DW;
  const sc=$('gScroll');if(!S.gScrolled){S.gScrolled=true;sc.scrollLeft=Math.max(0,todayX-DW*5)}else if(S.gScrollX!=null)sc.scrollLeft=S.gScrollX;
  sc.onscroll=()=>{S.gScrollX=sc.scrollLeft};
}
let gDrag=null;
$('gantt').addEventListener('pointerdown',e=>{
  const bar=e.target.closest('.g-bar');if(!bar||e.button>0)return;const t=S.tasks.get(bar.dataset.id);if(!t)return;
  const sp=taskSpan(t);const mode=e.target.classList.contains('l')?'l':e.target.classList.contains('r')?'r':'m';
  gDrag={t,mode,x0:e.clientX,s0:sp.s,e0:sp.e,s:sp.s,e:sp.e,bar,moved:false,lo:+$('gantt').dataset.lo,dw:+$('gantt').dataset.dw};
  bar.setPointerCapture(e.pointerId);bar.classList.add('drag');e.preventDefault();
});
$('gantt').addEventListener('pointermove',e=>{
  if(!gDrag)return;const d=Math.round((e.clientX-gDrag.x0)/gDrag.dw);const G=gDrag;
  if(G.mode==='l'){G.s=Math.min(G.s0+d,G.e0);G.e=G.e0}else if(G.mode==='r'){G.e=Math.max(G.e0+d,G.s0);G.s=G.s0}else{G.s=G.s0+d;G.e=G.e0+d}
  if(d!==0)G.moved=true;
  G.bar.style.left=((G.s-G.lo)*G.dw+2)+'px';G.bar.style.width=((G.e-G.s+1)*G.dw-4)+'px';
  G.bar.querySelector('.g-lbl').textContent=fmtD(n2d(G.s))+' → '+fmtD(n2d(G.e));
});
async function gEnd(){if(!gDrag)return;const G=gDrag;gDrag=null;G.bar.classList.remove('drag');
  if(!G.moved){G.bar.querySelector('.g-lbl').textContent=G.t.title;return}
  const u={...G.t,start:n2d(G.s)};if(G.mode!=='l'||G.t.due)u.due=n2d(G.e);
  await saveTask(u);toast(`${G.t.title}: ${fmtD(u.start)} → ${u.due?fmtD(u.due):'no due date'}`)}
$('gantt').addEventListener('pointerup',gEnd);$('gantt').addEventListener('pointercancel',gEnd);
function setTv(v){S.tv=v;lsSet('haiduc.tv',v);$('tvBoard').setAttribute('aria-pressed',v==='board');$('tvGantt').setAttribute('aria-pressed',v==='gantt');$('board').hidden=v==='gantt';$('gantt').hidden=v!=='gantt';renderBoard()}
$('tvBoard').onclick=()=>setTv('board');$('tvGantt').onclick=()=>setTv('gantt');

/* ---------- events ---------- */
$('taskForm').addEventListener('submit',async e=>{
  e.preventDefault();const title=$('tTitle').value.trim();if(!title)return;
  let st=$('tStart').value||'',du=$('tDue').value||'';if(st&&du&&du<st)du=st;
  const t={id:newId('t'),title,status:'todo',start:st,due:du,noteId:$('tNote').value||'',assignee:'',createdAt:Date.now(),createdBy:S.me};
  $('tTitle').value='';$('tDue').value='';$('tStart').value=todayISO();await saveTask(t);toast('Task added');
});
$('board').addEventListener('click',async e=>{
  const o=e.target.closest('[data-open]');if(o){open(o.dataset.open,'read');return}
  const card=e.target.closest('.card');if(!card)return;const t=S.tasks.get(card.dataset.id);if(!t)return;
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.editDates){S.editDates=S.editDates===t.id?null:t.id;renderBoard();return}
  if(b.dataset.datesDone){S.editDates=null;renderBoard();return}
  if(b.dataset.move)await saveTask({...t,status:b.dataset.move});
  else if(b.dataset.assign){const mine=t.assignee&&t.assignee.toLowerCase()===S.me.toLowerCase();await saveTask({...t,assignee:mine?'':S.me})}
  else if(b.dataset.del){
    if(b.dataset.arm){S.tasks.delete(t.id);renderBoard();renderCounts();S.pend.tasks[t.id]=null;persistPend();saveCache();await flushPending()}
    else{b.dataset.arm='1';b.textContent='Delete?';b.style.color='var(--warn)';setTimeout(()=>{if(b.isConnected){delete b.dataset.arm;b.textContent='✕';b.style.color=''}},3000)}
  }
});
$('board').addEventListener('change',async e=>{
  const inp=e.target.closest('[data-dfield]');if(!inp)return;const card=inp.closest('.card');const t=card&&S.tasks.get(card.dataset.id);if(!t)return;
  const u={...t,[inp.dataset.dfield]:inp.value||''};
  if(u.start&&u.due&&u.due<u.start){if(inp.dataset.dfield==='start')u.due=u.start;else u.start=u.due;toast('Due date can\'t be before the start date, so I adjusted it.')}
  await saveTask(u);
});
let dragId=null;
$('board').addEventListener('dragstart',e=>{const c=e.target.closest('.card');if(c){dragId=c.dataset.id;e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',dragId)}catch(_){}}});
$('board').addEventListener('dragover',e=>{const col=e.target.closest('.col');if(col&&dragId){e.preventDefault();document.querySelectorAll('.col.drop').forEach(c=>c!==col&&c.classList.remove('drop'));col.classList.add('drop')}});
$('board').addEventListener('drop',async e=>{const col=e.target.closest('.col');document.querySelectorAll('.col.drop').forEach(c=>c.classList.remove('drop'));if(col&&dragId){e.preventDefault();const t=S.tasks.get(dragId);dragId=null;if(t&&t.status!==col.dataset.s)await saveTask({...t,status:col.dataset.s})}});
$('board').addEventListener('dragend',()=>{dragId=null;document.querySelectorAll('.col.drop').forEach(c=>c.classList.remove('drop'))});

function open(id,mode){S.hist=null;S.backupOpen=false;{const nn=S.notes.get(id);if(nn&&nn.folder)setGroupClosed(nn.folder,false)}if(S.unsaved.size)flushSave();S.cur=id;S.phList=false;S.view='notes';if(mode)S.mode=mode;lsSet('vault.cur',id);$('app').classList.remove('drawer');renderAll();$('noteView').scrollTop=0}
$('list').addEventListener('click',e=>{const b=e.target.closest('button[data-id]');if(b)open(b.dataset.id,'read')});
/* ---------- drag notes between groups (mouse: drag; touch: press and hold, then drag) ---------- */
let dnd=null;
$('list').addEventListener('click',e=>{if(S.dndClickBlock&&Date.now()<S.dndClickBlock&&e.target.closest('button[data-id]')){e.stopImmediatePropagation();e.preventDefault()}},true);
$('list').addEventListener('pointerdown',e=>{
  const b=e.target.closest('button[data-id]');if(!b||e.button>0||S.q)return;
  dnd={id:b.dataset.id,src:b,x0:e.clientX,y0:e.clientY,touch:e.pointerType!=='mouse',active:false,pid:e.pointerId};
  if(dnd.touch)dnd.timer=setTimeout(()=>{if(dnd&&!dnd.active)dndStart(dnd.x0,dnd.y0)},380);
});
window.addEventListener('pointermove',e=>{
  if(!dnd||e.pointerId!==dnd.pid)return;
  const moved=Math.hypot(e.clientX-dnd.x0,e.clientY-dnd.y0);
  if(!dnd.active){
    if(dnd.touch){if(moved>10){clearTimeout(dnd.timer);dnd=null}return} // finger moved early: it's a scroll
    if(moved>6)dndStart(e.clientX,e.clientY);else return}
  dndMove(e.clientX,e.clientY);
});
// stop the page from scrolling while a note is being dragged on a touch screen
document.addEventListener('touchmove',e=>{if(dnd&&dnd.active)e.preventDefault()},{passive:false});
window.addEventListener('pointerup',e=>{if(!dnd||e.pointerId!==dnd.pid)return;clearTimeout(dnd.timer);if(dnd.active)dndDrop(e.clientX,e.clientY);dnd=null});
window.addEventListener('pointercancel',()=>{if(!dnd)return;clearTimeout(dnd.timer);if(dnd.active)dndEnd();dnd=null});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&dnd&&dnd.active){dndEnd();dnd=null}});
$('list').addEventListener('contextmenu',e=>{if(dnd)e.preventDefault()});
function dndStart(x,y){
  const n=S.notes.get(dnd.id);if(!n){dnd=null;return}
  dnd.active=true;if(navigator.vibrate)try{navigator.vibrate(15)}catch(_){}
  dnd.src.classList.add('dnd-src');document.body.classList.add('dnd-on');
  const g=document.createElement('div');g.className='dnd-ghost';g.textContent=n.title||'Untitled';document.body.appendChild(g);dnd.ghost=g;
  const z=document.createElement('li');z.className='dnd-newzone';z.dataset.dropNew='1';z.textContent='+ Drop here for a new group';$('list').appendChild(z);dnd.zone=z;
  if(!allGroups().length){const l=document.createElement('li');l.className='dnd-hint';l.textContent='Drop on the box below to start your first group.';$('list').prepend(l);dnd.hint=l}
  dndMove(x,y);
}
function dndTarget(x,y){
  dnd.ghost.style.display='none';const el=document.elementFromPoint(x,y);dnd.ghost.style.display='';
  if(!el)return null;
  if(el.closest('[data-drop-new]'))return{el:el.closest('[data-drop-new]'),group:null,isNew:true};
  const li=el.closest('#list .grp');if(!li)return null;
  return{el:li,group:li.classList.contains('loose')?'':li.dataset.group};
}
function dndMove(x,y){
  dnd.ghost.style.transform=`translate(${x+12}px,${y+12}px)`;
  const t=dndTarget(x,y);const cur=(S.notes.get(dnd.id)||{}).folder||'';
  document.querySelectorAll('.dnd-over').forEach(e=>e.classList.remove('dnd-over'));
  if(t&&(t.isNew||t.group!==cur))t.el.classList.add('dnd-over');
  dnd.target=t;
  // scroll the list when dragging near its top or bottom edge
  const L=$('list'),r=L.getBoundingClientRect();clearInterval(dnd.scroll);
  const sp=y<r.top+40?-10:y>r.bottom-40?10:0;if(sp)dnd.scroll=setInterval(()=>{L.scrollTop+=sp},16);
}
function dndEnd(){
  clearInterval(dnd.scroll);dnd.ghost&&dnd.ghost.remove();dnd.zone&&dnd.zone.remove();dnd.hint&&dnd.hint.remove();
  dnd.src.classList.remove('dnd-src');document.body.classList.remove('dnd-on');
  document.querySelectorAll('.dnd-over').forEach(e=>e.classList.remove('dnd-over'));
  S.dndClickBlock=Date.now()+400;
}
function dndDrop(x,y){
  const t=dndTarget(x,y),id=dnd.id;dndEnd();if(!t)return;
  if(t.isNew){S.newGroupFor=id;renderList();return}
  if(t.group!==((S.notes.get(id)||{}).folder||'')){if(t.group)setGroupClosed(t.group,false);moveToGroup(id,t.group)}
}
$('list').addEventListener('submit',e=>{if(e.target.id!=='dndNewForm')return;e.preventDefault();const id=S.newGroupFor;S.newGroupFor=null;const g=cleanGroup($('dndNewIn').value);if(g&&id){setGroupClosed(g,false);moveToGroup(id,g)}else renderList()});
$('list').addEventListener('click',e=>{if(e.target.id==='dndNewCancel'){S.newGroupFor=null;S.addingGroup=false;renderList()}
  const rm=e.target.closest('[data-grp-remove]');if(rm){setEmptyGroups(emptyGroups().filter(x=>x!==rm.dataset.grpRemove));renderList()}});
$('list').addEventListener('submit',e=>{if(e.target.id!=='addGroupForm')return;e.preventDefault();
  if(addEmptyGroup($('dndNewIn').value)){S.addingGroup=false;renderAll();toast('Group created. Drag notes into it, or press its + to write a note.')}});
function setAddMenu(open){$('addMenu').hidden=!open;$('addMenuBtn').setAttribute('aria-expanded',open);if(open)$('newGroup').focus()}
$('addMenuBtn').onclick=e=>{e.stopPropagation();setAddMenu($('addMenu').hidden)};
document.addEventListener('click',e=>{if(!$('addMenu').hidden&&!e.target.closest('.add-menu'))setAddMenu(false)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('addMenu').hidden){setAddMenu(false);$('addMenuBtn').focus()}});
$('menuNewTask').onclick=()=>{setAddMenu(false);if(S.unsaved.size)flushSave();S.view='tasks';$('app').classList.remove('drawer');renderAll();const t=$('tTitle');t.scrollIntoView({block:'center'});t.focus()};
$('newGroup').onclick=()=>{setAddMenu(false);S.addingGroup=!S.addingGroup;S.newGroupFor=null;S.q='';$('q').value='';if(PH.matches){S.view='notes';S.phList=true}renderAll();$('list').scrollTop=0};
$('links').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.open)open(b.dataset.open,'read');
  else if(b.dataset.title){const ex=byTitle(b.dataset.title);ex?open(ex.id,'read'):createNote(b.dataset.title)}
  else if(b.dataset.tasks){S.view='tasks';renderAll()}
});
$('noteView').addEventListener('click',e=>{
  const lb=e.target.closest('#linksInline button');
  if(lb){if(lb.dataset.open)open(lb.dataset.open,'read');else if(lb.dataset.title){const ex=byTitle(lb.dataset.title);ex?open(ex.id,'read'):createNote(lb.dataset.title)}else if(lb.dataset.tasks){S.view='tasks';renderAll()}return}
  const tg=e.target.closest('a.tag');if(tg){e.preventDefault();showTag(tg.dataset.tag);return}
  const a=e.target.closest('a.wl');if(!a)return;e.preventDefault();const ex=byTitle(a.dataset.note);ex?open(ex.id,'read'):createNote(a.dataset.note)});
$('navNotes').onclick=()=>{S.backupOpen=false;if(S.unsaved.size)flushSave();S.view='notes';renderAll()};
$('navTasks').onclick=()=>{S.backupOpen=false;if(S.unsaved.size)flushSave();S.view='tasks';$('app').classList.remove('drawer');renderAll()};
$('mEdit').onclick=()=>{S.hist=null;S.mode='edit';renderMain();setTimeout(()=>{const t=$('bodyIn');if(!t)return;t.focus();const n=t.value.length;t.setSelectionRange(n,n);const r=t.getBoundingClientRect();if(r.bottom>window.innerHeight)t.closest('.note').scrollTop=t.closest('.note').scrollHeight},20)};
$('mRead').onclick=()=>{S.hist=null;if(S.unsaved.size)flushSave();S.mode='read';renderMain();renderLinks()};
$('newNote').onclick=()=>createNote();
$('saveBtn').onclick=()=>{const n=S.notes.get(S.cur);if(n&&!S.unsaved.size)return;flushSave()};
$('q').oninput=e=>{S.q=e.target.value;renderList()};
$('tagList').addEventListener('click',e=>{const b=e.target.closest('[data-tag]');if(!b)return;const t=b.dataset.tag;if(S.q==='#'+t){S.q='';$('q').value='';renderList()}else showTag(t)});
$('menuBtn').onclick=()=>{if(S.unsaved.size)flushSave();S.phList=true;S.mode='read';renderAll()};
$('tbNotes').onclick=()=>{S.backupOpen=false;if(S.unsaved.size)flushSave();S.view='notes';S.phList=true;renderAll()};
$('navGraph').onclick=()=>{S.backupOpen=false;if(S.unsaved.size)flushSave();S.view='graph';$('app').classList.remove('drawer');renderAll()};
$('tbGraph').onclick=()=>{S.backupOpen=false;if(S.unsaved.size)flushSave();S.view='graph';renderAll()};
$('tbTasks').onclick=()=>{S.backupOpen=false;if(S.unsaved.size)flushSave();S.view='tasks';renderAll()};
$('tbNew').onclick=()=>{if(S.view==='tasks'){const t=$('tTitle');t.scrollIntoView({block:'center'});t.focus();}else createNote()};
PH.addEventListener('change',()=>renderAll());
$('linksBtn').onclick=()=>$('app').classList.toggle('show-links');
document.addEventListener('click',e=>{const app=$('app');if(app.classList.contains('drawer')&&!e.target.closest('#side')&&!e.target.closest('#menuBtn'))app.classList.remove('drawer')});
$('delBtn').onclick=async()=>{
  const b=$('delBtn');const n=S.notes.get(S.cur);if(!n)return;
  if(!b.classList.contains('arm')){b.classList.add('arm');b.textContent='Confirm delete';setTimeout(()=>{b.classList.remove('arm');b.textContent='Delete'},3000);return}
  S.unsaved.delete(n.id);draftDel(n.id);S.notes.delete(n.id);S.cur=null;S.pend.noteDel[n.id]=true;persistPend();renderAll();flushPending();toast('Note deleted');
};
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&(e.key==='/'||e.code==='Slash')&&!e.altKey){e.preventDefault();showKeys();return}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='e'&&S.view==='notes'&&S.cur){e.preventDefault();S.mode==='edit'?$('mRead').click():$('mEdit').click()}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();flushSave()}
});
window.addEventListener('beforeunload',e=>{if(S.unsaved.size){flushSave();e.preventDefault();e.returnValue=''}});
window.addEventListener('pagehide',()=>{if(S.unsaved.size)flushSave()});

/* ---------- live data ---------- */
function staleForMe(srv,local){return !!local&&!!srv&&(local.updatedAt||0)>(srv.updatedAt||0)&&(!srv.updatedBy||!S.me||srv.updatedBy.toLowerCase()===S.me.toLowerCase())}
function isTyping(id){return S.unsaved.has(id)}
function onChange(table,p){
  const isNotes=table==='notes';const map=isNotes?S.notes:S.tasks;
  if(p.eventType==='DELETE'){const id=p.old&&p.old.id;if(!id)return;map.delete(id);if(isNotes&&id===S.cur)S.cur=null}
  else{const d=isNotes?fromNote(p.new):fromTask(p.new);
    if(isNotes){const local=S.notes.get(d.id);
      if(isTyping(d.id)||staleForMe(d,local))return;
      // our own save coming back (or no visible change): update quietly, don't touch the editor
      if(local&&local.title===d.title&&local.body===d.body&&(local.folder||'')===(d.folder||'')){local.updatedAt=d.updatedAt;local.updatedBy=d.updatedBy;renderList();return}}
    map.set(d.id,d)}
  if(isNotes)renderAll();else{renderCounts();renderLinks();if(S.view==='tasks')renderBoard()}
}
async function loadAll(){
  const [n,t]=await Promise.all([sb.from('notes').select('*'),sb.from('tasks').select('*')]);
  if(n.error||t.error){const er=n.error||t.error;console.error(er);setStatus();if(!isNetErr(er))toast('Could not load your notes. Reload the page.');return false}
  const fresh=new Map(n.data.map(r=>[r.id,fromNote(r)]));
  // never let server data replace text that hasn't reached the server yet
  for(const id of S.unsaved.keys()){const local=S.notes.get(id);if(local)fresh.set(id,local)}
  for(const [id,srv] of fresh){const local=S.notes.get(id);if(local&&local!==srv&&staleForMe(srv,local))fresh.set(id,local)}
  const restored=applyDrafts(fresh);
  const ftasks=new Map(t.data.map(r=>[r.id,fromTask(r)]));applyPend(fresh,ftasks);
  S.notes=fresh;S.tasks=ftasks;
  if(!S.cur||!S.notes.has(S.cur)){const last=lsGet('vault.cur');S.cur=last&&S.notes.has(last)?last:(S.notes.size?sortedNotes()[0].id:null)}
  S.live=true;renderAll();
  if(restored)toast(restored===1?'Restored 1 note that hadn\'t been saved yet. Saving it now.':'Restored '+restored+' notes that hadn\'t been saved yet. Saving them now.');
  if(S.unsaved.size)flushSave();
  if(Object.keys(S.pend.tasks).length||Object.keys(S.pend.noteDel).length)flushPending();
  return true;
}
function subscribe(){
  if(channel)sb.removeChannel(channel);
  channel=sb.channel('vault')
    .on('postgres_changes',{event:'*',schema:'public',table:'notes'},p=>onChange('notes',p))
    .on('postgres_changes',{event:'*',schema:'public',table:'tasks'},p=>onChange('tasks',p))
    .subscribe(st=>{if(st==='SUBSCRIBED'&&S.live)loadAll()});
}
// refresh after the tab was asleep (laptop lid, phone background)
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){if(S.unsaved.size)flushSave()}else if(S.live&&navigator.onLine)loadAll()});

/* ---------- auth ---------- */
function showLogin(msg,isErr){
  $('app').hidden=true;$('login').hidden=false;$('tabbar').hidden=true;
  const m=$('loginMsg');m.textContent=msg||'';m.className='msg'+(isErr?' err':'');m.hidden=!msg;
}
async function enter(session){
  const email=session.user.email;const c=lsJSON(CACHE_KEY,null);
  if(c&&c.me&&c.me.toLowerCase()!==email.toLowerCase()){clearLocal();S.notes.clear();S.tasks.clear()}
  S.me=email;
  let res;try{res=await sb.from('members').select('email').limit(1)}catch(e){res={error:e}}
  const {data,error}=res;
  if(error&&isNetErr(error)){ // offline: work from the copy on this device, finish signing in when back online
    if(!S.notes.size&&c&&c.me&&c.me.toLowerCase()===email.toLowerCase())showCached(c);
    $('login').hidden=true;$('app').hidden=false;$('meEmail').textContent=S.me;renderAll();
    window.addEventListener('online',()=>enter(session),{once:true});return}
  if(error||!data||!data.length){await sb.auth.signOut();clearLocal();S.notes.clear();S.tasks.clear();showLogin(`${S.me} isn't on the members list. Ask the owner to add you.`,true);return}
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
$('signOut').onclick=async()=>{
  if(S.unsaved.size)await flushSave();await flushPending();
  if(pendCount()){toast('Some changes haven\'t uploaded yet. Connect to the internet first, or they\'ll be lost when you sign out.');return}
  if(channel)sb.removeChannel(channel);await sb.auth.signOut();clearLocal();S.notes.clear();S.tasks.clear();S.live=false;S.me=null;showLogin()};

/* ---------- night mode: Auto (follow device) → Dark → Light ---------- */
const THEME_ICON={"auto": "<svg class=\"ico\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"8\"/><path d=\"M12 4a8 8 0 0 1 0 16z\" fill=\"currentColor\"/></svg>", "dark": "<svg class=\"ico\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z\"/></svg>", "light": "<svg class=\"ico\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4\"/></svg>"};
const THEMES=['auto','dark','light'],THEME_NAME={auto:'Auto',dark:'Dark',light:'Light'};
function currentTheme(){try{const t=localStorage.getItem('haiduc.theme');return THEMES.includes(t)?t:'auto'}catch(e){return 'auto'}}
function applyTheme(t){const r=document.documentElement;if(t==='auto')r.removeAttribute('data-theme');else r.setAttribute('data-theme',t);
  const dark=t==='dark'||(t==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach(m=>{m.setAttribute('content',dark?'#17191b':'#f5f5f2');m.removeAttribute('media')});
  const b=$('themeBtn');if(b){b.querySelector('.ico').outerHTML=THEME_ICON[t];b.title='Theme: '+THEME_NAME[t];b.setAttribute('aria-label','Theme: '+THEME_NAME[t]+(t==='auto'?' (follows this device)':'')+'. Click to change.');$('themeLbl').textContent=THEME_NAME[t];b.dataset.t=t}
  if(typeof G!=='undefined'&&G.visible){gReadColors();gKick(0)}}
$('themeBtn').onclick=()=>{const t=THEMES[(THEMES.indexOf(currentTheme())+1)%THEMES.length];try{localStorage.setItem('haiduc.theme',t)}catch(e){}applyTheme(t);toast(t==='auto'?'Theme: Auto (follows your device)':'Theme: '+THEME_NAME[t])};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(currentTheme()==='auto')applyTheme('auto')});
applyTheme(currentTheme());

/* ---------- backups to this device: a .zip download anywhere, or a folder kept up to date (Chrome/Edge on a computer) ---------- */
const BK={dir:null,perm:null,busy:false,timer:0,last:lsJSON('haiduc.bk.last',null),auto:lsJSON('haiduc.bk.auto',true),written:lsJSON('haiduc.bk.files',{})};
const canFolder=()=>'showDirectoryPicker' in window;
function safeName(s){return (String(s||'Untitled').replace(/[\\/:*?"<>|#^\[\]]/g,'-').replace(/\s+/g,' ').trim().slice(0,100)||'Untitled').replace(/^\.+/,'_')}
function backupFiles(){
  // one Markdown file per note (in a folder per group) + Tasks.md + a full copy for restoring
  const files=[],used=new Set();
  const notes=[...S.notes.values()].sort((a,b)=>(a.title||'').localeCompare(b.title||''));
  for(const n of notes){const dir=n.folder?safeName(n.folder)+'/':'';let base=safeName(n.title),p=dir+base+'.md',i=2;
    while(used.has(p.toLowerCase()))p=dir+base+' ('+(i++)+').md';used.add(p.toLowerCase());files.push({path:p,text:n.body||''})}
  const tl=[...S.tasks.values()].sort((a,b)=>(a.status>b.status?1:-1)||(a.due||'9').localeCompare(b.due||'9'));
  const sec=(st,h)=>{const l=tl.filter(t=>t.status===st);return l.length?`## ${h}\n`+l.map(t=>{const nt=t.noteId&&S.notes.get(t.noteId);
    return `- [${st==='done'?'x':' '}] ${t.title}${t.start||t.due?` (${t.start||'…'} → ${t.due||'no due date'})`:''}${nt?` [[${nt.title}]]`:''}${t.assignee?` @${who(t.assignee)}`:''}`}).join('\n')+'\n\n':''};
  files.push({path:'Tasks.md',text:'# Tasks\n\n'+sec('doing','In progress')+sec('todo','To do')+sec('done','Done')});
  files.push({path:'.haiduc/backup.json',text:JSON.stringify({app:'Haiduc',version:1,exported:new Date().toISOString(),by:S.me,notes:notes,tasks:tl},null,1)});
  return files;
}
// minimal .zip writer (files stored without compression; Windows, macOS, iPhone and Android all open these)
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(b){let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
function makeZip(files){
  const enc=new TextEncoder(),parts=[],central=[];let off=0;const d=new Date();
  const dt=((d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>1))&0xFFFF,dd=(((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate())&0xFFFF;
  for(const f of files){const name=enc.encode('Haiduc/'+f.path),data=enc.encode(f.text),crc=crc32(data);
    const h=new DataView(new ArrayBuffer(30));h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(8,0,true);h.setUint16(10,dt,true);h.setUint16(12,dd,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);h.setUint16(28,0,true);
    parts.push(h.buffer,name,data);
    const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(10,0,true);c.setUint16(12,dt,true);c.setUint16(14,dd,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,off,true);
    central.push(c.buffer,name);off+=30+name.length+data.length}
  const csize=central.reduce((s,b)=>s+(b.byteLength||b.length),0);
  const e=new DataView(new ArrayBuffer(22));e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,csize,true);e.setUint32(16,off,true);
  return new Blob([...parts,...central,e.buffer],{type:'application/zip'})}
function bkStamp(kind){BK.last={at:Date.now(),kind};try{localStorage.setItem('haiduc.bk.last',JSON.stringify(BK.last))}catch(e){}}
async function downloadBackup(){
  const name=`Haiduc backup ${todayISO()}.zip`,blob=makeZip(backupFiles());
  const file=new File([blob],name,{type:'application/zip'});
  if(PH.matches&&navigator.canShare&&navigator.canShare({files:[file]})){
    try{await navigator.share({files:[file],title:name});bkStamp('zip');renderBackup();return}catch(e){if(e&&e.name==='AbortError')return}}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
  bkStamp('zip');renderBackup();toast('Backup downloaded: '+name);
}
// remember the chosen folder (browsers let us keep the folder "handle" in IndexedDB)
function idb(){return new Promise((res,rej)=>{const r=indexedDB.open('haiduc',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function kvGet(k){try{const db=await idb();return await new Promise(r=>{const q=db.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>r(null)})}catch(e){return null}}
async function kvSet(k,v){try{const db=await idb();await new Promise(r=>{const t=db.transaction('kv','readwrite');v===undefined?t.objectStore('kv').delete(k):t.objectStore('kv').put(v,k);t.oncomplete=r;t.onerror=r})}catch(e){}}
async function bkLoadDir(){if(!canFolder())return;BK.dir=await kvGet('bkDir')||null;if(BK.dir){try{BK.perm=await BK.dir.queryPermission({mode:'readwrite'})}catch(e){BK.perm='prompt'}}}
async function chooseFolder(){
  try{const d=await window.showDirectoryPicker({id:'haiduc-backup',mode:'readwrite',startIn:'documents'});
    BK.dir=d;BK.perm='granted';BK.written={};await kvSet('bkDir',d);try{localStorage.setItem('haiduc.bk.files','{}')}catch(e){}
    await syncFolder(true);}catch(e){if(e&&e.name!=='AbortError'){console.error(e);toast('Couldn\'t use that folder. Try another one, for example in Documents.')}}
  renderBackup()}
async function reconnectFolder(){if(!BK.dir)return;try{BK.perm=await BK.dir.requestPermission({mode:'readwrite'})}catch(e){BK.perm='denied'}if(BK.perm==='granted')await syncFolder(true);renderBackup()}
async function forgetFolder(){BK.dir=null;BK.perm=null;await kvSet('bkDir',undefined);renderBackup()}
async function writeFile(root,path,text){const parts=path.split('/');let dir=root;for(const p of parts.slice(0,-1))dir=await dir.getDirectoryHandle(p,{create:true});
  const fh=await dir.getFileHandle(parts[parts.length-1],{create:true});const w=await fh.createWritable();await w.write(text);await w.close()}
async function removeFile(root,path){try{const parts=path.split('/');let dir=root;for(const p of parts.slice(0,-1))dir=await dir.getDirectoryHandle(p);await dir.removeEntry(parts[parts.length-1])}catch(e){}}
async function syncFolder(manual){
  if(!BK.dir||BK.busy)return;
  if(BK.perm!=='granted'){try{BK.perm=await BK.dir.queryPermission({mode:'readwrite'})}catch(e){}if(BK.perm!=='granted'){if(manual)renderBackup();return}}
  BK.busy=true;let changed=0;
  try{const files=backupFiles(),now={};
    for(const f of files){const h=crc32(new TextEncoder().encode(f.text));now[f.path]=h;if(BK.written[f.path]!==h||manual&&f.path==='Tasks.md'){await writeFile(BK.dir,f.path,f.text);changed++}}
    // notes that were renamed, moved or deleted: remove the old file we wrote earlier
    for(const p of Object.keys(BK.written))if(!(p in now)){await removeFile(BK.dir,p);changed++}
    BK.written=now;try{localStorage.setItem('haiduc.bk.files',JSON.stringify(now))}catch(e){}
    bkStamp('folder');if(manual)toast(changed?`Saved to folder "${BK.dir.name}" (${changed} file${changed===1?'':'s'} updated)`:`Folder "${BK.dir.name}" is already up to date`);
  }catch(e){console.error(e);BK.perm=null;toast('Couldn\'t write to the backup folder. Open Backup to reconnect it.')}
  BK.busy=false;if(S.backupOpen)renderBackup()}
function bkAutoSoon(){if(!BK.dir||!BK.auto||BK.perm!=='granted')return;clearTimeout(BK.timer);BK.timer=setTimeout(()=>syncFolder(false),2500)}
function openBackup(){if(S.unsaved.size)flushSave();S.backupOpen=true;S.view='notes';S.phList=false;S.hist=null;$('app').classList.remove('drawer');renderAll()}
function renderBackup(){
  const v=$('noteView');if(!v||!S.backupOpen)return;v.dataset.id='';$('crumbs').textContent='Backup';
  for(const id of ['modeSeg','delBtn','histBtn','saveBtn','linksBtn'])$(id).hidden=true;
  const last=BK.last?`Last backup: ${fmtWhen(new Date(BK.last.at).toISOString())} (${BK.last.kind==='folder'?'folder':'download'})`:'No backup made on this device yet.';
  const nN=S.notes.size,nT=S.tasks.size;
  let folder='';
  if(canFolder()){
    if(!BK.dir)folder=`<p>Pick a folder on this computer, for example <b>Documents\\Haiduc</b>. Every note is saved there as a Markdown file, in a folder per group, and the folder is updated automatically while you work.</p><button class="btn primary" data-bk="choose">Choose a folder…</button>`;
    else if(BK.perm!=='granted')folder=`<p>Backup folder: <b>${esc(BK.dir.name)}</b>. Your browser needs your OK again to write to it.</p><div class="bk-row"><button class="btn primary" data-bk="reconnect">Allow access to "${esc(BK.dir.name)}"</button><button class="btn" data-bk="forget">Use a different folder</button></div>`;
    else folder=`<p>Backup folder: <b>${esc(BK.dir.name)}</b> · ${BK.busy?'saving…':'up to date'}</p>
      <label class="bk-auto"><input type="checkbox" id="bkAuto"${BK.auto?' checked':''}> Keep this folder updated automatically while Haiduc is open</label>
      <div class="bk-row"><button class="btn primary" data-bk="sync">Save to folder now</button><button class="btn" data-bk="choose">Choose another folder…</button><button class="btn" data-bk="forget">Stop using this folder</button></div>`;
  }else folder=`<p class="hint">Saving straight into a folder works in Chrome or Edge on a computer. ${PH.matches?'On a phone, use the download below and save it to Files.':'In this browser, use the download below.'}</p>`;
  v.innerHTML=`<div class="note-inner bk"><div class="hist-head"><h1 class="title-in" style="margin:0">Backup</h1><button class="btn" data-bk="close">Close</button></div>
    <p class="hint">${nN} note${nN===1?'':'s'} and ${nT} task${nT===1?'':'s'} · ${esc(last)}</p>
    <section class="bk-card"><h2>Download a backup</h2><p>One <b>.zip</b> file with every note as a Markdown file (a folder per group), a <b>Tasks.md</b> list, and a full copy for restoring.${PH.matches?' On iPhone, choose <b>Save to Files</b> to keep it in iCloud Drive or on the phone.':' It goes to your Downloads folder.'}</p>
      <button class="btn primary" data-bk="zip">${PH.matches?'Save backup…':'Download backup (.zip)'}</button></section>
    <section class="bk-card"><h2>Keep a folder on this computer up to date</h2>${folder}</section>
    <p class="hint">The files use the same format as Obsidian, so a backup folder can also be opened there. Backups only include what this device has loaded, so open Haiduc online first for the newest version.</p></div>`;
  const au=$('bkAuto');if(au)au.onchange=()=>{BK.auto=au.checked;try{localStorage.setItem('haiduc.bk.auto',JSON.stringify(BK.auto))}catch(e){}if(BK.auto)syncFolder(false)};
}
$('noteView').addEventListener('click',e=>{const b=e.target.closest('[data-bk]');if(!b||!S.backupOpen)return;const k=b.dataset.bk;
  if(k==='close'){S.backupOpen=false;renderAll()}else if(k==='zip')downloadBackup();else if(k==='choose')chooseFolder();
  else if(k==='reconnect')reconnectFolder();else if(k==='forget')forgetFolder();else if(k==='sync')syncFolder(true)});
$('backupBtn').onclick=openBackup;
$('menuBackup').onclick=()=>{setAddMenu(false);openBackup()};
bkLoadDir().then(()=>{if(BK.perm==='granted')bkAutoSoon()});

function boot(){
  if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'))navigator.serviceWorker.register('sw.js').catch(e=>console.warn('offline cache unavailable',e));
  $('tStart').value=todayISO();setTimeout(()=>setTv(S.tv),0);
  if(!CFG.SUPABASE_URL||!CFG.SUPABASE_ANON_KEY||CFG.SUPABASE_ANON_KEY.includes('YOUR-ANON-KEY')){showLogin('Haiduc is not connected yet: add your Supabase URL and anon key to config.js.',true);$('loginForm').hidden=true;return}
  sb=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY);
  let entered=false;
  sb.auth.onAuthStateChange((ev,session)=>{
    if(session&&!entered){entered=true;setTimeout(()=>enter(session),0)}
    if(!session&&ev==='SIGNED_OUT'){entered=false}
  });
  const hp=new URLSearchParams((location.hash||'').slice(1)+'&'+(location.search||'').slice(1));
  const linkErr=hp.get('error_description')||hp.get('error');
  // open straight away from the copy on this device (works with no internet), then refresh from the server
  const cached=lsJSON(CACHE_KEY,null);let fromCache=false;
  if(cached&&cached.me){showCached(cached);fromCache=true}
  const retryAuth=()=>sb.auth.getSession().then(({data})=>{if(data.session&&!entered){entered=true;enter(data.session)}else if(!data.session&&!entered&&navigator.onLine&&!fromCache)showLogin()});
  sb.auth.getSession().then(({data,error})=>{
    if(!data.session&&!entered&&fromCache&&(!navigator.onLine||(error&&isNetErr(error)))){
      setStatus();toast('You\'re offline. Showing what\'s saved on this device.');
      window.addEventListener('online',retryAuth,{once:true});return}
    if(!data.session&&!entered){
      if(fromCache){S.notes.clear();S.tasks.clear();S.me=null}
      showLogin(linkErr?('That sign-in link didn\'t work ('+linkErr.replace(/\+/g,' ')+'). It was probably expired or already used. Sign in with your password, or request a new link.'):'',!!linkErr);
      if(linkErr)history.replaceState(null,'',location.pathname);
    }
  });
}
boot();
})();
