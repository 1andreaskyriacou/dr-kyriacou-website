(function () {
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;

    var href = a.getAttribute('href');
    if (!href) return;

    if (
      href.charAt(0) === '#' ||
      href.indexOf('://') !== -1 ||
      href.indexOf('mailto:') === 0 ||
      href.indexOf('tel:') === 0 ||
      a.target === '_blank'
    ) return;

    e.preventDefault();
    var main = document.querySelector('main');
    if (main) main.classList.add('page-exit');

    setTimeout(function () {
      window.location.href = href;
    }, 150);
  });
}());
