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
        navbar.style.background = 'rgba(10,35,66,1)';
      } else {
        navbar.style.background = 'rgba(10,35,66,0.97)';
      }
    });

    // Form handling
    var enquiryForm = document.getElementById('enquiry-form');
    if (enquiryForm) {
      enquiryForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var msg = document.getElementById('form-message');
        var btn = this.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.textContent = 'Sending\u2026';
        // Simulate submission — replace with real endpoint as needed
        setTimeout(function() {
          msg.style.color = '#C9A84C';
          msg.textContent = 'Thank you for your enquiry. We will be in touch shortly.';
          btn.disabled = false;
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Sent';
        }, 900);
      });
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
