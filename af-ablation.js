/* af-ablation.js — AF ablation split-screen animation */
(function () {
  'use strict';

  var THREE = window.THREE;

  var scene, camera, renderer, clock;
  var modelGroup = null;
  var cathMesh   = null;
  var cathGeom   = null;
  var ringMeshes = [];

  var ablStep  = 1;      // 1–4
  var isPlaying = true;
  var stepMs   = 0;      // elapsed ms in current step

  // Duration (ms) each step stays before auto-advancing
  var STEP_DUR = [4500, 3500, 3500, 6000];

  // How much of the catheter path is revealed at the start/end of each step
  var REVEAL_FROM = [0.00, 0.48, 0.72, 0.92];
  var REVEAL_TO   = [0.48, 0.72, 0.92, 0.92];

  var cathReveal = 0;

  // Camera / rotation state
  var rotY  = 1.0;   // slightly posterior view to show LA/PV region
  var rotX  = 0.15;

  // Heartbeat state (simple scale pulse, 50 bpm)
  var beatT      = 0;
  var BEAT_PERIOD = 1200; // ms

  // ── Catheter waypoints ────────────────────────────────────────────────────────
  // Heart is auto-scaled to ~3 units, centred at origin.
  // Anatomical orientation (approximate):
  //   RA: slightly right (+x), anterior (+z)
  //   LA: slightly left (−x), posterior (−z)
  //   IVC: enters RA from below (−y)
  var CATH_WPS = [
    new THREE.Vector3( 0.22, -2.50,  0.15),  // IVC, far below heart
    new THREE.Vector3( 0.20, -1.80,  0.12),
    new THREE.Vector3( 0.17, -1.10,  0.08),  // entering IVC
    new THREE.Vector3( 0.14, -0.45,  0.03),  // RA inlet
    new THREE.Vector3( 0.10,  0.10,  0.00),  // mid RA          ← step 1 end
    new THREE.Vector3( 0.04,  0.26, -0.08),  // approaching septum
    new THREE.Vector3(-0.02,  0.34, -0.18),  // at septum        ← step 2 end
    new THREE.Vector3(-0.13,  0.30, -0.28),  // crossing into LA
    new THREE.Vector3(-0.26,  0.22, -0.40),  // LA tip           ← step 3 end / 4
  ];

  // Ablation ring positions — posterior surface near PV ostia
  var PV_POS = [
    new THREE.Vector3(-0.30,  0.38, -0.54),  // upper-left PV (LSPV)
    new THREE.Vector3( 0.06,  0.40, -0.50),  // upper-right PV (RSPV)
    new THREE.Vector3(-0.34, -0.02, -0.52),  // lower-left PV (LIPV)
    new THREE.Vector3( 0.02, -0.06, -0.46),  // lower-right PV (RIPV)
  ];
  var PV_PHASES = [0, 0.5, 0.25, 0.75]; // stagger animation

  // ── UI cache ──────────────────────────────────────────────────────────────────
  var ui = {};

  function cacheUI() {
    ui.counter   = document.getElementById('ablation-step-counter');
    ui.playBtn   = document.getElementById('ablation-play-pause');
    ui.prevBtn   = document.getElementById('ablation-prev');
    ui.nextBtn   = document.getElementById('ablation-next');
    ui.stepLabel = document.getElementById('ablation-step-label');
    ui.descs     = document.querySelectorAll('.ablation-step-desc');
    ui.overlays  = [1, 2, 3, 4].map(function (s) {
      return document.getElementById('ablation-2d-step-' + s);
    });
  }

  var STEP_LABELS = [
    'Catheter enters via IVC',
    'Transseptal puncture',
    'Catheter in Left Atrium',
    'Pulmonary Vein Isolation'
  ];

  function goStep(s) {
    ablStep    = Math.max(1, Math.min(4, s));
    stepMs     = 0;
    cathReveal = REVEAL_FROM[ablStep - 1];
    // Rings only visible in step 4
    ringMeshes.forEach(function (r) { r.visible = (ablStep === 4); });
    applyUI();
  }

  function applyUI() {
    if (ui.counter)   ui.counter.textContent   = 'Step ' + ablStep + ' of 4';
    if (ui.stepLabel) ui.stepLabel.textContent = STEP_LABELS[ablStep - 1];

    ui.descs && ui.descs.forEach(function (el) {
      var match = parseInt(el.dataset.step, 10) === ablStep;
      el.style.display = match ? 'block' : 'none';
    });

    ui.overlays && ui.overlays.forEach(function (el, i) {
      if (!el) return;
      el.style.opacity = (i + 1 === ablStep) ? '1' : '0';
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  function init() {
    if (!THREE || !THREE.GLTFLoader) {
      console.warn('af-ablation: THREE or GLTFLoader not available');
      return;
    }
    var canvas = document.getElementById('ablation-canvas');
    var wrap   = document.getElementById('ablation-canvas-wrap');
    if (!canvas || !wrap) return;

    cacheUI();

    var w = wrap.clientWidth || 380;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xEEF2F7);

    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, w, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

    clock = new THREE.Clock();

    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    var key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(3, 5, 4);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-4, 1, 2);
    scene.add(fill);
    var rim = new THREE.DirectionalLight(0xffffff, 0.2);
    rim.position.set(0, -3, -4);
    scene.add(rim);

    var loader = new THREE.GLTFLoader();
    loader.load('heart.glb', onLoaded, undefined, function (e) {
      console.error('af-ablation heart.glb load error:', e);
    });

    window.addEventListener('resize', onResize);

    if (ui.playBtn) ui.playBtn.addEventListener('click', function () {
      isPlaying = !isPlaying;
      ui.playBtn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
    });
    if (ui.prevBtn) ui.prevBtn.addEventListener('click', function () { goStep(ablStep - 1); });
    if (ui.nextBtn) ui.nextBtn.addEventListener('click', function () { goStep(ablStep + 1); });

    (function loop() {
      requestAnimationFrame(loop);
      tick(clock.getDelta());
      renderer.render(scene, camera);
    }());
  }

  function onLoaded(gltf) {
    modelGroup = new THREE.Group();
    var model  = gltf.scene;

    var box = new THREE.Box3().setFromObject(model);
    var ctr = new THREE.Vector3();
    box.getCenter(ctr);
    var sz = new THREE.Vector3();
    box.getSize(sz);
    var s = 3.0 / Math.max(sz.x, sz.y, sz.z);
    model.scale.setScalar(s);
    model.position.copy(ctr).multiplyScalar(-s);

    var hd  = 0.5 * sz.length() * s;
    var fh  = camera.fov * (Math.PI / 180) / 2;
    var dist = Math.max(3.8, hd / Math.tan(fh));
    camera.position.set(0, hd * 0.08, dist);

    model.traverse(function (n) {
      if (!n.isMesh) return;
      n.material = new THREE.MeshStandardMaterial({
        color:     new THREE.Color(0.82, 0.14, 0.09),
        roughness: 0.9,
        metalness: 0.0,
      });
      n.castShadow    = true;
      n.receiveShadow = true;
    });

    modelGroup.rotation.x = rotX;
    modelGroup.rotation.y = rotY;
    modelGroup.add(model);
    scene.add(modelGroup);

    buildCatheter();
    buildRings();
    goStep(1);
  }

  function buildCatheter() {
    var curve = new THREE.CatmullRomCurve3(CATH_WPS);
    cathGeom  = new THREE.TubeGeometry(curve, 160, 0.018, 8, false);
    cathGeom.setDrawRange(0, 0);
    cathMesh  = new THREE.Mesh(cathGeom, new THREE.MeshStandardMaterial({
      color:     0xCC1A00,
      emissive:  new THREE.Color(0.22, 0.0, 0.0),
      roughness: 0.35,
      metalness: 0.15,
    }));
    scene.add(cathMesh);
  }

  function buildRings() {
    PV_POS.forEach(function (pos, i) {
      var geom = new THREE.TorusGeometry(0.11, 0.018, 8, 32);
      var mat  = new THREE.MeshStandardMaterial({
        color:       0xFF5500,
        emissive:    new THREE.Color(0.75, 0.18, 0.0),
        transparent: true,
        opacity:     0.0,
      });
      var mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(pos);
      mesh.rotation.x = Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      ringMeshes.push(mesh);
    });
  }

  function tick(dt) {
    if (!modelGroup) return;

    // Simple scale heartbeat at 50 bpm
    beatT += dt * 1000;
    if (beatT >= BEAT_PERIOD) beatT -= BEAT_PERIOD;
    var bp = beatT / BEAT_PERIOD;
    var bsq = bp < 0.08 ? (1.0 - 0.07 * (bp / 0.08))
            : bp < 0.38 ? (1.0 - 0.07 * (1.0 - (bp - 0.08) / 0.30))
            : 1.0;
    modelGroup.scale.setScalar(bsq);

    // Slow auto-rotate so camera orbits, showing different sides
    rotY += dt * 0.12;
    modelGroup.rotation.y = rotY;

    if (!isPlaying) return;

    stepMs += dt * 1000;
    var dur = STEP_DUR[ablStep - 1];

    // Advance catheter reveal
    var t  = Math.min(1.0, stepMs / (dur * 0.80));
    cathReveal = REVEAL_FROM[ablStep - 1] + t * (REVEAL_TO[ablStep - 1] - REVEAL_FROM[ablStep - 1]);
    if (cathGeom) {
      cathGeom.setDrawRange(0, Math.floor(cathReveal * cathGeom.index.count));
    }

    // Ablation ring pulse (step 4 only)
    if (ablStep === 4) {
      var et = clock.elapsedTime;
      ringMeshes.forEach(function (r, i) {
        var pulse = 0.5 + 0.5 * Math.sin(et * 3.0 + PV_PHASES[i] * Math.PI * 2);
        r.material.opacity = 0.35 + pulse * 0.65;
        r.scale.setScalar(0.75 + pulse * 0.5);
        r.visible = true;
      });
    }

    // Auto-advance
    if (stepMs >= dur) {
      goStep(ablStep < 4 ? ablStep + 1 : 1);
    }
  }

  function onResize() {
    var wrap = document.getElementById('ablation-canvas-wrap');
    if (!wrap || !renderer || !camera) return;
    var w = wrap.clientWidth || 380;
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    renderer.setSize(w, w, false);
  }

  document.addEventListener('DOMContentLoaded', function () {
    requestAnimationFrame(init);
  });

}());
