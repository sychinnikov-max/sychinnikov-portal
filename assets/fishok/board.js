/* ═══════════════════════════════════════════════════════════
   FISHOK BOARD — переиспользуемый движок доски задач.
   Один движок на все виды: полная доска /fishok/tasks/ и доски отделов.
   Данные и конфиг берутся из window.FISHOK_BOARD (board-seed.js).

   Состояние доски ОДНО на весь портал (localStorage + один ключ KV):
   вид отдела это тот же движок, отфильтрованный по тегам отдела
   (opts.deptTags). Правка карточки в кабине отдела = правка на общей доске.

   Использование:
     FishokBoard.mount(el, {
       deptTags: ['продажи','сделка'],   // null/пусто = полная доска (все теги)
       defaultTag: 'продажи',            // тег новой карточки (по умолчанию)
       showTagFilters: false,            // чипы тегов (по умолч. только на полной доске)
       showExport: false,                // «Выгрузить для Claude» (по умолч. полная доска)
       showReset: false,                 // «Вернуть недельный сид» (по умолч. полная доска)
       fullBoardLink: '/fishok/tasks/'   // ссылка «Полная доска →» (для кабин отделов)
     });
   ═══════════════════════════════════════════════════════════ */
window.FishokBoard = (function () {
  var modalInjected = false;

  function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // единый модал на страницу (в body), общий для любого числа досок
  function injectModal(){
    if (modalInjected || document.getElementById('fkModalBack')) { modalInjected = true; return; }
    var el = document.createElement('div');
    el.className = 'modal-back'; el.id = 'fkModalBack';
    el.innerHTML =
      '<div class="modal">'+
      '<div class="modal-head"><span id="fkModalTitle">Новая задача</span><button class="del" id="fkModalClose" style="opacity:1;position:static;font-size:1.3rem;">✕</button></div>'+
      '<div class="modal-body">'+
      '<div><label>Название</label><input class="text-input" id="fkTitle" placeholder="Что нужно сделать"></div>'+
      '<div><label>Детали / следующий шаг</label><textarea class="text-input" id="fkDetail" rows="3" placeholder="Контекст, источник, следующий шаг"></textarea></div>'+
      '<div class="field-row"><div><label>Колонка</label><select class="select-input" id="fkColumn"></select></div><div><label>Рычаг</label><select class="select-input" id="fkTag"></select></div></div>'+
      '<div class="field-row"><div><label>Приоритет</label><select class="select-input" id="fkPrio"><option>P1</option><option>P2</option><option>P3</option></select></div><div><label>Владелец</label><input class="text-input" id="fkOwner" placeholder="Андрей / Кристапс / …"></div></div>'+
      '<div><label>Дедлайн (текст)</label><input class="text-input" id="fkDue" placeholder="2026-07-07 или пусто"></div>'+
      '<div><label>Результат / комментарий</label><textarea class="text-input" id="fkResult" rows="2" placeholder="Короткий итог: что получилось. Claude читает это на закрытии дня."></textarea></div>'+
      '</div>'+
      '<div class="modal-foot">'+
      '<button class="btn btn-ghost btn-sm" id="fkBtnDelete" style="margin-right:auto;color:var(--fk-red);border-color:#F0D2CB;">Удалить</button>'+
      '<button class="btn btn-ghost btn-sm" id="fkBtnCancel">Отмена</button>'+
      '<button class="btn btn-primary btn-sm" id="fkBtnSave">Сохранить</button>'+
      '</div></div>';
    document.body.appendChild(el);
    modalInjected = true;
  }

  function mount(root, opts){
    if(!root){ return; }
    var CFG = window.FISHOK_BOARD;
    if(!CFG){ root.innerHTML = '<p class="muted small">Доска: не загружен board-seed.js</p>'; return; }
    opts = opts || {};

    var STORE = CFG.store, VER_STORE = CFG.verStore, WAIT_OPEN_STORE = CFG.waitOpenStore;
    var SEED_VERSION = CFG.seedVersion, SYNC_URL = CFG.syncUrl, SYNC_ON = CFG.syncOn;
    var COLUMNS = CFG.columns, BOARD_COLUMNS = CFG.boardColumns, WAIT_NAME = CFG.waitName;
    var COL_TIPS = CFG.colTips, PRIO_SHORT = CFG.prioShort, PRIO_POP = CFG.prioPop;
    var TAGS = CFG.tags, SEED = CFG.seed;
    var COL_COLOR = {}; COLUMNS.forEach(function(c){ COL_COLOR[c.name]=c.color; });

    var deptTags = (opts.deptTags && opts.deptTags.length) ? opts.deptTags : null;
    var deptSet = deptTags ? new Set(deptTags) : null;
    var defaultTag = opts.defaultTag || (deptTags ? deptTags[0] : 'продажи');
    var showTagFilters = opts.showTagFilters != null ? opts.showTagFilters : !deptTags;
    var showExport = opts.showExport != null ? opts.showExport : !deptTags;
    var showReset  = opts.showReset  != null ? opts.showReset  : !deptTags;
    var fullBoardLink = opts.fullBoardLink || null;

    injectModal();

    // ---- разметка внутри root ----
    var controls =
      '<div class="board-controls flex between items-center wrap-flex" style="gap:1rem;margin-bottom:1rem;">'+
        '<span class="pill fk-totalpill"><span class="dot b"></span>—</span>'+
        '<div class="flex gap wrap-flex items-center">'+
          (fullBoardLink ? '<a class="btn btn-ghost btn-sm" href="'+fullBoardLink+'">↗ Полная доска</a>' : '')+
          (showExport ? '<button class="btn btn-ghost btn-sm fk-export" title="Скопировать снимок доски в буфер и скачать файл для Claude">⤓ Выгрузить для Claude</button>' : '')+
          (showReset  ? '<button class="btn btn-ghost btn-sm fk-reset">↺ Вернуть недельный сид</button>' : '')+
          '<button class="btn btn-primary btn-sm fk-add">+ Задача</button>'+
        '</div>'+
      '</div>';

    var banner =
      '<div class="seed-banner fk-seed-banner">'+
        '<span>🔄 <b>Claude обновил список задач.</b> Подтянуть свежую версию? Ваши комментарии-результаты сохранятся.</span>'+
        '<span class="sb-actions">'+
          '<button class="btn btn-ghost btn-sm fk-seed-later">Позже</button>'+
          '<button class="btn btn-primary btn-sm fk-seed-apply">Обновить доску</button>'+
        '</span>'+
      '</div>';

    var toolbar =
      '<div class="board-toolbar">'+
        '<input class="search-input fk-search" type="search" placeholder="Поиск по задачам…" style="min-width:200px;">'+
        (showTagFilters ? '<span class="soft xsmall" style="margin-left:.3rem;">Рычаг:</span><div class="flex gap wrap-flex fk-tagfilters"></div>' : '')+
        '<div class="spacer"></div>'+
        '<span class="soft xsmall">Приоритет:</span>'+
        '<div class="flex gap wrap-flex fk-priofilters"></div>'+
        '<span class="prio-legend"><button class="pq" type="button" aria-label="Как я выбираю приоритеты">?</button><div class="prio-pop fk-priopop"></div></span>'+
      '</div>';

    root.innerHTML = controls + banner + toolbar + '<div class="board fk-board"></div>';

    var elTotal   = root.querySelector('.fk-totalpill');
    var elBanner  = root.querySelector('.fk-seed-banner');
    var elSearch  = root.querySelector('.fk-search');
    var elTagF    = root.querySelector('.fk-tagfilters');
    var elPrioF   = root.querySelector('.fk-priofilters');
    var elPrioPop = root.querySelector('.fk-priopop');
    var board     = root.querySelector('.fk-board');

    // ---- state ----
    var hadStored=false;
    var filterTags = new Set();
    var filterPrio = new Set();
    var searchQ = '';
    var editingId = null;
    var waitOpen = false; try{ waitOpen = localStorage.getItem(WAIT_OPEN_STORE)==='1'; }catch(e){}

    function uid(){ return 'c' + Date.now().toString(36) + Math.floor(Math.random()*1e4).toString(36); }
    function stableId(title){ var h=0,s=title||''; for(var i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; } return 'ft'+(h>>>0).toString(36); }
    function norm(s){ return (s||'').toLowerCase().replace(/\s+/g,' ').trim(); }
    function seedState(){ return SEED.map(function(c){ var o=Object.assign({}, c); o.id=c.id||stableId(c.title); o.result=c.result||''; return o; }); }
    function load(){
      try { var raw = localStorage.getItem(STORE); if(raw){ hadStored=true; var arr=JSON.parse(raw); arr.forEach(function(c){ if(c.result===undefined) c.result=''; }); return arr; } } catch(e){}
      return seedState();
    }
    var state = load();
    if(!hadStored){ try{ localStorage.setItem(VER_STORE, SEED_VERSION); }catch(e){} }

    // снимок доски для Claude — всегда ВСЯ доска (state = полный набор карточек)
    function boardSnapshot(){
      return { app:'fishok-board', seedVersion:SEED_VERSION, exportedAt:new Date().toISOString(),
        cards: state.map(function(c){ return {id:c.id,title:c.title,column:c.column,tag:c.tag,priority:c.priority,owner:c.owner||'',due:c.due||'',detail:c.detail||'',result:c.result||''}; }) };
    }
    function mirror(){
      if(!SYNC_ON) return;
      clearTimeout(mirror._t);
      mirror._t=setTimeout(function(){
        try{ fetch(SYNC_URL,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(boardSnapshot())}).catch(function(){}); }catch(e){}
      }, 5000);
    }
    function save(){ try { localStorage.setItem(STORE, JSON.stringify(state)); } catch(e){} mirror(); }

    function mergeSeed(){
      var byId={}, byTitle={};
      state.forEach(function(c){ byId[c.id]=c; byTitle[norm(c.title)]=c; });
      var seedIds={}, seedTitles={};
      var merged=SEED.map(function(s){
        var o=Object.assign({}, s); o.id=s.id||stableId(s.title); o.result=s.result||'';
        seedIds[o.id]=1; seedTitles[norm(s.title)]=1;
        var u=byId[o.id]||byTitle[norm(s.title)];
        if(u){ if(u.result) o.result=u.result; if(u.column) o.column=u.column; }
        return o;
      });
      state.forEach(function(c){ if(!seedIds[c.id] && !seedTitles[norm(c.title)]) merged.push(c); });
      state=merged; save(); try{ localStorage.setItem(VER_STORE, SEED_VERSION); }catch(e){}
    }

    // ---- filters ----
    function inScope(c){ return !deptSet || deptSet.has(c.tag); }
    function visible(c){
      if(!inScope(c)) return false;
      if(filterTags.size && !filterTags.has(c.tag)) return false;
      if(filterPrio.size && !filterPrio.has(c.priority)) return false;
      if(searchQ){ var q=searchQ.toLowerCase(); if((c.title+' '+(c.detail||'')+' '+(c.owner||'')).toLowerCase().indexOf(q)<0) return false; }
      return true;
    }

    if(showTagFilters && elTagF){
      Object.keys(TAGS).forEach(function(t){
        var b=document.createElement('button'); b.className='filter-chip'; b.textContent=t; b.dataset.tag=t;
        b.onclick=function(){ if(filterTags.has(t)){filterTags.delete(t); b.classList.remove('active');} else {filterTags.add(t); b.classList.add('active');} render(); };
        elTagF.appendChild(b);
      });
    }
    ['P1','P2','P3'].forEach(function(p){
      var b=document.createElement('button'); b.className='filter-chip'; b.textContent=p;
      b.onclick=function(){ if(filterPrio.has(p)){filterPrio.delete(p); b.classList.remove('active');} else {filterPrio.add(p); b.classList.add('active');} render(); };
      elPrioF.appendChild(b);
    });
    if(elPrioPop) elPrioPop.innerHTML = PRIO_POP;

    // ---- render ----
    function render(){
      board.innerHTML='';
      var totalVisible=0;
      var scopeTotal = state.filter(inScope).length;
      BOARD_COLUMNS.forEach(function(name){
        var color=COL_COLOR[name]||'#8A97A6';
        var cards = state.filter(function(c){ return c.column===name && visible(c); });
        totalVisible += cards.length;
        var colEl=document.createElement('div');
        colEl.className='col'; colEl.dataset.col=name;
        var allInCol = state.filter(function(c){ return c.column===name && inScope(c); }).length;
        var countStr = cards.length+(cards.length!==allInCol?'/'+allInCol:'');
        colEl.innerHTML='<div class="col-head"><span class="cdot" style="background:'+color+'"></span><span class="name">'+name+'</span><span class="ci">?</span><span class="count">'+countStr+'</span><div class="col-tip">'+(COL_TIPS[name]||'')+'</div></div>';
        var cc=document.createElement('div'); cc.className='col-cards';
        cards.forEach(function(c){ cc.appendChild(cardEl(c)); });
        var add=document.createElement('button'); add.className='add-card'; add.textContent='+ добавить';
        add.onclick=function(){ openModal(null, name); };
        colEl.appendChild(cc); colEl.appendChild(add);

        if(name==='Бэклог'){ var wd=buildWaitDrawer(); totalVisible+=wd.count; colEl.appendChild(wd.drawer); }

        colEl.addEventListener('dragover', function(e){ e.preventDefault(); colEl.classList.add('drag-over'); });
        colEl.addEventListener('dragleave', function(){ colEl.classList.remove('drag-over'); });
        colEl.addEventListener('drop', function(e){ e.preventDefault(); colEl.classList.remove('drag-over');
          var id=e.dataTransfer.getData('text/plain'); var card=state.find(function(x){return x.id===id;});
          if(card && card.column!==name){ card.column=name; save(); render(); }
        });
        board.appendChild(colEl);
      });
      elTotal.innerHTML='<span class="dot b"></span>'+totalVisible+' из '+scopeTotal+' задач';
    }

    function buildWaitDrawer(){
      var waitCards = state.filter(function(c){ return c.column===WAIT_NAME && visible(c); });
      var allWait = state.filter(function(c){ return c.column===WAIT_NAME && inScope(c); }).length;
      var cntStr = waitCards.length+(waitCards.length!==allWait?'/'+allWait:'');
      var drawer=document.createElement('div');
      drawer.className='wait-drawer'+(waitOpen?' open':'');
      var toggle=document.createElement('button'); toggle.className='wait-toggle'; toggle.type='button';
      toggle.innerHTML='<span class="chev">▸</span><span class="cdot" style="background:'+(COL_COLOR[WAIT_NAME]||'#C77A1A')+'"></span><span class="name">Ждет</span><span class="ci">?</span><span class="count">'+cntStr+'</span><div class="col-tip">'+(COL_TIPS[WAIT_NAME]||'')+'</div>';
      toggle.onclick=function(){ waitOpen=!waitOpen; try{ localStorage.setItem(WAIT_OPEN_STORE, waitOpen?'1':'0'); }catch(e){} drawer.classList.toggle('open', waitOpen); };
      var cc=document.createElement('div'); cc.className='wait-cards';
      waitCards.forEach(function(c){ cc.appendChild(cardEl(c)); });
      drawer.appendChild(toggle); drawer.appendChild(cc);
      drawer.addEventListener('dragover', function(e){ e.preventDefault(); e.stopPropagation(); drawer.classList.add('drag-over'); });
      drawer.addEventListener('dragleave', function(e){ e.stopPropagation(); drawer.classList.remove('drag-over'); });
      drawer.addEventListener('drop', function(e){ e.preventDefault(); e.stopPropagation(); drawer.classList.remove('drag-over');
        var id=e.dataTransfer.getData('text/plain'); var card=state.find(function(x){return x.id===id;});
        if(card && card.column!==WAIT_NAME){ card.column=WAIT_NAME; if(!waitOpen){ waitOpen=true; try{ localStorage.setItem(WAIT_OPEN_STORE,'1'); }catch(e){} } save(); render(); }
      });
      return { drawer: drawer, count: waitCards.length };
    }

    function cardEl(c){
      var t=TAGS[c.tag]||{cls:'sys',b:'b-sys'};
      var el=document.createElement('div');
      el.className='tcard '+t.b; el.draggable=true; el.dataset.id=c.id;
      var due = c.due ? '<span class="due">'+esc(c.due)+'</span>' : '<span></span>';
      var pcls = c.priority==='P1'?'p1':(c.priority==='P2'?'p2':'p3');
      el.innerHTML =
        '<button class="del" title="Удалить">✕</button>'+
        '<div class="row1"><span class="tag '+t.cls+'">'+esc(c.tag)+'</span><span class="tag '+pcls+'" title="'+esc(PRIO_SHORT[c.priority]||'')+'">'+esc(c.priority)+'</span></div>'+
        '<div class="ttl">'+esc(c.title)+'</div>'+
        (c.detail?'<div class="dt">'+esc(c.detail)+'</div>':'')+
        '<div class="meta"><span class="owner">◍ '+esc(c.owner||'—')+'</span>'+due+'</div>'+
        '<div class="result-slot"></div>';
      el.addEventListener('dragstart', function(e){ e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed='move'; el.classList.add('dragging'); });
      el.addEventListener('dragend', function(){ el.classList.remove('dragging'); });
      el.querySelector('.del').onclick=function(ev){ ev.stopPropagation(); if(confirm('Удалить задачу?')){ state=state.filter(function(x){return x.id!==c.id;}); save(); render(); } };
      el.addEventListener('click', function(){ openModal(c, c.column); });
      renderResultSlot(el, c);
      return el;
    }

    function renderResultSlot(el, c){
      var slot=el.querySelector('.result-slot'); if(!slot) return; slot.innerHTML='';
      if(c.result){
        var box=document.createElement('div'); box.className='result-box'; box.title='Результат. Клик чтобы изменить';
        var ico=document.createElement('span'); ico.className='rico'; ico.textContent='💬';
        var txt=document.createElement('span'); txt.className='rtext'; txt.textContent=c.result;
        box.appendChild(ico); box.appendChild(txt);
        box.onclick=function(ev){ ev.stopPropagation(); startResultEdit(el,c,slot); };
        slot.appendChild(box);
      } else {
        var add=document.createElement('button'); add.className='result-add'; add.type='button'; add.textContent='＋ результат';
        add.onclick=function(ev){ ev.stopPropagation(); startResultEdit(el,c,slot); };
        slot.appendChild(add);
      }
    }
    function startResultEdit(el, c, slot){
      el.draggable=false; slot.innerHTML='';
      var ta=document.createElement('textarea'); ta.className='result-edit'; ta.value=c.result||'';
      ta.placeholder='Короткий итог: что получилось';
      ta.onclick=function(ev){ ev.stopPropagation(); };
      ta.onmousedown=function(ev){ ev.stopPropagation(); };
      var done=function(){ c.result=ta.value.trim(); save(); el.draggable=true; renderResultSlot(el,c); };
      ta.onblur=done;
      ta.onkeydown=function(ev){
        if(ev.key==='Enter' && (ev.metaKey||ev.ctrlKey)){ ev.preventDefault(); ta.blur(); }
        else if(ev.key==='Escape'){ ev.preventDefault(); ta.value=c.result||''; ta.blur(); }
      };
      slot.appendChild(ta); ta.focus(); try{ ta.selectionStart=ta.selectionEnd=ta.value.length; }catch(e){}
    }

    // ---- modal (общий в body) ----
    var modalBack=document.getElementById('fkModalBack');
    var fTitle=document.getElementById('fkTitle'), fDetail=document.getElementById('fkDetail'),
        fColumn=document.getElementById('fkColumn'), fTag=document.getElementById('fkTag'),
        fPrio=document.getElementById('fkPrio'), fOwner=document.getElementById('fkOwner'), fDue=document.getElementById('fkDue'),
        fResult=document.getElementById('fkResult');
    // опции селектов (перезаполняем при каждом mount — безвредно)
    fColumn.innerHTML=''; COLUMNS.forEach(function(col){ var o=document.createElement('option'); o.value=col.name; o.textContent=col.name; fColumn.appendChild(o); });
    fTag.innerHTML=''; Object.keys(TAGS).forEach(function(t){ var o=document.createElement('option'); o.value=t; o.textContent=t; fTag.appendChild(o); });

    function openModal(card, colName){
      editingId = card ? card.id : null;
      document.getElementById('fkModalTitle').textContent = card ? 'Задача' : 'Новая задача';
      document.getElementById('fkBtnDelete').style.display = card ? 'inline-flex' : 'none';
      fTitle.value = card?card.title:''; fDetail.value = card?(card.detail||''):'';
      fColumn.value = colName || (card?card.column:COLUMNS[0].name);
      fTag.value = card?card.tag:defaultTag; fPrio.value = card?card.priority:'P2';
      fOwner.value = card?(card.owner||''):'Андрей'; fDue.value = card?(card.due||''):'';
      fResult.value = card?(card.result||''):'';
      // навесить обработчики на текущий mount (перезапись — ок)
      document.getElementById('fkBtnSave').onclick=saveModal;
      document.getElementById('fkBtnDelete').onclick=deleteFromModal;
      document.getElementById('fkBtnCancel').onclick=closeModal;
      document.getElementById('fkModalClose').onclick=closeModal;
      modalBack.classList.add('open'); setTimeout(function(){ fTitle.focus(); }, 40);
    }
    function closeModal(){ modalBack.classList.remove('open'); editingId=null; }
    function saveModal(){
      var title=fTitle.value.trim(); if(!title){ fTitle.focus(); return; }
      var data={ title:title, detail:fDetail.value.trim(), column:fColumn.value, tag:fTag.value, priority:fPrio.value, owner:fOwner.value.trim(), due:fDue.value.trim(), result:fResult.value.trim() };
      if(editingId){ var c=state.find(function(x){return x.id===editingId;}); if(c) Object.assign(c,data); }
      else { data.id=uid(); state.push(data); }
      save(); render(); closeModal();
    }
    function deleteFromModal(){ if(editingId && confirm('Удалить задачу?')){ state=state.filter(function(x){return x.id!==editingId;}); save(); render(); closeModal(); } }
    modalBack.addEventListener('click', function(e){ if(e.target===modalBack) closeModal(); });
    document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeModal(); });

    // ---- controls ----
    var elAdd=root.querySelector('.fk-add'); if(elAdd) elAdd.onclick=function(){ openModal(null, 'Эта неделя'); };
    var elReset=root.querySelector('.fk-reset'); if(elReset) elReset.onclick=function(){ if(confirm('Вернуть недельный сид? Ваши изменения на доске будут заменены свежим списком из системы.')){ state=seedState(); save(); try{ localStorage.setItem(VER_STORE, SEED_VERSION); }catch(e){} elBanner.classList.remove('show'); render(); } };
    elSearch.addEventListener('input', function(e){ searchQ=e.target.value; render(); });

    var elExport=root.querySelector('.fk-export');
    if(elExport) elExport.onclick=function(){
      var snap=JSON.stringify(boardSnapshot(), null, 2);
      if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(snap).catch(function(){}); }
      try{ var blob=new Blob([snap],{type:'application/json'}); var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='fishok-board.json'; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 100); }catch(e){}
      var b=this, old=b.textContent; b.textContent='✓ Скопировано + файл'; setTimeout(function(){ b.textContent=old; }, 1800);
    };

    // баннер свежего сида от Claude
    (function(){
      var storedV=null; try{ storedV=localStorage.getItem(VER_STORE); }catch(e){}
      if(hadStored && storedV!==SEED_VERSION){ elBanner.classList.add('show'); }
      root.querySelector('.fk-seed-apply').onclick=function(){ mergeSeed(); elBanner.classList.remove('show'); render(); };
      root.querySelector('.fk-seed-later').onclick=function(){ elBanner.classList.remove('show'); };
    })();

    // немедленная отправка снимка при уходе со страницы
    function mirrorNow(){ if(!SYNC_ON) return; try{ fetch(SYNC_URL,{method:'PUT',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify(boardSnapshot())}).catch(function(){}); }catch(e){} }
    document.addEventListener('visibilitychange', function(){ if(document.visibilityState==='hidden') mirrorNow(); });
    window.addEventListener('pagehide', mirrorNow);

    render();
  }

  return { mount: mount };
})();
