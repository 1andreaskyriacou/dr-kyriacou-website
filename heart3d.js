/* heart3d.js — Three.js GLB heart viewer with arrhythmia beat animations */
(function () {
  'use strict';

  var THREE = window.THREE;
  var scene, camera, renderer, clock;
  var modelGroup = null;
  var cond = 'normal';
  var elapsed = 0;
  var drag = false, pm = { x: 0, y: 0 };
  var rotX = 0.12, rotY = 0.5;

  // ── Beat envelope ────────────────────────────────────────────────────────
  // phase [0,1] → amplitude [0,1]: fast systolic rise, slower diastolic decay
  function beat(ph) {
    if (ph < 0.15) return Math.sin(ph / 0.15 * Math.PI / 2);
    if (ph < 0.28) return 1.0 - (ph - 0.15) / 0.13 * 0.20;
    return 0.80 * Math.max(0.0, 1.0 - (ph - 0.28) / 0.72);
  }

  // ── Per-condition scale ──────────────────────────────────────────────────
  function getScale(c, t) {
    var p, pos, ph, np, cl;
    switch (c) {

      case 'normal':
        p = 60 / 70;
        return 1.0 - 0.080 * beat((t % p) / p);

      case 'af':
        // Irregular timing from overlapping low-frequency sinusoids
        p = 0.62 + Math.sin(t * 9.8) * 0.062 + Math.sin(t * 13.7) * 0.030
               + Math.sin(t * 7.1) * 0.018;
        p = Math.max(0.36, Math.min(0.92, p));
        // Slight amplitude variation for the chaotic feel
        return 1.0 - (0.065 + 0.018 * Math.sin(t * 5.3)) * beat((t % p) / p);

      case 'flutter':
        // 150 bpm = 0.40 s period
        return 1.0 - 0.077 * beat((t % 0.40) / 0.40);

      case 'at':
        // 160 bpm
        p = 60 / 160;
        return 1.0 - 0.077 * beat((t % p) / p);

      case 'svt':
        // 200 bpm = 0.30 s; slightly reduced stroke volume
        return 1.0 - 0.068 * beat((t % 0.30) / 0.30);

      case 'vt':
        // 180 bpm, marginally exaggerated contraction
        p = 60 / 180;
        return 1.0 - 0.085 * beat((t % p) / p);

      case 'pvc':
        // 4 normal beats, 1 early PVC (short interval), compensatory pause
        np = 60 / 70;            // 0.833 s normal period
        cl = np * 4 + 0.44 + np * 1.40;  // cycle ≈ 5.50 s
        pos = t % cl;
        ph = 0;
        if      (pos < np)           ph = pos / np;
        else if (pos < np * 2)       ph = (pos - np) / np;
        else if (pos < np * 3)       ph = (pos - np * 2) / np;
        else if (pos < np * 4)       ph = (pos - np * 3) / np;
        else if (pos < np * 4 + 0.44) ph = (pos - np * 4) / 0.44;
        // compensatory pause: ph stays 0
        return 1.0 - 0.080 * beat(ph);

      case 'csp':
      case 'crt':
        // Paced regular 70 bpm, coordinated contraction
        p = 60 / 70;
        return 1.0 - 0.080 * beat((t % p) / p);

      default:
        p = 60 / 70;
        return 1.0 - 0.080 * beat((t % p) / p);
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    if (!THREE || !THREE.GLTFLoader) {
      console.warn('heart3d: THREE or GLTFLoader not available');
      return;
    }

    var canvas = document.getElementById('heart3d-canvas');
    var wrap   = document.getElementById('heart3d-canvas-wrap');
    if (!canvas || !wrap) return;

    var w = wrap.clientWidth || 360;

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf9f6f1);

    // Camera: square aspect (1:1 container)
    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(0, 0.1, 5.0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, w, false); // false → don't overwrite CSS size
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

    clock = new THREE.Clock();

    // ── Lighting ─────────────────────────────────────────────────────────
    // Strong ambient so no part of the model is lost in shadow
    scene.add(new THREE.AmbientLight(0xffffff, 1.8));

    // Key light: upper-front-right, warm
    var key = new THREE.DirectionalLight(0xfff8f0, 1.0);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    scene.add(key);

    // Fill: left-side, warm pink-orange
    var fill = new THREE.DirectionalLight(0xffe0d8, 0.60);
    fill.position.set(-4, 1, 2);
    scene.add(fill);

    // Rim: below-rear, cool blue — separates model from background
    var rim = new THREE.DirectionalLight(0xd0e4ff, 0.35);
    rim.position.set(0, -3, -4);
    scene.add(rim);

    // ── Load GLB ─────────────────────────────────────────────────────────
    var loader = new THREE.GLTFLoader();
    loader.load(
      'heart.glb',
      function (gltf) {
        modelGroup = new THREE.Group();
        var model  = gltf.scene;

        // Centre the model at world origin
        var box    = new THREE.Box3().setFromObject(model);
        var centre = new THREE.Vector3();
        box.getCenter(centre);
        model.position.sub(centre);

        // Scale to fit nicely in a ~3-unit sphere
        var sz = new THREE.Vector3();
        box.getSize(sz);
        model.scale.setScalar(3.0 / Math.max(sz.x, sz.y, sz.z));

        // Enable shadows on every mesh
        model.traverse(function (ch) {
          if (ch.isMesh) { ch.castShadow = true; ch.receiveShadow = true; }
        });

        modelGroup.add(model);
        modelGroup.rotation.x = rotX;
        modelGroup.rotation.y = rotY;
        scene.add(modelGroup);
      },
      undefined,
      function (err) { console.error('heart.glb load error:', err); }
    );

    // ── Drag rotation ─────────────────────────────────────────────────────
    function onDown(cx, cy) { drag = true;  pm.x = cx; pm.y = cy; }
    function onMove(cx, cy) {
      if (!drag || !modelGroup) return;
      rotY += (cx - pm.x) * 0.012;
      rotX += (cy - pm.y) * 0.009;
      rotX  = Math.max(-1.2, Math.min(1.2, rotX));
      pm.x  = cx; pm.y = cy;
    }
    function onUp() { drag = false; }

    canvas.addEventListener('mousedown',  function (e) { onDown(e.clientX, e.clientY); });
    window.addEventListener('mousemove',  function (e) { onMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup',    onUp);

    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) onDown(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      if (!drag || !modelGroup || e.touches.length !== 1) return;
      e.preventDefault();
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    canvas.addEventListener('touchend', onUp);

    // ── Resize ───────────────────────────────────────────────────────────
    window.addEventListener('resize', function () {
      var w2 = document.getElementById('heart3d-canvas-wrap');
      if (!w2 || !renderer) return;
      var nw = w2.clientWidth;
      if (nw > 0) renderer.setSize(nw, nw, false);
    });

    // ── Render loop ───────────────────────────────────────────────────────
    (function loop() {
      requestAnimationFrame(loop);
      var dt = clock.getDelta();
      elapsed += dt;

      // Slow auto-rotate when user is not dragging
      if (!drag && modelGroup) rotY += dt * 0.15;

      if (modelGroup) {
        modelGroup.rotation.x = rotX;
        modelGroup.rotation.y = rotY;
        modelGroup.scale.setScalar(getScale(cond, elapsed));
      }

      renderer.render(scene, camera);
    }());
  }

  // ── Patch aeSwitch ───────────────────────────────────────────────────────
  // scripts.js defines aeSwitch synchronously; it already exists at this point.
  var origSwitch = window.aeSwitch;
  if (origSwitch) {
    window.aeSwitch = function (c) { origSwitch(c); cond = c; };
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────
  // Use rAF inside DOMContentLoaded so the first browser layout is done
  // before we query clientWidth.
  document.addEventListener('DOMContentLoaded', function () {
    requestAnimationFrame(init);
  });

}());
