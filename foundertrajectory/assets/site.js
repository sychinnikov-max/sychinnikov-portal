/* Founder Trajectory — общий скрипт многостраничника.
   Подключается на каждой странице. Аналитика: Я.Метрика 109611431 + GA4. Форма → Web3Forms. */
(function(){
  var variant=(document.body&&document.body.dataset&&document.body.dataset.variant)||'site';

  /* появление блоков при прокрутке */
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{threshold:.14});
    document.querySelectorAll('.rv').forEach(function(el){io.observe(el);});
  }else{
    document.querySelectorAll('.rv').forEach(function(el){el.classList.add('in');});
  }

  /* мобильное меню */
  var tog=document.getElementById('navtoggle'),links=document.getElementById('nlinks');
  if(tog&&links){
    tog.addEventListener('click',function(){links.classList.toggle('open');});
    links.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){links.classList.remove('open');});});
  }

  /* лайтбокс сертификатов */
  var lb=document.getElementById('lb');
  if(lb){
    var lbImg=document.getElementById('lb-img'),lbCap=document.getElementById('lb-cap');
    function openLb(src,cap){lbImg.src=src;lbImg.alt=cap||'';lbCap.textContent=cap||'';lb.classList.add('open');lb.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';}
    function closeLb(){lb.classList.remove('open');lb.setAttribute('aria-hidden','true');document.body.style.overflow='';lbImg.src='';}
    document.querySelectorAll('.certthumb[data-cert]').forEach(function(t){t.addEventListener('click',function(){openLb(t.getAttribute('data-cert'),t.getAttribute('data-cap'));});});
    var lbClose=document.getElementById('lb-close');
    if(lbClose)lbClose.addEventListener('click',closeLb);
    lb.addEventListener('click',function(e){if(e.target===lb)closeLb();});
    window.addEventListener('keydown',function(e){if(e.key==='Escape'&&lb.classList.contains('open'))closeLb();});
  }

  /* блок «спроси обо мне у ИИ» — копирование готового запроса */
  document.querySelectorAll('.askbtn[data-prompt]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      var text=btn.getAttribute('data-prompt');
      var url=btn.getAttribute('data-open');
      var label=btn.querySelector('.lbl');
      var orig=label?label.textContent:'';
      function done(){
        btn.classList.add('copied');
        if(label)label.textContent='Запрос скопирован ✓';
        if(window.ym)ym(109611431,'reachGoal','ask_ai_copy');
        if(window.dataLayer)window.dataLayer.push({event:'ask_ai_copy',ai:btn.getAttribute('data-ai')||'',page_variant:variant});
        setTimeout(function(){btn.classList.remove('copied');if(label)label.textContent=orig;},2600);
        if(url)window.open(url,'_blank','noopener');
      }
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(done).catch(function(){fallbackCopy(text);done();});
      }else{fallbackCopy(text);done();}
    });
  });
  function fallbackCopy(text){
    try{var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);}catch(_){}
  }

  /* форма → Web3Forms */
  var lf=document.getElementById('leadform');
  var okModal=document.getElementById('formok');
  function closeOk(){okModal.classList.remove('show');okModal.setAttribute('aria-hidden','true');document.body.style.overflow='';}
  if(okModal){
    var okc=document.getElementById('okclose');
    if(okc)okc.addEventListener('click',closeOk);
    okModal.addEventListener('click',function(e){if(e.target===okModal)closeOk();});
    window.addEventListener('keydown',function(e){if(e.key==='Escape'&&okModal.classList.contains('show'))closeOk();});
  }
  if(lf){lf.addEventListener('submit',async function(e){
    e.preventDefault();
    var err=document.getElementById('formerr');
    var val=function(n){var c=lf.querySelector('[name="'+n+'"]:checked');if(c)return c.value;var el=lf.querySelector('[name="'+n+'"]');return el?el.value.trim():'';};
    var contactEl=lf.querySelector('[name="contact"]');
    if(!contactEl.value.trim()){contactEl.focus();contactEl.style.borderColor='var(--no)';return;}
    contactEl.style.borderColor='';if(err)err.style.display='none';lf.classList.add('sending');
    var msg='[ЗАЯВКА · '+variant.toUpperCase()+']\nКоманда: '+(val('team')||'—')+'\nСтадия: '+(val('stage')||'—')+'\nЧто ближе: '+(val('want')||'—')+'\nЧто изменить: '+(val('problem')||'—')+'\nИмя: '+(val('uname')||'—')+'\nКонтакт: '+contactEl.value.trim();
    var fd=new FormData();
    fd.append('access_key','24d71a36-877d-46e1-9956-566f0dbb8d50');
    fd.append('subject','Заявка на разбор ('+variant+') — Founder Trajectory');
    fd.append('from_name','Сайт Founder Trajectory · '+variant);
    fd.append('name',val('uname')||'Заявка с сайта');
    fd.append('message',msg);
    if(document.getElementById('botcheck')&&document.getElementById('botcheck').checked)fd.append('botcheck','1');
    if(/@/.test(contactEl.value))fd.append('replyto',contactEl.value.trim());
    try{
      var res=await fetch('https://api.web3forms.com/submit',{method:'POST',headers:{'Accept':'application/json'},body:fd});
      var data=await res.json();
      if(data.success){
        lf.reset();lf.classList.remove('sending');
        if(okModal){okModal.classList.add('show');okModal.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';}
        if(window.dataLayer)window.dataLayer.push({event:'lead_submit',page_variant:variant});
        if(window.ym)ym(109611431,'reachGoal','lead_submit');
        if(window.gtag)gtag('event','lead_submit',{page_variant:variant});
      }else{throw new Error(data.message||'fail');}
    }catch(_){if(err)err.style.display='block';lf.classList.remove('sending');}
  });}

  /* трекинг кликов по целевым кнопкам */
  document.querySelectorAll('a.cta,a.ncta').forEach(function(a){a.addEventListener('click',function(){
    if(window.dataLayer)window.dataLayer.push({event:'cta_click',cta_text:(a.textContent||'').trim().slice(0,60),page_variant:variant});
    if(window.ym)ym(109611431,'reachGoal','cta_click');
    if(window.gtag)gtag('event','cta_click',{page_variant:variant});
  });});
})();
