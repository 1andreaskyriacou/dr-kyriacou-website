(function () {
  if (!('IntersectionObserver' in window)) return;

  document.addEventListener('DOMContentLoaded', function () {
    var els = document.querySelectorAll('.reveal');

    els.forEach(function (el) {
      var siblings = Array.from(el.parentElement.children).filter(function (c) {
        return c.classList.contains('reveal');
      });
      if (siblings.length > 1) {
        el.style.transitionDelay = (siblings.indexOf(el) * 0.1) + 's';
      }
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    els.forEach(function (el) { io.observe(el); });
  });
}());
