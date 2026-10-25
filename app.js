(function(){
const $=id=>document.getElementById(id);
const CFG=window.VAULT_CONFIG||{};
const PH=window.matchMedia('(max-width:720px)');
const S={hist:null,tv:(()=>{try{return localStorage.getItem('haiduc.tv')==='gantt'?'gantt':'board'}catch(e){return 'board'}})(),editDates:null,unsaved:new Map(),phList:true,notes:new Map(),tasks:new Map(),cur:null,view:'notes',mode:'read',q:'',me:null,dirty:false,live:false};
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
function draftPut(n){try{localStorage.setItem(DRAFT+n.id,JSON.stringify({title:n.title,body:n.body,at:Date.now(),createdAt:n.createdAt||Date.now()}))}catch(e){}}
function draftDel(id){try{localStorage.removeItem(DRAFT+id)}catch(e){}}
function draftsAll(){const out={};try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith(DRAFT)){try{out[k.slice(DRAFT.length)]=JSON.parse(localStorage.getItem(k))}catch(e){}}}}catch(e){}return out}
function markDirty(n){S.unsaved.set(n.id,(S.unsaved.get(n.id)||0)+1);draftPut(n);setSaveState('dirty');clearTimeout(saveTimer);saveTimer=setTimeout(flushSave,1200)}
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
      n.updatedAt=Date.now();n.updatedBy=S.me;
      let res;try{res=await sb.from('notes').upsert({id:n.id,title:n.title||'Untitled',body:n.body||'',updated_at:new Date(n.updatedAt).toISOString(),updated_by:S.me})}catch(e){res={error:e}}
      if(res.error){failed=true;console.error(res.error);continue}
      if(S.unsaved.get(id)===ver){S.unsaved.delete(id);draftDel(id)}
    }
    return failed;
  })();
  const failed=await saving;saving=null;
  if(again){again=false;return flushSave()}
  if(failed){setSaveState('error');retryTimer=setTimeout(flushSave,5000)}
  else if(S.unsaved.size){setSaveState('dirty');saveTimer=setTimeout(flushSave,400)}
  else setSaveState('saved');
  renderList();
}
function setSaveState(st){
  saveState=st;const b=$('saveBtn');
  if(b){b.dataset.state=st;const L={dirty:['Save','Save'],saving:['Saving…','…'],saved:['Saved ✓','✓'],error:['Not saved · Retry','Retry']}[st];b.innerHTML=`<span class="sv-l">${L[0]}</span><span class="sv-s">${L[1]}</span>`;b.title=L[0];b.disabled=st==='saving'||st==='saved'}
  setStatus();
}
function setStatus(){const s=$('status');
  if(!S.live){s.textContent='connecting…';s.className='status';return}
  s.textContent={dirty:'unsaved changes',saving:'saving…',saved:'all saved',error:'not saved, retrying'}[saveState];
  s.className='status'+(saveState==='error'?' off':'');
}
async function createNote(title){
  let t=(title||'Untitled').trim()||'Untitled';
  if(!title){let i=1;while(byTitle(t))t='Untitled '+(++i)}
  const id=newId('n');const now=Date.now();
  const note={id,title:t,body:'',createdAt:now,updatedAt:now,updatedBy:S.me};S.notes.set(id,note);open(id,'edit');
  markDirty(note);flushSave();
  setTimeout(()=>{const ti=$('titleIn');if(ti&&!title){ti.focus();ti.select()}},30);
}
async function saveTask(t){
  S.tasks.set(t.id,t);renderBoard();renderCounts();renderLinks();
  let row=toTask(t),res=await sb.from('tasks').upsert(row);
  if(res.error&&/start_date/.test(res.error.message||'')){S.noStartCol=true;delete row.start_date;res=await sb.from('tasks').upsert(row);
    toast('Start dates can\'t be stored yet. Run the small database update in Supabase (SQL Editor).')}
  if(res.error){console.error(res.error);toast('Could not save task. Check your connection.')}
}
/* ---------- dates ---------- */
function todayISO(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)}
function msISO(ms){const d=new Date(ms||Date.now());return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)}
const d2n=s=>{const [y,m,d]=s.split('-').map(Number);return Math.round(Date.UTC(y,m-1,d)/864e5)};
const n2d=n=>new Date(n*864e5).toISOString().slice(0,10);
const fmtD=s=>s?new Date(s+'T00:00').toLocaleDateString(undefined,{day:'numeric',month:'short'}):'';
function taskSpan(t){const s=t.start||(t.due&&msISO(t.createdAt)<=t.due?msISO(t.createdAt):t.due)||msISO(t.createdAt);const e=t.due&&t.due>=s?t.due:s;return{s:d2n(s),e:d2n(e),noStart:!t.start,noDue:!t.due}}

/* ---------- rendering ---------- */
function renderAll(){renderList();renderMain();renderLinks();renderCounts();setStatus()}
function renderCounts(){const open=[...S.tasks.values()].filter(t=>t.status!=='done').length;$('tbCount').textContent=open?open:'';$('cNotes').textContent=S.notes.size;$('cTasks').textContent=[...S.tasks.values()].filter(t=>t.status!=='done').length}
function renderList(){
  const ul=$('list');const q=S.q.trim().toLowerCase();
  const tl=$('tagList');if(tl){const tags=allTags();tl.innerHTML=tags.map(([t,c])=>`<button class="tag${q==='#'+t?' on':''}" data-tag="${esc(t)}">#${esc(t)} <span>${c}</span></button>`).join('');tl.hidden=!tags.length}
  let notes=sortedNotes();if(q.startsWith('#')&&q.length>1){const t=q.slice(1);notes=notes.filter(n=>tagsIn(n.body).has(t))}else if(q)notes=notes.filter(n=>(n.title||'').toLowerCase().includes(q)||(n.body||'').toLowerCase().includes(q));
  $('listLabel').textContent=q?`${notes.length} match${notes.length===1?'':'es'}`:'All notes';
  if(!notes.length){ul.innerHTML=`<li class="empty">${q?'No notes match that search.':(S.live?'No notes yet. Press + Note to start.':'Loading notes…')}</li>`;return}
  ul.innerHTML=notes.map(n=>{
    const m=ago(n.updatedAt)+(n.updatedBy&&who(n.updatedBy)!=='you'?' · '+who(n.updatedBy):'');
    return `<li><button data-id="${esc(n.id)}" aria-current="${S.view==='notes'&&n.id===S.cur}"><span class="t">${esc(n.title||'Untitled')}</span><span class="m">${esc(m)}</span></button></li>`}).join('');
}
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
function renderMarkdown(src){
  src=mapOutsideCode(src,t=>t.replace(TAG_RE,(m,pre,tag)=>`${pre}<a class="tag" data-tag="${esc(tag.toLowerCase())}">#${esc(tag)}</a>`));
  const withLinks=(src||'').replace(/\[\[([^\[\]|]+)(?:\|([^\[\]]*))?\]\]/g,(m,t,alias)=>{
    t=t.trim();const ex=byTitle(t);return `<a class="wl${ex?'':' missing'}" data-note="${esc(t)}">${esc((alias||t).trim())}</a>`});
  const html=marked.parse(withLinks,{gfm:true,breaks:true});
  return DOMPurify.sanitize(html,{ADD_ATTR:['data-note','data-tag']}).replace(/==([^=\n]+)==/g,'<mark>$1</mark>');
}
function renderMain(){
  const phone=PH.matches;
  $('app').classList.toggle('ph-list',phone&&S.view==='notes'&&(S.phList||(!S.notes.get(S.cur)&&!(S.hist&&S.hist.noteId==='__deleted'))));
  $('tabbar').hidden=!phone||$('app').hidden;
  $('tbNotes').setAttribute('aria-pressed',S.view==='notes');$('tbTasks').setAttribute('aria-pressed',S.view==='tasks');
  $('app').classList.toggle('tasks-mode',S.view==='tasks');
  $('navNotes').setAttribute('aria-pressed',S.view==='notes');$('navTasks').setAttribute('aria-pressed',S.view==='tasks');
  $('noteView').hidden=S.view!=='notes';$('taskView').hidden=S.view!=='tasks';
  const n=S.notes.get(S.cur);
  $('modeSeg').hidden=S.view!=='notes'||!n;$('delBtn').hidden=S.view!=='notes'||!n;$('histBtn').hidden=S.view!=='notes'||!n;$('histBtn').setAttribute('aria-pressed',!!(S.hist&&n&&S.hist.noteId===n.id));$('saveBtn').hidden=S.view!=='notes'||!n;setSaveState(saveState);$('linksBtn').hidden=S.view!=='notes'||!n;
  $('delBtn').classList.remove('arm');$('delBtn').textContent='Delete';
  if(S.view==='tasks'){$('crumbs').textContent='Tasks';renderBoard();return}
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
      <button type="button" data-f="h1" title="Heading 1">H1</button><button type="button" data-f="h2" title="Heading 2">H2</button><button type="button" data-f="h3" title="Heading 3">H3</button>
      <button type="button" data-f="b" title="Bold"><b>B</b></button><button type="button" data-f="i" title="Italic"><i>I</i></button>
      <button type="button" data-f="ul" title="List">• List</button><button type="button" data-f="todo" title="To-do">☐ To-do</button>
      <button type="button" data-f="link" title="Link to note">[[ ]]</button><button type="button" data-f="tag" title="Tag">#</button>
    </div>
    <div class="editor"><pre class="hl" id="bodyHl" aria-hidden="true"></pre><textarea class="body" id="bodyIn" aria-label="Note text" placeholder="Start writing…" spellcheck="true">${esc(n.body)}</textarea></div>
    <div class="hint"><code>[[Other note]]</code> link · <code>#tag</code> · <code># Heading</code> · <code>- [ ] to-do</code> · <code>**bold**</code> · <code>==highlight==</code></div></div>`;
    const eid=n.id;
    $('titleIn').oninput=e=>{const cur=S.notes.get(eid);if(!cur)return;cur.title=e.target.value;$('crumbs').textContent='Notes / '+(cur.title||'Untitled');markDirty(cur)};
    $('bodyIn').oninput=e=>{const cur=S.notes.get(eid);if(!cur)return;cur.body=e.target.value;paintHl();autosize(e.target);markDirty(cur)};
    $('fmtBar').onmousedown=e=>e.preventDefault();
    $('fmtBar').onclick=e=>{const b=e.target.closest('[data-f]');if(b)applyFmt(b.dataset.f)};
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
  const wrap=(o,c,ph)=>{const sel=v.slice(s,e)||ph;set(o+sel+c,s,e,s+o.length,s+o.length+sel.length)};
  if(f==='h1')heading(1);else if(f==='h2')heading(2);else if(f==='h3')heading(3);
  else if(f==='b')wrap('**','**','bold text');else if(f==='i')wrap('*','*','italic text');
  else if(f==='ul')prefix('- ');else if(f==='todo')prefix('- [ ] ');
  else if(f==='link')wrap('[[',']]','Note name');
  else if(f==='tag'){const sel=v.slice(s,e).replace(/\s+/g,'-')||'tag';set('#'+sel,s,e,s+1,s+1+sel.length)}
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
    if(b.dataset.arm){S.tasks.delete(t.id);renderBoard();renderCounts();await run(sb.from('tasks').delete().eq('id',t.id),'task')}
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

function open(id,mode){S.hist=null;if(S.unsaved.size)flushSave();S.cur=id;S.phList=false;S.view='notes';if(mode)S.mode=mode;lsSet('vault.cur',id);$('app').classList.remove('drawer');renderAll();$('noteView').scrollTop=0}
$('list').addEventListener('click',e=>{const b=e.target.closest('button[data-id]');if(b)open(b.dataset.id,'read')});
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
$('navNotes').onclick=()=>{if(S.unsaved.size)flushSave();S.view='notes';renderAll()};
$('navTasks').onclick=()=>{if(S.unsaved.size)flushSave();S.view='tasks';$('app').classList.remove('drawer');renderAll()};
$('mEdit').onclick=()=>{S.hist=null;S.mode='edit';renderMain();setTimeout(()=>$('bodyIn')&&$('bodyIn').focus(),20)};
$('mRead').onclick=()=>{S.hist=null;if(S.unsaved.size)flushSave();S.mode='read';renderMain();renderLinks()};
$('newNote').onclick=()=>createNote();
$('saveBtn').onclick=()=>{const n=S.notes.get(S.cur);if(n&&!S.unsaved.size)return;flushSave()};
$('q').oninput=e=>{S.q=e.target.value;renderList()};
$('tagList').addEventListener('click',e=>{const b=e.target.closest('[data-tag]');if(!b)return;const t=b.dataset.tag;if(S.q==='#'+t){S.q='';$('q').value='';renderList()}else showTag(t)});
$('menuBtn').onclick=()=>{if(S.unsaved.size)flushSave();S.phList=true;S.mode='read';renderAll()};
$('tbNotes').onclick=()=>{if(S.unsaved.size)flushSave();S.view='notes';S.phList=true;renderAll()};
$('tbTasks').onclick=()=>{if(S.unsaved.size)flushSave();S.view='tasks';renderAll()};
$('tbNew').onclick=()=>{if(S.view==='tasks'){const t=$('tTitle');t.scrollIntoView({block:'center'});t.focus();}else createNote()};
PH.addEventListener('change',()=>renderAll());
$('linksBtn').onclick=()=>$('app').classList.toggle('show-links');
document.addEventListener('click',e=>{const app=$('app');if(app.classList.contains('drawer')&&!e.target.closest('#side')&&!e.target.closest('#menuBtn'))app.classList.remove('drawer')});
$('delBtn').onclick=async()=>{
  const b=$('delBtn');const n=S.notes.get(S.cur);if(!n)return;
  if(!b.classList.contains('arm')){b.classList.add('arm');b.textContent='Confirm delete';setTimeout(()=>{b.classList.remove('arm');b.textContent='Delete'},3000);return}
  S.unsaved.delete(n.id);draftDel(n.id);S.notes.delete(n.id);S.cur=null;renderAll();await run(sb.from('notes').delete().eq('id',n.id),'note');toast('Note deleted');
};
document.addEventListener('keydown',e=>{
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
    if(isNotes&&(isTyping(d.id)||staleForMe(d,S.notes.get(d.id))))return;
    map.set(d.id,d);if(isNotes&&d.id===S.cur)$('noteView').dataset.id=''}
  if(isNotes)renderAll();else{renderCounts();renderLinks();if(S.view==='tasks')renderBoard()}
}
async function loadAll(){
  const [n,t]=await Promise.all([sb.from('notes').select('*'),sb.from('tasks').select('*')]);
  if(n.error||t.error){toast('Could not load your notes. Reload the page.');return}
  const fresh=new Map(n.data.map(r=>[r.id,fromNote(r)]));
  // never let server data replace text that hasn't reached the server yet
  for(const id of S.unsaved.keys()){const local=S.notes.get(id);if(local)fresh.set(id,local)}
  for(const [id,srv] of fresh){const local=S.notes.get(id);if(local&&local!==srv&&staleForMe(srv,local))fresh.set(id,local)}
  let restored=0;const drafts=draftsAll();
  for(const [id,d] of Object.entries(drafts)){
    if(S.unsaved.has(id)||!d)continue;const srv=fresh.get(id);
    if(srv&&(srv.updatedAt>=d.at||(srv.body===d.body&&srv.title===d.title))){draftDel(id);continue}
    const note=srv?{...srv,title:d.title,body:d.body}:{id,title:d.title||'Untitled',body:d.body||'',createdAt:d.createdAt||d.at,updatedAt:d.at,updatedBy:S.me};
    fresh.set(id,note);S.unsaved.set(id,1);restored++;
  }
  S.notes=fresh;S.tasks=new Map(t.data.map(r=>[r.id,fromTask(r)]));
  if(!S.cur||!S.notes.has(S.cur)){const last=lsGet('vault.cur');S.cur=last&&S.notes.has(last)?last:(S.notes.size?sortedNotes()[0].id:null)}
  S.live=true;renderAll();
  if(restored)toast(restored===1?'Restored 1 note that hadn\'t been saved yet. Saving it now.':'Restored '+restored+' notes that hadn\'t been saved yet. Saving them now.');
  if(S.unsaved.size)flushSave();
}
function subscribe(){
  if(channel)sb.removeChannel(channel);
  channel=sb.channel('vault')
    .on('postgres_changes',{event:'*',schema:'public',table:'notes'},p=>onChange('notes',p))
    .on('postgres_changes',{event:'*',schema:'public',table:'tasks'},p=>onChange('tasks',p))
    .subscribe(st=>{if(st==='SUBSCRIBED'&&S.live)loadAll()});
}
// refresh after the tab was asleep (laptop lid, phone background)
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){if(S.unsaved.size)flushSave()}else if(S.live)loadAll()});
window.addEventListener('online',()=>{if(S.unsaved.size)flushSave()});

/* ---------- auth ---------- */
function showLogin(msg,isErr){
  $('app').hidden=true;$('login').hidden=false;$('tabbar').hidden=true;
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
$('signOut').onclick=async()=>{if(S.unsaved.size)await flushSave();if(channel)sb.removeChannel(channel);await sb.auth.signOut();S.notes.clear();S.tasks.clear();S.live=false;showLogin()};

function boot(){
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
  sb.auth.getSession().then(({data})=>{
    if(!data.session&&!entered){
      showLogin(linkErr?('That sign-in link didn\'t work ('+linkErr.replace(/\+/g,' ')+'). It was probably expired or already used. Sign in with your password, or request a new link.'):'',!!linkErr);
      if(linkErr)history.replaceState(null,'',location.pathname);
    }
  });
}
boot();
})();
