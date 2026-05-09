/* heart3d.js — Three.js GLB heart viewer, physiologically-accurate arrhythmia timing */
(function () {
  'use strict';

  var THREE = window.THREE;

  var scene, camera, renderer, clock;
  var modelGroup = null;
  var drag = false, pm = { x: 0, y: 0 };
  var rotX = 0.12, rotY = 0.5;

  // ── Bone groups (exact names, no dot separator) ───────────────────────────────
  var ATRIA_NAMES = [
    'right_atrium_jnt6_6',
    'left_atrium_jnt13_13',
    'left_atrium_storage_jnt14_14'
  ];
  var VENTS_NAMES = [
    'cardiac_muscle_jnt7_7',
    'cardiac_muscle_endjnt8_8',
    'right_pulmonary_valve_jnt9_9',
    'left_pulmonary_valve_jnt11_11',
    'left_mitral_valve_jnt15_15',
    'right_mitral_valve_jnt16_16',
    'aortic_valve_02_jnt17_17',
    'aortic_valve_03_jnt19_19',
    'aortic_valve_01_jnt21_21',
    'left_tricuspid_valve_jnt23_23',
    'right_tricuspid_valve_jnt24_24'
  ];

  // Bone data: { bone, restScale: Vector3, restRot: {x,y,z} }
  var bonesAtria = [];
  var bonesVents = [];

  // Contraction amplitudes and durations
  var ATRIA_ROT    = 0.32;  // radians — rotation applied at peak atrial contraction
  var ATRIA_SCALE  = 0.18;  // fraction scale-down at peak (layered on top of rotation)
  var ATRIA_DUR    = 140;   // ms
  var ATRIA_AF_AMT = 0.40;  // AF quiver uses reduced rotation (× this fraction)
  var VENTS_ROT    = 0.20;  // radians — peak ventricular contraction rotation
  var VENTS_SCALE  = 0.22;  // fraction scale-down for ventricles
  var VENTS_DUR    = 290;   // ms

  // ── Contraction envelope: fast attack (20%), smooth decay (80%) ──────────────
  function contEnv(elMs, durMs) {
    var t = elMs / durMs;
    if (t <= 0 || t >= 1) return 0;
    return t < 0.20 ? t / 0.20 : 1.0 - (t - 0.20) / 0.80;
  }

  // ── Active contractions pool ─────────────────────────────────────────────────
  var contractions = [];
  var _aFireCount  = 0; // diagnostic counter

  function fire(tp, frac) {
    // frac: 0–1 multiplier on the full amplitude (default 1)
    var f = (frac !== undefined) ? frac : 1;
    if (tp === 'a') {
      _aFireCount++;
      if (_aFireCount <= 6 || _aFireCount % 20 === 0) {
        console.log('heart3d: atrial contraction #' + _aFireCount
                    + '  cond=' + cond + '  frac=' + f.toFixed(2));
      }
    }
    contractions.push({ tp: tp, t0: performance.now(), frac: f });
  }

  function applyContractions() {
    var now  = performance.now();
    var aEnv = 0, vEnv = 0;
    var alive = [];

    contractions.forEach(function (c) {
      var dur = c.tp === 'a' ? ATRIA_DUR : VENTS_DUR;
      var el  = now - c.t0;
      var e   = contEnv(el, dur) * c.frac;
      if (el < dur) alive.push(c);
      if (c.tp === 'a') aEnv = Math.max(aEnv, e);
      else              vEnv = Math.max(vEnv, e);
    });
    contractions = alive;

    // Atria: rotation on X and Z axes + scale compression
    bonesAtria.forEach(function (d) {
      var rot = ATRIA_ROT * aEnv;
      var sc  = 1 - ATRIA_SCALE * aEnv;
      d.bone.rotation.x = d.restRot.x + rot;
      d.bone.rotation.z = d.restRot.z + rot;
      d.bone.scale.set(d.restScale.x * sc, d.restScale.y * sc, d.restScale.z * sc);
    });

    // Ventricles + valves: rotation on X axis + scale compression
    bonesVents.forEach(function (d) {
      var rot = VENTS_ROT * vEnv;
      var sc  = 1 - VENTS_SCALE * vEnv;
      d.bone.rotation.x = d.restRot.x + rot;
      d.bone.scale.set(d.restScale.x * sc, d.restScale.y * sc, d.restScale.z * sc);
    });
  }

  // ── Rhythm state ─────────────────────────────────────────────────────────────
  var cond  = 'normal';
  var nextA = 0;
  var nextV = 0;

  var PVC_CYCLE = 4448;
  var PVC_TPL   = [
    { dt: 0,    tp: 'a' }, { dt: 120,  tp: 'v' },
    { dt: 857,  tp: 'a' }, { dt: 977,  tp: 'v' },
    { dt: 1714, tp: 'a' }, { dt: 1834, tp: 'v' },
    { dt: 2571, tp: 'a' }, { dt: 2691, tp: 'v' },
    { dt: 3248, tp: 'v' }  // PVC — vents only
  ];
  var pvcQueue     = [];
  var pvcNextCycle = 0;

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  var COND_LABELS = {
    normal:  'Normal Sinus Rhythm',
    af:      'Atrial Fibrillation',
    flutter: 'Atrial Flutter',
    at:      'Atrial Tachycardia',
    svt:     'SVT',
    vt:      'Ventricular Tachycardia',
    pvc:     'Ventricular Ectopics',
    csp:     'Conduction System Pacing',
    crt:     'CRT'
  };

  function updateFsLabel() {
    var el = document.getElementById('heart3d-fs-label');
    if (el) el.textContent = COND_LABELS[cond] || cond;
  }

  // ── Start / switch rhythm ─────────────────────────────────────────────────────
  function startRhythm(c) {
    cond = c;
    contractions = [];
    _aFireCount  = 0;
    updateFsLabel();
    var now = performance.now();

    switch (c) {
      case 'normal': case 'csp': case 'crt':
        nextA = now; nextV = now + 120; break;
      case 'flutter':
        nextA = now; nextV = now; break;
      case 'svt':
        nextA = now; nextV = now; break;
      case 'vt':
        nextV = now; nextA = now + rand(0, 800); break;
      case 'af':
        nextA = now; nextV = now + rand(50, 300); break;
      case 'pvc':
        pvcQueue = []; pvcNextCycle = now; break;
    }
  }

  // ── Per-frame rhythm tick ─────────────────────────────────────────────────────
  function tickRhythm() {
    var now = performance.now();

    switch (cond) {
      case 'normal': case 'csp': case 'crt':
        if (now >= nextA) { fire('a');              nextA += 857; }
        if (now >= nextV) { fire('v');              nextV += 857; }
        break;
      case 'flutter':
        if (now >= nextA) { fire('a');              nextA += 200; }
        if (now >= nextV) { fire('v');              nextV += 400; }
        break;
      case 'svt':
        if (now >= nextA) { fire('a'); fire('v');   nextA += 300; nextV = nextA; }
        break;
      case 'vt':
        if (now >= nextA) { fire('a');              nextA += 857; }
        if (now >= nextV) { fire('v');              nextV += 333; }
        break;
      case 'af':
        if (now >= nextA) { fire('a', ATRIA_AF_AMT); nextA += rand(210, 490); }
        if (now >= nextV) { fire('v');                nextV += rand(400, 900); }
        break;
      case 'pvc':
        tickPvc(now); break;
    }
  }

  function tickPvc(now) {
    while (pvcNextCycle < now + PVC_CYCLE * 2) {
      var cs = pvcNextCycle;
      PVC_TPL.forEach(function (ev) {
        pvcQueue.push({ fireMs: cs + ev.dt, tp: ev.tp });
      });
      pvcNextCycle += PVC_CYCLE;
    }
    var rem = [];
    pvcQueue.forEach(function (ev) {
      if (now >= ev.fireMs) fire(ev.tp);
      else rem.push(ev);
    });
    pvcQueue = rem;
  }

  // ── Fullscreen helpers ────────────────────────────────────────────────────────
  function isFullscreen() {
    return document.body.classList.contains('heart-fullscreen');
  }

  function resizeRenderer() {
    if (!renderer) return;
    if (isFullscreen()) {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    } else {
      var wrap = document.getElementById('heart3d-canvas-wrap');
      if (wrap && wrap.clientWidth > 0) {
        camera.aspect = 1;
        camera.updateProjectionMatrix();
        renderer.setSize(wrap.clientWidth, wrap.clientWidth, false);
      }
    }
  }

  function enterFullscreen() {
    document.body.classList.add('heart-fullscreen');
    resizeRenderer();
    updateFsLabel();
  }

  function exitFullscreen() {
    document.body.classList.remove('heart-fullscreen');
    resizeRenderer();
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    if (!THREE || !THREE.GLTFLoader) {
      console.warn('heart3d: THREE or GLTFLoader not available');
      return;
    }
    var canvas = document.getElementById('heart3d-canvas');
    var wrap   = document.getElementById('heart3d-canvas-wrap');
    if (!canvas || !wrap) return;

    var w = wrap.clientWidth || 360;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf9f6f1);

    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
    camera.position.set(0, 0.1, 5.0);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, w, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

    clock = new THREE.Clock();

    scene.add(new THREE.AmbientLight(0xffffff, 1.8));
    var key = new THREE.DirectionalLight(0xfff8f0, 1.0);
    key.position.set(3, 5, 4); key.castShadow = true; key.shadow.mapSize.set(512, 512);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xffe0d8, 0.60);
    fill.position.set(-4, 1, 2); scene.add(fill);
    var rim = new THREE.DirectionalLight(0xd0e4ff, 0.35);
    rim.position.set(0, -3, -4); scene.add(rim);

    // ── Load GLB ─────────────────────────────────────────────────────────────
    var loader = new THREE.GLTFLoader();
    loader.load(
      'heart.glb',
      function (gltf) {
        // Explicitly suppress any built-in animations
        if (gltf.animations && gltf.animations.length > 0) {
          console.log('heart3d: GLB has', gltf.animations.length,
                      'built-in clip(s) — suppressed; timing engine drives all motion');
        }

        modelGroup = new THREE.Group();
        var model  = gltf.scene;

        // ── Centre and scale ─────────────────────────────────────────────────
        var box    = new THREE.Box3().setFromObject(model);
        var centre = new THREE.Vector3();
        box.getCenter(centre);
        var sz = new THREE.Vector3();
        box.getSize(sz);
        var s = 3.0 / Math.max(sz.x, sz.y, sz.z);
        model.scale.setScalar(s);
        model.position.copy(centre).multiplyScalar(-s);

        // Camera distance from bounding sphere
        var halfDiag = 0.5 * Math.sqrt(sz.x*sz.x + sz.y*sz.y + sz.z*sz.z) * s;
        var fovHalf  = camera.fov * (Math.PI / 180) / 2;
        var dist     = Math.max(4.5, halfDiag / Math.tan(fovHalf) * 1.20);
        camera.position.set(0, halfDiag * 0.08, dist);

        // ── Collect bones ────────────────────────────────────────────────────
        model.traverse(function (node) {
          if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }

          function tryAdd(b) {
            var d = { bone: b, restScale: b.scale.clone(),
                      restRot: { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z } };
            if (ATRIA_NAMES.indexOf(b.name) !== -1) bonesAtria.push(d);
            if (VENTS_NAMES.indexOf(b.name) !== -1) bonesVents.push(d);
          }

          if (node.isSkinnedMesh && node.skeleton) {
            node.skeleton.bones.forEach(tryAdd);
          }
          if (node.isBone || node.type === 'Bone') tryAdd(node);
        });

        function dedupe(arr) {
          return arr.filter(function (d, i) {
            return arr.findIndex(function (x) { return x.bone === d.bone; }) === i;
          });
        }
        bonesAtria = dedupe(bonesAtria);
        bonesVents = dedupe(bonesVents);

        console.log('heart3d: atria bones:', bonesAtria.map(function (d) { return d.bone.name; }));
        console.log('heart3d: vent/valve bones:', bonesVents.map(function (d) { return d.bone.name; }));

        modelGroup.add(model);
        modelGroup.rotation.x = rotX;
        modelGroup.rotation.y = rotY;
        scene.add(modelGroup);

        startRhythm(cond);
      },
      undefined,
      function (err) { console.error('heart.glb load error:', err); }
    );

    // ── Drag rotation ─────────────────────────────────────────────────────────
    function onDown(cx, cy) { drag = true; pm.x = cx; pm.y = cy; }
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

    // ── Fullscreen buttons ────────────────────────────────────────────────────
    var btnExpand = document.getElementById('heart3d-expand');
    var btnClose  = document.getElementById('heart3d-close');

    if (btnExpand) btnExpand.addEventListener('click', enterFullscreen);
    if (btnClose)  btnClose.addEventListener('click',  exitFullscreen);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isFullscreen()) exitFullscreen();
    });

    // ── Resize ────────────────────────────────────────────────────────────────
    window.addEventListener('resize', resizeRenderer);

    // ── Render loop ───────────────────────────────────────────────────────────
    (function loop() {
      requestAnimationFrame(loop);
      var dt = clock.getDelta();
      if (!drag && modelGroup) rotY += dt * 0.15;
      if (modelGroup) {
        modelGroup.rotation.x = rotX;
        modelGroup.rotation.y = rotY;
        tickRhythm();
        applyContractions();
      }
      renderer.render(scene, camera);
    }());
  }

  // ── Patch aeSwitch ────────────────────────────────────────────────────────────
  var origSwitch = window.aeSwitch;
  if (origSwitch) {
    window.aeSwitch = function (c) { origSwitch(c); startRhythm(c); };
  }

  document.addEventListener('DOMContentLoaded', function () {
    requestAnimationFrame(init);
  });

}());
