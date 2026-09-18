/* Founder Trajectory · главная, поколение 2. Витрина инструментов + форма Web3Forms. */
(function(){
  'use strict';
  var YM = 109611431;

  /* ---- витрина инструментов ---- */
  var list = document.getElementById('toollist');
  var stage = document.getElementById('toolstage');
  if(list && stage){
    var btns = [].slice.call(list.querySelectorAll('.tool-b'));
    function pick(b){
      btns.forEach(function(x){ x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      var img = stage.querySelector('img');
      img.setAttribute('src', b.dataset.src);
      img.setAttribute('alt', b.dataset.alt || '');
      var cap = document.getElementById('toolcap');
      if(cap) cap.textContent = b.dataset.cap || '';
    }
    btns.forEach(function(b){
      b.addEventListener('click', function(){ pick(b); });
      b.addEventListener('keydown', function(e){
        var i = btns.indexOf(b);
        if(e.key === 'ArrowDown' || e.key === 'ArrowRight'){ e.preventDefault(); btns[(i+1)%btns.length].focus(); btns[(i+1)%btns.length].click(); }
        if(e.key === 'ArrowUp' || e.key === 'ArrowLeft'){ e.preventDefault(); btns[(i-1+btns.length)%btns.length].focus(); btns[(i-1+btns.length)%btns.length].click(); }
      });
    });
  }

  /* ---- клик по призыву ---- */
  [].slice.call(document.querySelectorAll('[data-cta]')).forEach(function(a){
    a.addEventListener('click', function(){
      var place = a.getAttribute('data-cta');
      if(window.ym) ym(YM, 'reachGoal', 'cta_click', {place: place});
      if(window.gtag) gtag('event', 'cta_click', {place: place});
    });
  });

  /* ---- форма → Web3Forms ---- */
  var lf = document.getElementById('leadform');
  var okModal = document.getElementById('formok');
  function closeOk(){
    okModal.classList.remove('show');
    okModal.setAttribute('aria-hidden','true');
    document.body.style.overflow='';
  }
  if(okModal){
    var okc = document.getElementById('okclose');
    if(okc) okc.addEventListener('click', closeOk);
    okModal.addEventListener('click', function(e){ if(e.target === okModal) closeOk(); });
    window.addEventListener('keydown', function(e){ if(e.key === 'Escape' && okModal.classList.contains('show')) closeOk(); });
  }
  if(lf) lf.addEventListener('submit', async function(e){
    e.preventDefault();
    var err = document.getElementById('formerr');
    var val = function(n){
      var c = lf.querySelector('[name="'+n+'"]:checked');
      if(c) return c.value;
      var el = lf.querySelector('[name="'+n+'"]');
      return el ? el.value.trim() : '';
    };
    var contactEl = lf.querySelector('[name="contact"]');
    if(!contactEl.value.trim()){ contactEl.focus(); contactEl.style.borderBottomColor = '#A85338'; return; }
    contactEl.style.borderBottomColor = '';
    if(err) err.style.display = 'none';
    lf.classList.add('sending');

    var msg = '[ЗАЯВКА · главная v2]'
      + '\nКоманда: ' + (val('team') || '—')
      + '\nСтадия: ' + (val('stage') || '—')
      + '\nЧто ближе: ' + (val('want') || '—')
      + '\nЧто изменить: ' + (val('problem') || '—')
      + '\nИмя: ' + (val('uname') || '—')
      + '\nКонтакт: ' + contactEl.value.trim();

    var fd = new FormData();
    fd.append('access_key','24d71a36-877d-46e1-9956-566f0dbb8d50');
    fd.append('subject','Заявка на разбор (главная v2) — Founder Trajectory');
    fd.append('from_name','Сайт Founder Trajectory · главная v2');
    fd.append('name', val('uname') || 'Заявка с сайта');
    fd.append('message', msg);
    var bot = document.getElementById('botcheck');
    if(bot && bot.checked) fd.append('botcheck','1');
    if(/@/.test(contactEl.value)) fd.append('replyto', contactEl.value.trim());

    try{
      var res = await fetch('https://api.web3forms.com/submit', {method:'POST', headers:{'Accept':'application/json'}, body: fd});
      var data = await res.json();
      if(data.success){
        lf.reset();
        lf.classList.remove('sending');
        if(okModal){ okModal.classList.add('show'); okModal.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden'; }
        if(window.dataLayer) window.dataLayer.push({event:'lead_submit', page_variant:'v2'});
        if(window.ym) ym(YM, 'reachGoal', 'lead_submit');
        if(window.gtag) gtag('event','lead_submit',{page_variant:'v2'});
      } else { throw new Error(data.message || 'fail'); }
    } catch(_){
      if(err) err.style.display = 'block';
      lf.classList.remove('sending');
    }
  });
})();
