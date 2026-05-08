(function () {
  'use strict';

  var isMobile = window.innerWidth < 768;
  var SIZE = isMobile ? 120 : 180;

  /* ── Outer widget (fixed bottom-right) ── */
  var widget = document.createElement('div');
  widget.id = 'heart-widget';
  widget.style.cssText =
    'position:fixed;bottom:20px;right:20px;z-index:998;' +
    'display:flex;flex-direction:column;align-items:flex-end;' +
    'user-select:none;-webkit-user-select:none;';

  /* ── Row: rhythm panel + canvas ── */
  var row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-direction:row;align-items:center;gap:8px;';

  /* ── Rhythm buttons ── */
  var RHYTHMS = [
    { id: 'normal', label: 'Normal' },
    { id: 'af',     label: 'AF' },
    { id: 'svt',    label: 'SVT' },
    { id: 'vt',     label: 'VT' },
    { id: 'block',  label: 'Heart Block' }
  ];
  var currentRhythm = 'normal';

  var panel = document.createElement('div');
  panel.style.cssText =
    'display:' + (isMobile ? 'none' : 'flex') + ';flex-direction:column;gap:5px;';

  RHYTHMS.forEach(function (r) {
    var btn = document.createElement('button');
    btn.textContent = r.label;
    var active = r.id === 'normal';
    btn.style.cssText =
      'width:76px;padding:5px 0;font:10px/1.2 Georgia,serif;' +
      'border-radius:20px;cursor:pointer;outline:none;' +
      'border:1px solid #C9A84C;transition:background 0.2s,color 0.2s;' +
      (active
        ? 'background:#C9A84C;color:#0A2342;font-weight:bold;'
        : 'background:rgba(10,35,66,0.88);color:#e8dcc5;font-weight:normal;');
    btn.addEventListener('click', function () {
      currentRhythm = r.id;
      panel.querySelectorAll('button').forEach(function (b) {
        b.style.background = 'rgba(10,35,66,0.88)';
        b.style.color = '#e8dcc5';
        b.style.fontWeight = 'normal';
      });
      btn.style.background = '#C9A84C';
      btn.style.color = '#0A2342';
      btn.style.fontWeight = 'bold';
    });
    panel.appendChild(btn);
  });

  /* ── Canvas wrapper ── */
  var canvasWrap = document.createElement('div');
  canvasWrap.style.cssText =
    'width:' + SIZE + 'px;height:' + SIZE + 'px;' +
    'cursor:grab;flex-shrink:0;';
  canvasWrap.title = 'Click to learn about heart conditions';

  row.appendChild(panel);
  row.appendChild(canvasWrap);
  widget.appendChild(row);

  /* ── Persistent tooltip ── */
  var tipEl = document.createElement('div');
  tipEl.textContent = 'Drag to rotate \u00b7 Click rhythm to change';
  tipEl.style.cssText =
    'margin-top:5px;font:9px/1 Georgia,serif;color:rgba(201,168,76,0.72);' +
    'text-align:right;white-space:nowrap;letter-spacing:0.02em;' +
    (isMobile ? 'display:none;' : '');
  widget.appendChild(tipEl);

  document.body.appendChild(widget);

  /* ── Load Three.js r128 from CDN then initialise ── */
  if (window.THREE) {
    initHeart();
  } else {
    var scr = document.createElement('script');
    scr.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    scr.crossOrigin = 'anonymous';
    scr.onload = initHeart;
    scr.onerror = function () { widget.style.display = 'none'; };
    document.head.appendChild(scr);
  }

  function initHeart() {
    var T = window.THREE;

    /* ── Renderer ── */
    var renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(SIZE, SIZE);
    renderer.setClearColor(0x000000, 0);
    canvasWrap.appendChild(renderer.domElement);

    /* ── Scene & camera ── */
    var scene  = new T.Scene();
    var camera = new T.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 5;

    /* ── Lights ── */
    // Ambient base
    scene.add(new T.AmbientLight(0xffffff, 0.35));
    // Warm white key from above
    var keyLight = new T.DirectionalLight(0xfff8e7, 1.1);
    keyLight.position.set(2, 8, 5);
    scene.add(keyLight);
    // Soft gold from the side for depth
    var sideLight = new T.DirectionalLight(0xC9A84C, 0.55);
    sideLight.position.set(-5, 1, 3);
    scene.add(sideLight);
    // Subtle red rim from below
    var rimLight = new T.DirectionalLight(0xff2200, 0.12);
    rimLight.position.set(0, -5, 1);
    scene.add(rimLight);

    /* ── Anatomical heart built from primitive geometry ──
       Component layout (Y-up, Z-toward-viewer):

         RA   LA          ← atria (upper, right & left)
          | | |
         [aorta / PA]     ← great vessels between atria
          |
         RV + LV          ← ventricles (lower, LV dominant)
              ↓ apex

       Coordinate origin placed near the visual centre of the whole group.
       The group receives a slight clockwise Z-tilt (-14°) so the apex
       points naturally down-left, as in the anatomical position.

       Colour palette:
         Ventricles  #7B1010 / #9B2020  (thick dark-red muscle)
         Atria       #B03535             (thinner, lighter red)
         Aorta       #EEE0CC             (cream / off-white artery)
         Pulm. trunk #D8ECF4             (pale blue-white)
    */

    /* material helpers */
    function mMuscle(hex) {
      return new T.MeshPhongMaterial({
        color: hex, specular: 0x331111, emissive: 0x0c0000, shininess: 85
      });
    }
    function mVessel(hex) {
      return new T.MeshPhongMaterial({
        color: hex, specular: 0x888877, emissive: 0x040402, shininess: 130
      });
    }

    var heartGroup = new T.Group();

    /* Left Ventricle — dominant, elongated, lower-centre-left */
    var lv = new T.Mesh(new T.SphereGeometry(0.5, 32, 24), mMuscle(0x7B1010));
    lv.scale.set(1.0, 1.32, 0.88);
    lv.position.set(-0.12, -0.26, 0);
    heartGroup.add(lv);

    /* Right Ventricle — smaller, wraps front-right of LV */
    var rv = new T.Mesh(new T.SphereGeometry(0.37, 32, 24), mMuscle(0x9B2020));
    rv.scale.set(0.88, 1.1, 0.72);
    rv.position.set(0.32, -0.13, 0.13);
    heartGroup.add(rv);

    /* Left Atrium — upper-left-back, receives pulmonary veins */
    var la = new T.Mesh(new T.SphereGeometry(0.3, 32, 24), mMuscle(0xB03535));
    la.scale.set(0.95, 0.82, 0.88);
    la.position.set(-0.22, 0.35, -0.12);
    heartGroup.add(la);

    /* Right Atrium — upper-right, receives systemic veins */
    var ra = new T.Mesh(new T.SphereGeometry(0.28, 32, 24), mMuscle(0xB03535));
    ra.scale.set(0.90, 0.82, 0.85);
    ra.position.set(0.35, 0.30, 0);
    heartGroup.add(ra);

    /* Aorta — stem rising from LV outlet */
    var aortaStem = new T.Mesh(
      new T.CylinderGeometry(0.09, 0.115, 0.52, 16), mVessel(0xEEE0CC));
    aortaStem.rotation.z = 0.12;
    aortaStem.position.set(-0.03, 0.60, 0);
    heartGroup.add(aortaStem);

    /* Aortic arch — short horizontal segment curving left */
    var aortaArch = new T.Mesh(
      new T.CylinderGeometry(0.08, 0.09, 0.38, 16), mVessel(0xEEE0CC));
    aortaArch.rotation.z = Math.PI / 2 - 0.25;
    aortaArch.position.set(-0.27, 0.82, 0);
    heartGroup.add(aortaArch);

    /* Pulmonary trunk — exits RV, rises up-right toward the lungs */
    var pa = new T.Mesh(
      new T.CylinderGeometry(0.08, 0.10, 0.46, 16), mVessel(0xD8ECF4));
    pa.rotation.z = -0.22;
    pa.position.set(0.22, 0.52, 0.10);
    heartGroup.add(pa);

    /* Anatomical tilt: apex (LV bottom) points down-left */
    heartGroup.rotation.z = -0.14;

    var BS = 0.88; // base scale — pulse() always returns BS × factor
    heartGroup.scale.setScalar(BS);
    scene.add(heartGroup);

    /* alias used by the interaction & animation code below */
    var mesh = heartGroup;

    /* ── Drag-to-rotate state ── */
    var dragging = false;
    var px = 0, py = 0, vx = 0, vy = 0;
    var startX = 0, startY = 0;
    var AUTO_Y = (2 * Math.PI) / 7; // full revolution every 7 s

    var cvs = renderer.domElement;

    function onDown(cx, cy) {
      dragging = true;
      px = cx; py = cy;
      startX = cx; startY = cy;
      vx = 0; vy = 0;
      canvasWrap.style.cursor = 'grabbing';
    }
    function onMove(cx, cy) {
      if (!dragging) return;
      var dx = cx - px, dy = cy - py;
      mesh.rotation.y += dx * 0.012;
      mesh.rotation.x  = Math.max(-1.2, Math.min(1.2, mesh.rotation.x + dy * 0.012));
      vx = dx; vy = dy;
      px = cx; py = cy;
    }
    function onUp(cx, cy) {
      if (!dragging) return;
      dragging = false;
      canvasWrap.style.cursor = 'grab';
      var dist = Math.sqrt(Math.pow(cx - startX, 2) + Math.pow(cy - startY, 2));
      if (dist < 6) {
        window.location.href = 'patient-education.html';
      }
    }

    /* Mouse */
    cvs.addEventListener('mousedown', function (e) {
      onDown(e.clientX, e.clientY);
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) { onMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup',   function (e) { onUp(e.clientX, e.clientY); });

    /* Touch */
    cvs.addEventListener('touchstart', function (e) {
      onDown(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener('touchmove', function (e) {
      if (dragging && e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    window.addEventListener('touchend', function (e) {
      if (e.changedTouches[0]) onUp(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    }, { passive: true });

    /* ── Rhythm pulse functions ──
       Each returns the target mesh scale for the current moment in time.

       Normal     70 bpm  — regular sinusoidal beat
       AF                 — chaotic irregular twitches (incommensurate frequencies)
       SVT       180 bpm  — very fast regular beats
       VT        150 bpm  — fast, wide, large-amplitude (dangerous pattern)
       HeartBlock  40 bpm — sharp quick spike then long pause */
    function pulse(nowMs) {
      var t = nowMs / 1000; // seconds
      switch (currentRhythm) {
        case 'normal': {
          var ph = (t * 70 / 60) % 1;
          return BS * (1 + 0.09 * Math.max(0, Math.sin(2 * Math.PI * ph)));
        }
        case 'af': {
          return BS * (1
            + 0.050 * Math.max(0, Math.sin(2 * Math.PI * 2.3 * t))
            + 0.040 * Math.max(0, Math.sin(2 * Math.PI * 3.7 * t + 1.10))
            + 0.030 * Math.max(0, Math.sin(2 * Math.PI * 5.1 * t + 2.30))
            + 0.025 * Math.max(0, Math.sin(2 * Math.PI * 4.4 * t + 0.70))
          );
        }
        case 'svt': {
          var ph2 = (t * 180 / 60) % 1;
          return BS * (1 + 0.07 * Math.max(0, Math.sin(2 * Math.PI * ph2)));
        }
        case 'vt': {
          // Wide sine pulse over each cycle (full half-period = broad contraction)
          var ph3 = (t * 150 / 60) % 1;
          return BS * (1 + 0.15 * Math.max(0, Math.sin(Math.PI * ph3)));
        }
        case 'block': {
          // Sharp spike in the first 15% of each 1.5 s cycle, then silence
          var period  = 60 / 40;
          var cyclePos = (t % period) / period;
          return BS * (1 + (cyclePos < 0.15
            ? 0.12 * Math.sin(Math.PI * cyclePos / 0.15)
            : 0));
        }
        default:
          return BS;
      }
    }

    /* ── Render loop ── */
    var prev = performance.now();
    (function loop() {
      requestAnimationFrame(loop);
      var now = performance.now();
      var dt  = Math.min((now - prev) / 1000, 0.1);
      prev = now;

      if (!dragging) {
        // Decay momentum then resume auto-rotation
        vx *= 0.88;
        vy *= 0.88;
        mesh.rotation.y += vx * 0.007 + AUTO_Y * dt;
        mesh.rotation.x += vy * 0.007;
        // Gently drift X back to upright over ~1–2 s
        mesh.rotation.x *= 0.96;
      }

      mesh.scale.setScalar(pulse(now));
      renderer.render(scene, camera);
    }());

    /* ── Responsive resize ── */
    window.addEventListener('resize', function () {
      var m  = window.innerWidth < 768;
      var ns = m ? 120 : 180;
      renderer.setSize(ns, ns);
      canvasWrap.style.width  = ns + 'px';
      canvasWrap.style.height = ns + 'px';
      panel.style.display  = m ? 'none' : 'flex';
      tipEl.style.display  = m ? 'none' : '';
    });
  }
}());
