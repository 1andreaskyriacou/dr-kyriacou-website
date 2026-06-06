    // Hide the page immediately on Greek pages so visitors don't see a flash
    // of English before Google Translate runs. The language toggle below
    // reveals it once translation is applied; this timeout is the safety net.
    (function () {
      if (document.body && /googtrans=\/[^/]*\/el/.test(document.cookie)) {
        document.body.classList.add('translating');
        setTimeout(function () { document.body.classList.remove('translating'); }, 2500);
      }
    }());

    // Year
    document.getElementById('year').textContent = new Date().getFullYear();

    // Mobile nav
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('nav-menu');
    hamburger.addEventListener('click', function() {
      const open = navMenu.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', open);
    });
    navMenu.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        navMenu.classList.remove('open');
        hamburger.setAttribute('aria-expanded', false);
      });
    });

    // Smooth scroll offset for fixed nav
    document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
      anchor.addEventListener('click', function(e) {
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          e.preventDefault();
          const offset = 80;
          const top = target.getBoundingClientRect().top + window.scrollY - offset;
          window.scrollTo({ top: top, behavior: 'smooth' });
        }
      });
    });

    // Nav scroll style
    var navbar = document.getElementById('navbar');
    window.addEventListener('scroll', function() {
      if (window.scrollY > 40) {
        navbar.style.background = '#3d4451';
      } else {
        navbar.style.background = '#3d4451';
      }
    });

    // Show success banner when redirected back with ?sent=true
    if (window.location.search.indexOf('sent=true') !== -1) {
      var sentMsg = document.getElementById('form-sent-message');
      if (sentMsg) sentMsg.style.display = 'block';
    }

    // ── ECG Patient Education Animations ────────────────────────────────────
    (function () {
      'use strict';

      function gauss(x, mu, sig) {
        return Math.exp(-0.5 * Math.pow((x - mu) / sig, 2));
      }

      function normalSinus(t) {
        var p = (t % 110) / 110;
        return  0.14 * gauss(p, 0.12, 0.040)
              - 0.07 * gauss(p, 0.27, 0.016)
              + 0.95 * gauss(p, 0.32, 0.022)
              - 0.20 * gauss(p, 0.38, 0.016)
              + 0.24 * gauss(p, 0.58, 0.070);
      }

      function svtWave(t) {
        var p = (t % 34) / 34;
        return  0.08 * gauss(p, 0.72, 0.040)
              - 0.07 * gauss(p, 0.27, 0.016)
              + 0.95 * gauss(p, 0.32, 0.020)
              - 0.20 * gauss(p, 0.38, 0.016)
              + 0.18 * gauss(p, 0.54, 0.055);
      }

      function flutterWave(t) {
        var fp  = (t % 18) / 18;
        var saw = 0.18 * (1 - 2 * fp);
        var qp  = (t % 60) / 60;
        var qrs = -0.10 * gauss(qp, 0.28, 0.016)
                 + 0.95 * gauss(qp, 0.33, 0.022)
                 - 0.22 * gauss(qp, 0.39, 0.016)
                 + 0.10 * gauss(qp, 0.58, 0.055);
        return saw + qrs;
      }

      var AF_SEQ = (function () {
        var iv = [70,45,98,52,115,40,85,62,50,90,78,55,88,42,73];
        var pos = [], cum = 0;
        for (var i = 0; i < iv.length; i++) { cum += iv[i]; pos.push(cum); }
        return { pos: pos, total: cum };
      }());

      function afibWave(t) {
        var c = 0.060 * Math.sin(t * 0.28 + 0.5)
              + 0.050 * Math.sin(t * 0.63 + 1.3)
              + 0.040 * Math.sin(t * 1.10 + 2.1)
              + 0.025 * Math.sin(t * 0.41 + 0.9)
              + 0.020 * Math.sin(t * 1.70 + 3.0);
        var tm = t % AF_SEQ.total, qrs = 0;
        for (var i = 0; i < AF_SEQ.pos.length; i++) {
          var d = tm - AF_SEQ.pos[i];
          if (d > -18 && d < 18) {
            var lp = (d + 18) / 36;
            qrs -= 0.07 * gauss(lp, 0.35, 0.07);
            qrs += 0.95 * gauss(lp, 0.50, 0.07);
            qrs -= 0.20 * gauss(lp, 0.65, 0.07);
            break;
          }
        }
        return c + qrs;
      }

      function vtWave(t) {
        // Wide bizarre QRS at ~180 bpm, no P waves
        var p = (t % 40) / 40;
        return  0.88 * gauss(p, 0.24, 0.062)   // broad positive peak
              - 0.42 * gauss(p, 0.44, 0.050)   // negative component
              + 0.16 * gauss(p, 0.62, 0.038);  // small terminal positive
      }

      function pacedWave(t) {
        var p = (t % 90) / 90;
        var spike = p < 0.025 ? (p < 0.012 ? p / 0.012 : (0.025 - p) / 0.013) * 0.95 : 0;
        return spike
              + 0.60 * gauss(p, 0.115, 0.042)
              - 0.25 * gauss(p, 0.220, 0.030)
              - 0.22 * gauss(p, 0.440, 0.075);
      }

      function pqrstPhase(p) {
        return  0.14 * gauss(p, 0.12, 0.040)
              - 0.07 * gauss(p, 0.27, 0.016)
              + 0.95 * gauss(p, 0.32, 0.022)
              - 0.20 * gauss(p, 0.38, 0.016)
              + 0.24 * gauss(p, 0.58, 0.070);
      }

      function pvcWave(t) {
        // Normal, normal, PVC, compensatory pause — total 420px cycle
        var tm = t % 420;
        if (tm < 105) return pqrstPhase(tm / 105);
        if (tm < 210) return pqrstPhase((tm - 105) / 105);
        if (tm < 290) {
          var p = (tm - 210) / 80;
          return  0.85 * gauss(p, 0.28, 0.080)
                - 0.45 * gauss(p, 0.52, 0.062)
                + 0.18 * gauss(p, 0.73, 0.045);
        }
        return 0; // compensatory pause
      }

      function cspWave(t) {
        // Conduction system pacing: spike + narrow QRS (near-normal complex)
        var p = (t % 92) / 92;
        var spike = p < 0.018 ? (p < 0.009 ? p / 0.009 : (0.018 - p) / 0.009) * 0.65 : 0;
        return spike
              - 0.06 * gauss(p, 0.10, 0.014)
              + 0.90 * gauss(p, 0.15, 0.020)
              - 0.18 * gauss(p, 0.21, 0.014)
              + 0.20 * gauss(p, 0.42, 0.062);
      }

      function crtWave(t) {
        // Biventricular pacing: spike + slightly wider QRS than CSP
        var p = (t % 95) / 95;
        var spike = p < 0.018 ? (p < 0.009 ? p / 0.009 : (0.018 - p) / 0.009) * 0.58 : 0;
        return spike
              - 0.05 * gauss(p, 0.10, 0.016)
              + 0.85 * gauss(p, 0.16, 0.030)
              - 0.18 * gauss(p, 0.25, 0.018)
              + 0.16 * gauss(p, 0.44, 0.068);
      }

      var WAVE_FNS = { normal: normalSinus, svt: svtWave, flutter: flutterWave, af: afibWave, vt: vtWave, pvc: pvcWave, csp: cspWave, crt: crtWave, paced: pacedWave };

      function ECGRenderer(canvas, type) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');
        this.fn     = WAVE_FNS[type];
        this.t      = 0;
        this.buf    = null;
        this.w = this.h = this.mid = this.amp = 0;
        this.rafId  = null;
        this.running = false;
      }

      ECGRenderer.prototype.init = function () {
        var dpr  = window.devicePixelRatio || 1;
        var rect = this.canvas.getBoundingClientRect();
        this.w   = Math.max(Math.round(rect.width),  1);
        this.h   = Math.max(Math.round(rect.height), 1);
        this.canvas.width  = this.w * dpr;
        this.canvas.height = this.h * dpr;
        this.canvas.style.width  = this.w + 'px';
        this.canvas.style.height = this.h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.mid = this.h * 0.50;
        this.amp = this.h * 0.40;
        this.buf = new Float32Array(this.w);
        for (var i = 0; i < this.w; i++) {
          this.buf[i] = this.mid - this.fn(this.t) * this.amp;
          this.t += 1.5;
        }
      };

      ECGRenderer.prototype.draw = function () {
        var ctx = this.ctx, w = this.w, h = this.h, buf = this.buf;
        ctx.fillStyle = '#0A1F3D';
        ctx.fillRect(0, 0, w, h);
        // Subtle ECG grid
        ctx.strokeStyle = 'rgba(201,168,76,0.07)';
        ctx.lineWidth   = 0.5;
        for (var gx = 0; gx < w; gx += 24) {
          ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(0, h * 0.25); ctx.lineTo(w, h * 0.25); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, h * 0.75); ctx.lineTo(w, h * 0.75); ctx.stroke();
        // ECG trace
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth   = 1.5;
        ctx.lineJoin    = 'round';
        ctx.shadowBlur  = 5;
        ctx.shadowColor = 'rgba(74,222,128,0.55)';
        ctx.beginPath();
        ctx.moveTo(0, buf[0]);
        for (var x = 1; x < w; x++) ctx.lineTo(x, buf[x]);
        ctx.stroke();
        ctx.shadowBlur = 0;
      };

      ECGRenderer.prototype.tick = function () {
        if (!this.running) return;
        var buf = this.buf;
        buf.copyWithin(0, 1);
        buf[buf.length - 1] = this.mid - this.fn(this.t) * this.amp;
        this.t += 1.5;
        this.draw();
        this.rafId = requestAnimationFrame(this.tick.bind(this));
      };

      ECGRenderer.prototype.start = function () {
        if (this.running) return;
        this.running = true;
        this.tick();
      };

      ECGRenderer.prototype.stop = function () {
        this.running = false;
        if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
      };

      document.addEventListener('DOMContentLoaded', function () {
        var items = [];

        document.querySelectorAll('.ecg-canvas[data-ecg-type]').forEach(function (canvas) {
          var r = new ECGRenderer(canvas, canvas.dataset.ecgType);
          r.init();
          r.draw();
          items.push({ renderer: r, card: canvas.closest('.edu-card') });
        });

        if ('IntersectionObserver' in window) {
          items.forEach(function (item) {
            var io = new IntersectionObserver(function (entries) {
              entries[0].isIntersecting ? item.renderer.start() : item.renderer.stop();
            }, { threshold: 0.1 });
            io.observe(item.card);
          });
        } else {
          items.forEach(function (item) { item.renderer.start(); });
        }

        document.querySelectorAll('.edu-expand-btn').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var card     = btn.closest('.edu-card');
            var expanded = card.classList.toggle('expanded');
            btn.setAttribute('aria-expanded', String(expanded));
            btn.querySelector('.edu-btn-text').textContent = expanded ? 'Show less' : 'Read more';
            var detail = card.querySelector('.edu-card-detail');
            if (detail) detail.setAttribute('aria-hidden', String(!expanded));
          });
        });

        var debounce;
        window._ECGRenderer = ECGRenderer;
      window.addEventListener('resize', function () {
          clearTimeout(debounce);
          debounce = setTimeout(function () {
            items.forEach(function (item) {
              var was = item.renderer.running;
              item.renderer.stop();
              item.renderer.init();
              was ? item.renderer.start() : item.renderer.draw();
            });
          }, 200);
        });
      });
    }());

    // ── heart schematic modal ──────────────────────────────────────────────
    window.openSchematicModal = function (el) {
      console.log('[schematic-modal] open:', el.querySelector('.heart-caption').textContent.slice(0, 50));
      var modal   = document.getElementById('schematic-modal');
      var svgWrap = document.getElementById('schematic-modal-svg');
      var cap     = document.getElementById('schematic-modal-caption');
      svgWrap.innerHTML = '';
      var svg = el.querySelector('svg').cloneNode(true);
      svg.removeAttribute('aria-hidden');
      svgWrap.appendChild(svg);
      cap.textContent = el.querySelector('.heart-caption').textContent;
      modal.style.display = 'flex';
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      console.log('[schematic-modal] modal display:', modal.style.display, '/ classList:', modal.className);
    };
    document.addEventListener('DOMContentLoaded', function () {
      var modal = document.getElementById('schematic-modal');
      if (!modal) { console.warn('[schematic-modal] modal element not found'); return; }
      function closeModal() {
        modal.classList.remove('active');
        modal.style.display = '';
        document.body.style.overflow = '';
        document.getElementById('schematic-modal-svg').innerHTML = '';
      }
      document.getElementById('schematic-modal-close').addEventListener('click', closeModal);
      modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
      });
    });

    // ── bio modal ──────────────────────────────────────────────────────────────
    window.openBioModal = function () {
      var overlay = document.getElementById('bio-modal');
      overlay.style.display = 'flex';
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    };
    document.addEventListener('DOMContentLoaded', function () {
      var overlay = document.getElementById('bio-modal');
      if (!overlay) return;
      function closeBio() {
        overlay.classList.remove('active');
        overlay.style.display = '';
        document.body.style.overflow = '';
      }
      document.getElementById('bio-modal-close').addEventListener('click', closeBio);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeBio(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlay.classList.contains('active')) closeBio();
      });
    });

    // ── research modal ─────────────────────────────────────────────────────
    window.openResearchModal = function () {
      var overlay = document.getElementById('research-modal');
      if (!overlay) return;
      overlay.style.display = 'flex';
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    };
    document.addEventListener('DOMContentLoaded', function () {
      var overlay = document.getElementById('research-modal');
      if (!overlay) return;
      function closeResearch() {
        overlay.classList.remove('active');
        overlay.style.display = '';
        document.body.style.overflow = '';
      }
      document.getElementById('research-modal-close').addEventListener('click', closeResearch);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeResearch(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlay.classList.contains('active')) closeResearch();
      });
    });

    // ── professional statement modal ────────────────────────────────────────
    window.openStatementModal = function () {
      var overlay = document.getElementById('statement-modal');
      if (!overlay) return;
      overlay.style.display = 'flex';
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    };
    document.addEventListener('DOMContentLoaded', function () {
      var overlay = document.getElementById('statement-modal');
      if (!overlay) return;
      function closeStatement() {
        overlay.classList.remove('active');
        overlay.style.display = '';
        document.body.style.overflow = '';
      }
      document.getElementById('statement-modal-close').addEventListener('click', closeStatement);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeStatement(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlay.classList.contains('active')) closeStatement();
      });
    });

    // ── arrhythmia explorer ────────────────────────────────────────────────
    (function () {
      var ECG_MAP = {
        normal:'normal', af:'af', flutter:'flutter', at:'svt',
        svt:'svt', vt:'vt', pvc:'pvc', csp:'csp', crt:'crt'
      };
      var cur = null;
      window.aeSwitch = function (cond) {
        document.querySelectorAll('.ae-btn').forEach(function (b) {
          b.classList.toggle('ae-active', b.dataset.cond === cond);
        });
        document.querySelectorAll('.ae-overlay').forEach(function (o) {
          o.classList.toggle('ae-active', o.dataset.cond === cond);
        });
        document.querySelectorAll('.ae-info').forEach(function (i) {
          i.classList.toggle('ae-active', i.dataset.cond === cond);
        });
        var canvas = document.getElementById('ae-ecg');
        if (!canvas || !window._ECGRenderer) return;
        if (cur) { cur.stop(); cur = null; }
        canvas.width  = canvas.offsetWidth  || 200;
        canvas.height = canvas.offsetHeight || 58;
        cur = new window._ECGRenderer(canvas, ECG_MAP[cond] || 'normal');
        cur.init();
        cur.start();
      };
      document.addEventListener('DOMContentLoaded', function () {
        if (!document.getElementById('ae-panel')) return;
        requestAnimationFrame(function () { window.aeSwitch('normal'); });
      });
    }());

    // ── Animated stat counters ───────────────────────────────────────────────
    (function () {
      if (!('IntersectionObserver' in window)) return;
      document.addEventListener('DOMContentLoaded', function () {
        var nums = document.querySelectorAll('.stat-number[data-target]');
        if (!nums.length) return;
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var el = entry.target;
            var target = parseInt(el.getAttribute('data-target'), 10);
            var suffix = el.getAttribute('data-suffix') || '';
            var duration = 1400;
            var start = null;
            function step(ts) {
              if (!start) start = ts;
              var progress = Math.min((ts - start) / duration, 1);
              var ease = 1 - Math.pow(1 - progress, 3);
              el.textContent = Math.round(ease * target) + suffix;
              if (progress < 1) requestAnimationFrame(step);
            }
            requestAnimationFrame(step);
            io.unobserve(el);
          });
        }, { threshold: 0.4 });
        nums.forEach(function (el) { io.observe(el); });
      });
    }());

    // ── Hero parallax (index.html only) ─────────────────────────────────────
    (function () {
      var hero = document.getElementById('hero');
      if (!hero) return;
      var heroBg = hero.querySelector('.hero-bg');
      if (!heroBg) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      heroBg.style.willChange = 'transform';
      function onScroll() {
        heroBg.style.transform = 'translateY(' + Math.round(window.scrollY * 0.28) + 'px)';
      }
      window.addEventListener('scroll', onScroll, { passive: true });
    }());

    // ── Language toggle: English / Greek via Google Translate ───────────────
    (function () {
      'use strict';

      var btns = document.querySelectorAll('.lang-btn');
      if (!btns.length) return;

      function setCookie(value) {
        var host = window.location.hostname;
        document.cookie = 'googtrans=' + value + ';path=/';
        document.cookie = 'googtrans=' + value + ';path=/;domain=' + host;
        var parts = host.split('.');
        if (parts.length > 1) {
          document.cookie = 'googtrans=' + value + ';path=/;domain=.' + parts.slice(-2).join('.');
        }
      }
      function clearCookie() {
        var host = window.location.hostname;
        var exp = ';expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
        document.cookie = 'googtrans=' + exp;
        document.cookie = 'googtrans=' + exp + ';domain=' + host;
        var parts = host.split('.');
        if (parts.length > 1) {
          document.cookie = 'googtrans=' + exp + ';domain=.' + parts.slice(-2).join('.');
        }
      }
      function currentLang() {
        var m = document.cookie.match(/googtrans=\/[^/]*\/([^;]+)/);
        return (m && m[1] === 'el') ? 'el' : 'en';
      }
      function updateButtons(lang) {
        btns.forEach(function (b) {
          var on = b.getAttribute('data-lang') === lang;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        applyOverrides(lang);
      }

      // ── Custom term handling ────────────────────────────────────────────
      // Google mistranslates several cardiology terms (e.g. "Consultant
      // Cardiologist" → "Σύμβουλος Καρδιολόγος"). We wrap each English term in a
      // translate="no" span so Google leaves it alone, then swap the text to
      // our own Greek on language change. Greek values are padded with spaces
      // so neighbouring translated words don't butt up against them
      // (e.g. "...είναι Ειδικός..." not "...είναιΕιδικός...").
      var OVERRIDES = {
        'Cardiac Electrophysiologist': ' Ηλεκτροφυσιολόγος ',
        'Consultant Cardiologist':     ' Ειδικός Καρδιολόγος ',
        'Electrophysiologist':         ' Ηλεκτροφυσιολόγος ',
        'Electrophysiology':           ' Ηλεκτροφυσιολογία '
      };

      // Acronyms / credential line that must always stay in English.
      var KEEP_TERMS = [
        'MBChB · PhD · FRCP · FESC · FEHRA',
        'MBChB PhD FRCP FESC FEHRA',
        'MBChB', 'PhD', 'FRCP', 'FESC', 'FEHRA'
      ];

      // Wrap every visible occurrence of `phrase` in a <span translate="no"> so
      // Google Translate leaves it alone. When `greek` is given the span is a
      // swappable term (class i18n-term) carrying its texts in data-* attrs;
      // otherwise it is simply kept in English (class i18n-keep).
      function wrapPhrase(phrase, className, greek) {
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: function (node) {
            if (!node.nodeValue || node.nodeValue.indexOf(phrase) === -1) return NodeFilter.FILTER_REJECT;
            var p = node.parentNode;
            if (!p) return NodeFilter.FILTER_REJECT;
            var tag = p.nodeName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
            if (p.closest && p.closest('.i18n-term, .i18n-keep, #google_translate_element, .lang-toggle')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        var targets = [];
        while (walker.nextNode()) targets.push(walker.currentNode);
        targets.forEach(function (node) {
          var text = node.nodeValue, frag = document.createDocumentFragment(), idx, last = 0;
          while ((idx = text.indexOf(phrase, last)) !== -1) {
            if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
            var span = document.createElement('span');
            span.className = className + ' notranslate';
            span.setAttribute('translate', 'no');
            span.textContent = phrase;
            if (greek) {
              span.setAttribute('data-en', phrase);
              span.setAttribute('data-el', greek);
            }
            frag.appendChild(span);
            last = idx + phrase.length;
          }
          if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
          node.parentNode.replaceChild(frag, node);
        });
      }

      function applyOverrides(lang) {
        document.querySelectorAll('.i18n-term').forEach(function (el) {
          el.textContent = (lang === 'el') ? el.getAttribute('data-el') : el.getAttribute('data-en');
        });
      }

      // Wrap now, before the Google Translate library loads and processes the
      // page. Longer phrases first so a substring (e.g. "Electrophysiologist"
      // inside "Cardiac Electrophysiologist") isn't wrapped prematurely.
      Object.keys(OVERRIDES)
        .sort(function (a, b) { return b.length - a.length; })
        .forEach(function (en) { wrapPhrase(en, 'i18n-term', OVERRIDES[en]); });
      KEEP_TERMS.forEach(function (t) { wrapPhrase(t, 'i18n-keep'); });

      // Hidden container for the Google Translate gadget
      if (!document.getElementById('google_translate_element')) {
        var holder = document.createElement('div');
        holder.id = 'google_translate_element';
        holder.style.display = 'none';
        document.body.appendChild(holder);
      }

      // Google calls this global once its library has loaded
      window.googleTranslateElementInit = function () {
        new google.translate.TranslateElement({
          pageLanguage: 'en',
          includedLanguages: 'en,el',
          autoDisplay: false
        }, 'google_translate_element');
      };

      var loader = document.createElement('script');
      loader.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
      document.body.appendChild(loader);

      // Drive the (hidden) Google combo box, retrying until it exists
      function applyCombo(lang) {
        var combo = document.querySelector('.goog-te-combo');
        if (!combo) return false;
        combo.value = lang;
        combo.dispatchEvent(new Event('change'));
        return true;
      }
      function isTranslated() {
        return /translated/.test(document.documentElement.className);
      }

      // Fix 3: Google sometimes doesn't pick up the combo change straight away.
      // If the page still isn't translated 1s after pressing GR, re-fire the
      // combo, retrying up to 3 times at 800ms intervals.
      function ensureTranslated() {
        var n = 0;
        (function check() {
          if (isTranslated()) return;
          if (n++ >= 3) return;
          applyCombo('el');
          setTimeout(check, 800);
        }());
      }

      // Fix 4: correct cardiology terms in Google's Greek output. Google renders
      // "ablations" as "καταστολές" (suppressions); the correct term is
      // "καταλύσεις". These run ONLY on already-translated text (guarded by
      // isTranslated) so the English page and the revert to English are never
      // touched.
      var TEXT_FIXES = [
        [/καταστολές/g, 'καταλύσεις'],
        [/\bablation\b/gi, 'καταλύσεις']
      ];
      var fixObs = null, fixScheduled = false;

      function applyTextFixes() {
        if (!isTranslated()) return;
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: function (node) {
            if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
            var p = node.parentNode;
            if (!p) return NodeFilter.FILTER_REJECT;
            var tag = p.nodeName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
            if (p.closest && p.closest('.i18n-term, .i18n-keep, .lang-toggle, #google_translate_element')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        var node;
        while ((node = walker.nextNode())) {
          var t = node.nodeValue, nt = t, i;
          for (i = 0; i < TEXT_FIXES.length; i++) nt = nt.replace(TEXT_FIXES[i][0], TEXT_FIXES[i][1]);
          if (nt !== t) node.nodeValue = nt;
        }
      }

      // Run the fixes after each batch of Google Translate DOM changes.
      function startGreekFixes() {
        applyTextFixes();
        if (window.MutationObserver && !fixObs) {
          fixObs = new MutationObserver(function () {
            if (fixScheduled) return;
            fixScheduled = true;
            setTimeout(function () { fixScheduled = false; applyTextFixes(); }, 150);
          });
          fixObs.observe(document.body, { childList: true, subtree: true, characterData: true });
        }
      }
      function stopGreekFixes() {
        if (fixObs) { fixObs.disconnect(); fixObs = null; }
      }

      function selectLang(lang) {
        if (lang === 'el') {
          setCookie('/en/el');
        } else {
          clearCookie();
          stopGreekFixes();
        }
        updateButtons(lang);
        var tries = 0;
        (function attempt() {
          if (applyCombo(lang)) return;
          if (tries++ < 50) { setTimeout(attempt, 100); return; }
          // Combo never appeared (e.g. switching back to EN) — reload to reset
          if (lang === 'en') window.location.reload();
        }());
        if (lang === 'el') {
          setTimeout(ensureTranslated, 1000);
          startGreekFixes();
        }
      }

      btns.forEach(function (b) {
        b.addEventListener('click', function () {
          selectLang(b.getAttribute('data-lang'));
        });
      });

      // Reflect the persisted choice (cookie carries across pages)
      updateButtons(currentLang());

      // Reveal the page once Google Translate has applied (it adds a
      // "translated-*" class to <html>), or after a safety timeout. This
      // pairs with body.translating set at the top of this file to hide the
      // flash of English on Greek page loads.
      if (currentLang() === 'el') {
        var revealed = false;
        var reveal = function () {
          if (revealed) return;
          revealed = true;
          document.body.classList.remove('translating');
        };
        if (/translated/.test(document.documentElement.className)) {
          reveal();
        } else if (window.MutationObserver) {
          var obs = new MutationObserver(function () {
            if (/translated/.test(document.documentElement.className)) { obs.disconnect(); reveal(); }
          });
          obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }
        setTimeout(reveal, 2000);
        startGreekFixes();
      } else {
        document.body.classList.remove('translating');
      }
    }());

