(function () {
  'use strict';

  var isMobile = window.innerWidth < 768;
  var widgetSize = isMobile ? 120 : 200;

  /* ── Container ── */
  var wrap = document.createElement('div');
  wrap.id = 'heart-widget';
  wrap.style.position = 'fixed';
  wrap.style.bottom = isMobile ? '12px' : '24px';
  wrap.style.right  = isMobile ? '12px' : '24px';
  wrap.style.width  = widgetSize + 'px';
  wrap.style.height = widgetSize + 'px';
  wrap.style.zIndex = '998';
  wrap.style.cursor = 'pointer';
  wrap.style.background = 'transparent';

  /* ── Tooltip ── */
  var tip = document.createElement('div');
  tip.textContent = 'Interactive Heart Model';
  tip.style.cssText =
    'position:absolute;bottom:calc(100% + 6px);right:0;' +
    'background:rgba(10,35,66,0.92);color:#C9A84C;' +
    'font:12px/1.4 Georgia,serif;padding:4px 10px;border-radius:4px;' +
    'border:1px solid rgba(201,168,76,0.4);white-space:nowrap;' +
    'opacity:0;transition:opacity 0.25s;pointer-events:none;';
  wrap.appendChild(tip);
  document.body.appendChild(wrap);

  var hovered = false;
  wrap.addEventListener('mouseenter', function () { hovered = true;  tip.style.opacity = '1'; });
  wrap.addEventListener('mouseleave', function () { hovered = false; tip.style.opacity = '0'; });

  /* ── Load Three.js r128 then initialise ── */
  if (window.THREE) {
    initHeart();
  } else {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    s.crossOrigin = 'anonymous';
    s.onload = initHeart;
    document.head.appendChild(s);
  }

  function initHeart() {
    var T = window.THREE;

    /* ── Renderer ── */
    var renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(widgetSize, widgetSize);
    renderer.setClearColor(0x000000, 0);
    wrap.appendChild(renderer.domElement);

    /* ── Scene & camera ── */
    var scene  = new T.Scene();
    var camera = new T.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 4.5;

    /* ── Lighting ── */
    scene.add(new T.AmbientLight(0xffffff, 0.45));

    var key = new T.DirectionalLight(0xfff5e0, 1.0);
    key.position.set(3, 5, 5);
    scene.add(key);

    var fill = new T.DirectionalLight(0x661111, 0.3);
    fill.position.set(-3, -1, 2);
    scene.add(fill);

    var glow = new T.PointLight(0xC9A84C, 0, 6);
    glow.position.set(0, 0.5, 3);
    scene.add(glow);

    /* ── Heart shape — parametric curve (bumps up, point down) ──
       x = 16 sin³(t),  y = 13cos(t) − 5cos(2t) − 2cos(3t) − cos(4t)
       At t=0 the curve is near the notch; the bottom point (min y) is
       near t=π.  This naturally produces bumps-up / point-down in 3D. */
    var sc  = 0.065;
    var pts = [];
    for (var i = 0; i <= 120; i++) {
      var t   = (i / 120) * Math.PI * 2;
      var sin = Math.sin(t);
      pts.push(new T.Vector2(
        sc * 16 * sin * sin * sin,
        sc * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))
      ));
    }
    var heartShape = new T.Shape(pts);

    var geo = new T.ExtrudeGeometry(heartShape, {
      depth: 0.35,
      bevelEnabled:   true,
      bevelSegments:  4,
      bevelSize:      0.06,
      bevelThickness: 0.06,
      curveSegments:  12
    });
    geo.center();

    var mat = new T.MeshPhongMaterial({
      color:     0xC0392B,
      specular:  0xC9A84C,
      shininess: 130,
      emissive:  0x1a0000
    });

    var mesh = new T.Mesh(geo, mat);
    var BASE_SCALE = 0.88;
    mesh.scale.setScalar(BASE_SCALE);
    scene.add(mesh);

    /* ── Animation constants ── */
    var normalOmega = (2 * Math.PI) / 4;   // full Y-rotation every 4 s
    var hoverOmega  = normalOmega * 2.5;
    var glowPhase   = 0;
    var prevNow     = performance.now();

    (function loop() {
      requestAnimationFrame(loop);
      var now = performance.now();
      var dt  = Math.min((now - prevNow) / 1000, 0.1);
      prevNow = now;

      /* Y-axis rotation */
      mesh.rotation.y += (hovered ? hoverOmega : normalOmega) * dt;

      /* Heartbeat — 2 Hz, ±10% scale */
      mesh.scale.setScalar(BASE_SCALE * (1 + 0.1 * Math.sin(2 * Math.PI * 2 * now / 1000)));

      /* Gold glow on hover */
      if (hovered) {
        glowPhase += dt * 4;
        glow.intensity = 0.55 + 0.3 * Math.sin(glowPhase);
      } else {
        glow.intensity = Math.max(0, glow.intensity - dt * 2);
        glowPhase = 0;
      }

      renderer.render(scene, camera);
    }());

    /* ── Responsive resize ── */
    window.addEventListener('resize', function () {
      var ns = window.innerWidth < 768 ? 120 : 200;
      if (ns !== widgetSize) {
        widgetSize = ns;
        renderer.setSize(ns, ns);
        wrap.style.width  = ns + 'px';
        wrap.style.height = ns + 'px';
      }
    });
  }
}());
