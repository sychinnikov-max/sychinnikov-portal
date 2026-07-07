/* ═══════════════════════════════════════════════════════════
   FISHOK GANTT — компактный Гант-роадмап отдела.
   Недели = колонки, задачи = полосы, статус = цвет.
   Источник данных — departments/<отдел>/roadmap.md (переносится сюда вручную
   при обновлении кабины, как и остальной портал: раз в неделю из fishok/).

   Использование:
     FishokGantt.mount(el, {
       weeks: [{label:'07–13.07', n:'Нед 1'}, ...],   // список недель горизонта
       nowWeek: 1,                                     // текущая неделя (1-based) — маркер
       groups: [
         { name:'Фаза 1 · Мандат', color:'#1B8FD6', tasks:[
             { name:'Договор + NDA', start:1, end:1, status:'active', note:'ВТ 1:1' },
             { name:'Доступ к банк-первичке', start:1, end:2, status:'crit' }
         ]}
       ]
     });
   status: done | active | plan | risk | crit
   ═══════════════════════════════════════════════════════════ */
window.FishokGantt = (function () {
  function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function mount(el, data){
    if(!el || !data || !data.weeks){ return; }
    var N = data.weeks.length;
    var gridCols = 'grid-template-columns:repeat('+N+',1fr)';
    var h = '<div class="fk-gantt">';

    // шапка недель
    h += '<div class="grow ghead"><div class="glabel">Трек · задача</div>'+
         '<div class="gtrack" style="--gcols:'+N+';'+gridCols+'">';
    data.weeks.forEach(function(w){
      h += '<div class="gweek"><b>'+esc(w.n||'')+'</b>'+esc(w.label||'')+'</div>';
    });
    h += '</div></div>';

    // «сегодня» — вертикальный маркер по границе текущей недели
    var nowMarker = '';
    if(data.nowWeek){
      var pos = ((data.nowWeek - 0.5) / N) * 100;
      nowMarker = '<div class="gnow" style="left:'+pos.toFixed(2)+'%"></div>';
    }

    data.groups.forEach(function(g){
      var dot = g.color ? '<span class="gg-dot" style="background:'+g.color+'"></span>' : '';
      h += '<div class="grow"><div class="ggroup" style="grid-column:1 / -1">'+dot+esc(g.name)+'</div></div>';
      (g.tasks||[]).forEach(function(t){
        var s = Math.max(1, t.start||1), e = Math.max(s, t.end||s);
        var note = t.note ? '<span class="gb-note">· '+esc(t.note)+'</span>' : '';
        h += '<div class="grow gtaskrow"><div class="glabel gtask">'+esc(t.name)+'</div>'+
             '<div class="gtrack" style="--gcols:'+N+';'+gridCols+'">'+ nowMarker +
             '<div class="gbar '+(t.status||'plan')+'" style="grid-column:'+s+' / '+(e+1)+'" title="'+esc(t.name)+' (нед '+s+(e>s?'–'+e:'')+')">'+esc(t.label||'')+note+'</div>'+
             '</div></div>';
      });
    });

    h += '</div>';
    h += '<div class="gantt-legend">'+
         '<span><i style="background:var(--fk-green)"></i>сделано</span>'+
         '<span><i style="background:linear-gradient(135deg,#2E6FC9,#22B4E8)"></i>в работе</span>'+
         '<span><i style="background:linear-gradient(135deg,#D2452F,#E8642B)"></i>критический путь</span>'+
         '<span><i style="background:#7C8A9A"></i>план</span>'+
         '<span><i style="background:var(--fk-red)"></i>риск</span>'+
         '</div>';
    el.innerHTML = h;
  }

  return { mount: mount };
})();
