/* Homepage: "Hide this on future visits" for the Who we are section. Remembered in this browser
   (localStorage); the head script in functions.php applies it before the page draws. */
(function () {
  'use strict';
  var root = document.documentElement;
  var section = document.getElementById('who-we-are');
  var hide = section && section.querySelector('.fort-about__hide');
  var show = document.querySelector('.fort-about-bar__show');
  if (!section || !hide || !show) return;

  function remember(on) {
    try {
      if (on) localStorage.setItem('fortHideAbout', '1');
      else localStorage.removeItem('fortHideAbout');
    } catch (e) { /* Private mode etc.: it just won't be remembered. */ }
  }

  // Touch screens have no hover: the outline also lights while the button is pressed.
  hide.addEventListener('pointerenter', function () { section.classList.add('is-armed'); });
  hide.addEventListener('pointerleave', function () { section.classList.remove('is-armed'); });

  hide.addEventListener('click', function () {
    remember(true);
    root.classList.add('fort-about-hidden');
    show.setAttribute('aria-expanded', 'false');
    show.focus();
  });
  show.addEventListener('click', function () {
    remember(false);
    root.classList.remove('fort-about-hidden');
    section.classList.remove('is-armed');
    show.setAttribute('aria-expanded', 'true');
    var title = document.getElementById('fort-about-title');
    if (title) {
      title.setAttribute('tabindex', '-1');
      title.focus();
    }
  });
})();
