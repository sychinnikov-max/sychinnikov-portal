/* Fishok portal — reveal + active nav */
(function () {
  // reveal on scroll
  var els = document.querySelectorAll('.reveal');
  if (els.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }

  // active nav link by path
  var path = location.pathname.replace(/\/+$/, '/');
  document.querySelectorAll('.fk-nav-links a').forEach(function (a) {
    var href = a.getAttribute('href');
    if (href && href !== '/' && path.indexOf(href.replace(/\/+$/, '')) === 0 && href.indexOf('/fishok/') === 0) {
      a.classList.add('active');
    }
  });
})();
