/* Find a workout (page-locations.php): the map beside the AO list, the day and 1st/2nd/3rd F
   filters, and "Closest to me". The list is plain HTML and works without this; the pins come from
   the #fort-map-data JSON. Your location stays in the browser: it's only used to sort the list. */
(function () {
  'use strict';
  var dataEl = document.getElementById('fort-map-data');
  var mapEl = document.getElementById('fort-map');
  if (!dataEl || !mapEl) return;
  var data = JSON.parse(dataEl.textContent);
  var bar = document.querySelector('.fort-loc__bar');
  var list = document.querySelector('.fort-loc__list');
  var status = document.querySelector('.fort-loc__status');
  var empty = document.querySelector('.fort-loc__empty');
  var nearBtn = document.querySelector('.fort-loc__near');
  var cards = Array.prototype.slice.call(list.querySelectorAll('.fort-loc__site'));
  var order = cards.slice();
  var sites = {};
  data.sites.forEach(function (s) { sites[s.id] = s; });

  var state = { day: '', kind: '', me: null, selected: null };
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var wide = window.matchMedia('(min-width: 901px)');
  var DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var FULL = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var map = null;
  var markers = {};
  var meMarker = null;

  bar.hidden = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function matches(days, kind) {
    return (!state.day || days.indexOf(Number(state.day)) !== -1) && (!state.kind || state.kind === kind);
  }

  // Miles between two [lat, lng] points.
  function miles(a, b) {
    var r = Math.PI / 180;
    var h = Math.pow(Math.sin((b[0] - a[0]) * r / 2), 2) +
      Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.pow(Math.sin((b[1] - a[1]) * r / 2), 2);
    return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function visibleAos(site) {
    return site.aos.filter(function (a) { return matches(a.days, a.kind); });
  }

  // ── The map ─────────────────────────────────────────────────────────────

  // Close in, pins are start-time tags; further out (and crowded), dots, with the selected one a
  // tag. Each pin holds both (CSS shows one), so selecting and zooming never rebuild the pins.
  var TAGS_FROM = 13.5;

  function pinHtml(aos) {
    var times = aos.map(function (a) { return a.time; }).filter(Boolean).sort();
    var more = aos.length > 1 ? '<span class="fort-pin__more">+' + (aos.length - 1) + '</span>' : '';
    return '<span class="fort-pin__dot">' + (aos.length > 1 ? aos.length : '') + '</span>' +
      '<span class="fort-pin__tag">' + esc(times[0] || '•') + more + '</span>';
  }

  function popupHtml(site) {
    var rows = visibleAos(site).map(function (a) {
      var days = a.days.map(function (d) { return DAYS[d]; }).join(' · ');
      return '<li><span class="fort-pop__when">' + esc(days) + ' ' + esc(a.time) + '</span> ' + esc(a.name) + '</li>';
    }).join('');
    return '<div class="fort-pop">' +
      '<p class="fort-pop__venue">' + esc(site.venue) + '</p>' +
      '<ul class="fort-pop__list">' + rows + '</ul>' +
      '<p class="fort-pop__links"><a href="https://www.google.com/maps/dir/?api=1&amp;destination=' + site.lat + ',' + site.lng + '" target="_blank" rel="noopener">Directions ↗</a>' +
      '<a href="#site-' + esc(site.id) + '" class="fort-pop__details">Details ↓</a></p></div>';
  }

  function initMap() {
    if (typeof L === 'undefined') return;
    mapEl.innerHTML = '';
    map = L.map(mapEl, { scrollWheelZoom: false, zoomSnap: 0.5 });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'fort-map-tiles',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    // Scrolling the page shouldn't zoom the map; once you click into it, it does.
    map.on('focus click', function () { map.scrollWheelZoom.enable(); });
    map.on('blur mouseout', function () { map.scrollWheelZoom.disable(); });

    data.sites.forEach(function (s) {
      var m = L.marker([s.lat, s.lng], {
        title: s.venue,
        alt: s.venue,
        riseOnHover: true,
        icon: L.divIcon({ className: 'fort-pin', html: '', iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -34] }),
      });
      m.on('click', function () { select(s.id, 'map'); });
      m.bindPopup('', { maxWidth: 280, minWidth: 200, autoPanPadding: [24, 24] });
      markers[s.id] = m;
    });
    map.on('popupclose', function (e) {
      var m = markers[state.selected];
      if (m && m.getPopup() === e.popup) mark(null);
    });
    map.on('zoomend', function () { mapEl.classList.toggle('is-far', map.getZoom() < TAGS_FROM); });
    fit(true);
  }

  // Fit the visible pins (and you, when located), leaving out far-off ones like Chester.
  function fit(first) {
    if (!map) return;
    var pts = [];
    data.sites.forEach(function (s) {
      if (visibleAos(s).length && (!data.center || miles(data.center, [s.lat, s.lng]) < 18)) pts.push([s.lat, s.lng]);
    });
    if (state.me) {
      pts.sort(function (a, b) { return miles(state.me, a) - miles(state.me, b); });
      pts = pts.slice(0, 4).concat([state.me]);
    }
    if (!pts.length && data.center) pts = [data.center];
    if (!pts.length) return;
    map.fitBounds(pts, { padding: [40, 40], maxZoom: 14, animate: !first && !still });
  }

  function drawPins() {
    if (!map) return;
    data.sites.forEach(function (s) {
      var m = markers[s.id];
      var aos = visibleAos(s);
      if (!aos.length) {
        m.remove();
        return;
      }
      var first = aos.some(function (a) { return a.kind === '1st'; });
      m.setIcon(L.divIcon({
        className: 'fort-pin' + (first ? '' : ' is-other') + (state.selected === s.id ? ' is-selected' : ''),
        html: pinHtml(aos),
        iconSize: [0, 0],
        iconAnchor: [0, 0],
        popupAnchor: [0, -34],
      }));
      m.setPopupContent(popupHtml(s));
      if (!map.hasLayer(m)) m.addTo(map);
    });
  }

  // ── The list ────────────────────────────────────────────────────────────

  function mark(id) {
    state.selected = id;
    cards.forEach(function (c) { c.classList.toggle('is-selected', c.dataset.site === id); });
    Object.keys(markers).forEach(function (k) {
      var el = markers[k].getElement();
      if (el) el.classList.toggle('is-selected', k === id);
      markers[k].setZIndexOffset(k === id ? 1000 : 0);
    });
  }

  function select(id, from) {
    var s = sites[id];
    var card = document.getElementById('site-' + id);
    if (!s || !card) return;
    mark(id);
    if (map) {
      if (from === 'list') {
        var z = Math.max(map.getZoom(), 14);
        if (still) map.setView([s.lat, s.lng], z); else map.flyTo([s.lat, s.lng], z, { duration: 0.6 });
        if (!wide.matches) mapEl.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
        markers[id].openPopup();
      }
      // A click on the pin opens its popup itself (bindPopup).
    }
    if (from === 'map' && wide.matches) card.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
  }

  function apply(refit) {
    var places = 0;
    var aoCount = 0;
    cards.forEach(function (card) {
      var shown = 0;
      card.querySelectorAll('.fort-loc__ao').forEach(function (li) {
        var days = li.dataset.days ? li.dataset.days.split(' ').map(Number) : [];
        var on = matches(days, li.dataset.kind);
        li.hidden = !on;
        if (on) shown++;
      });
      card.hidden = !shown;
      if (shown && card.dataset.site) places++;
      aoCount += shown;
      if (!shown && state.selected === card.dataset.site) {
        if (map) map.closePopup();
        mark(null);
      }
    });
    empty.hidden = aoCount > 0;
    status.textContent = aoCount ? aoCount + (aoCount === 1 ? ' AO' : ' AOs') + ' at ' + places + (places === 1 ? ' place' : ' places') +
      (state.day ? ' on ' + FULL[state.day] + 's' : '') : '';
    drawPins();
    if (refit) fit(false);
  }

  function sortCards() {
    var placed = order.filter(function (c) { return c.dataset.site; });
    var rest = order.filter(function (c) { return !c.dataset.site; });
    if (state.me) {
      placed = placed.slice().sort(function (a, b) {
        var sa = sites[a.dataset.site];
        var sb = sites[b.dataset.site];
        return miles(state.me, [sa.lat, sa.lng]) - miles(state.me, [sb.lat, sb.lng]);
      });
    }
    placed.concat(rest).forEach(function (c) {
      var d = c.querySelector('.fort-loc__dist');
      var s = sites[c.dataset.site];
      if (d) d.textContent = state.me && s ? miles(state.me, [s.lat, s.lng]).toFixed(1) + ' mi' : '';
      list.insertBefore(c, empty);
    });
  }

  // ── Controls ────────────────────────────────────────────────────────────

  bar.addEventListener('click', function (e) {
    var b = e.target.closest('.fort-st-seg__opt');
    if (!b) return;
    var key = 'day' in b.dataset ? 'day' : 'kind';
    state[key] = b.dataset[key];
    b.parentNode.querySelectorAll('.fort-st-seg__opt').forEach(function (o) {
      o.classList.toggle('is-current', o === b);
      o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
    });
    apply(true);
  });

  list.addEventListener('click', function (e) {
    var b = e.target.closest('.fort-loc__show');
    if (b) select(b.dataset.site, 'list');
  });

  // Details ↓ in a popup (phones: the list is below the map).
  mapEl.addEventListener('click', function (e) {
    var a = e.target.closest('.fort-pop__details');
    if (!a) return;
    e.preventDefault();
    var card = document.querySelector(a.getAttribute('href'));
    if (card) card.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  });

  if (!('geolocation' in navigator) || !window.isSecureContext) {
    nearBtn.hidden = true;
  } else {
    nearBtn.addEventListener('click', function () {
      if (state.me) {
        state.me = null;
        if (meMarker) meMarker.remove();
        nearBtn.setAttribute('aria-pressed', 'false');
        sortCards();
        fit(false);
        return;
      }
      nearBtn.classList.add('is-busy');
      status.textContent = 'Finding you…';
      navigator.geolocation.getCurrentPosition(function (pos) {
        nearBtn.classList.remove('is-busy');
        state.me = [pos.coords.latitude, pos.coords.longitude];
        nearBtn.setAttribute('aria-pressed', 'true');
        if (map) {
          if (meMarker) meMarker.remove();
          meMarker = L.circleMarker(state.me, { radius: 7, weight: 3, className: 'fort-me', interactive: false }).addTo(map);
        }
        sortCards();
        apply(true);
        list.scrollTop = 0;
      }, function () {
        nearBtn.classList.remove('is-busy');
        status.textContent = 'Couldn’t get your location. Check that this site is allowed to use it.';
      }, { timeout: 10000, maximumAge: 600000 });
    });
  }

  initMap();
  apply(false);
})();
