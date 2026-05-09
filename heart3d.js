/* heart3d.js — Three.js GLB heart viewer, physiologically-accurate arrhythmia timing */
(function () {
  'use strict';

  var THREE = window.THREE;

  var scene, camera, renderer, clock;
  var modelGroup = null, mixer = null;
  var drag = false, pm = { x: 0, y: 0 };
  var rotX = 0.12, rotY = 0.5;

  // ── Bone groups ──────────────────────────────────────────────────────────────
  var ATRIA_NAMES = ['right_atrium_jnt', 'left_atrium_jnt'];
  var VENTS_NAMES = ['cardiac_muscle_jnt'];
  var bonesAtria  = [];
  var bonesVents  = [];
  var useBones    = false;

  // Contraction parameters: amplitude fraction and duration in ms
  var ATRIA_AMT = 0.07, ATRIA_DUR = 130;
  var VENTS_AMT = 0.11, VENTS_DUR = 290;

  // ── Contraction envelope: fast attack (20%), smooth decay (80%) ──────────────
  function contEnv(elMs, durMs) {
    var t = elMs / durMs;
    if (t <= 0 || t >= 1) return 0;
    return t < 0.20 ? t / 0.20 : 1 - (t - 0.20) / 0.80;
  }

  // ── Active contraction pool ──────────────────────────────────────────────────
  // tp: 'a' = atria, 'v' = ventricles
  var contractions = [];

  function fire(tp) {
    contractions.push({ tp: tp, t0: performance.now() });
  }

  function applyContractions() {
    var now  = performance.now();
    var aEnv = 0, vEnv = 0;
    var alive = [];

    contractions.forEach(function (c) {
      var dur = c.tp === 'a' ? ATRIA_DUR : VENTS_DUR;
      var amt = c.tp === 'a' ? ATRIA_AMT : VENTS_AMT;
      var el  = now - c.t0;
      var e   = contEnv(el, dur);
      if (el < dur) alive.push(c);
      if (c.tp === 'a') aEnv = Math.max(aEnv, amt * e);
      else              vEnv = Math.max(vEnv, amt * e);
    });
    contractions = alive;

    var aScale = 1 - aEnv;
    var vScale = 1 - vEnv;

    if (useBones) {
      bonesAtria.forEach(function (b) { b.scale.setScalar(aScale); });
      bonesVents.forEach(function (b) { b.scale.setScalar(vScale); });
    } else if (modelGroup) {
      modelGroup.scale.setScalar(Math.min(aScale, vScale));
    }
  }

  // ── Rhythm state ─────────────────────────────────────────────────────────────
  var cond  = 'normal';
  var nextA = 0; // next atrial fire  — absolute performance.now() ms
  var nextV = 0; // next vent fire    — absolute performance.now() ms

  // PVC: 4 normal beats + early vent + compensatory pause = 4448ms cycle
  // Beat 5 normal vents would fire at 4×857+120 = 3548ms; PVC fires 300ms early → 3248ms.
  // Compensatory pause: next normal beat at 3248+1200 = 4448ms.
  var PVC_CYCLE = 4448;
  var PVC_TPL = [
    { dt: 0,    tp: 'a' }, { dt: 120,  tp: 'v' },
    { dt: 857,  tp: 'a' }, { dt: 977,  tp: 'v' },
    { dt: 1714, tp: 'a' }, { dt: 1834, tp: 'v' },
    { dt: 2571, tp: 'a' }, { dt: 2691, tp: 'v' },
    { dt: 3248, tp: 'v' }, // PVC — vents only, no preceding atrial beat
  ];
  var pvcQueue     = [];
  var pvcNextCycle = 0; // absolute ms for start of next unscheduled cycle

  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

  // ── Start / switch rhythm ─────────────────────────────────────────────────────
  function startRhythm(c) {
    cond = c;
    contractions = [];
    var now = performance.now();

    switch (c) {

      case 'normal':
      case 'csp':
      case 'crt':
        // 70bpm (857ms): atria → 120ms delay → ventricles, coordinated
        nextA = now;
        nextV = now + 120;
        break;

      case 'flutter':
        // Atria 300bpm (200ms); ventricles 150bpm (400ms) — 2:1 block
        nextA = now;
        nextV = now;
        break;

      case 'svt':
        // 200bpm (300ms): atria and ventricles fire simultaneously, no AV delay
        nextA = now;
        nextV = now;
        break;

      case 'vt':
        // Ventricles 180bpm (333ms); atria 70bpm (857ms) fully dissociated
        nextV = now;
        nextA = now + rand(0, 800); // random phase offset for dissociation
        break;

      case 'af':
        // Atria: ~350ms ±40% random; ventricles: irregular 400–900ms, no coordination
        nextA = now;
        nextV = now + rand(50, 300);
        break;

      case 'pvc':
        pvcQueue     = [];
        pvcNextCycle = now;
        break;
    }
  }

  // ── Per-frame rhythm tick ─────────────────────────────────────────────────────
  function tickRhythm() {
    var now = performance.now();

    switch (cond) {

      case 'normal':
      case 'csp':
      case 'crt':
        // 857ms period for both channels; vents offset +120ms
        if (now >= nextA) { fire('a'); nextA += 857; }
        if (now >= nextV) { fire('v'); nextV += 857; }
        break;

      case 'flutter':
        // Atria: 200ms (300bpm). Ventricles: 400ms (150bpm). 2:1 relationship.
        if (now >= nextA) { fire('a'); nextA += 200; }
        if (now >= nextV) { fire('v'); nextV += 400; }
        break;

      case 'svt':
        // All chambers simultaneously every 300ms (200bpm)
        if (now >= nextA) {
          fire('a');
          fire('v');
          nextA += 300;
          nextV = nextA;
        }
        break;

      case 'vt':
        // Atria: 857ms (70bpm), completely dissociated from ventricles
        if (now >= nextA) { fire('a'); nextA += 857; }
        // Ventricles: 333ms (180bpm), independent
        if (now >= nextV) { fire('v'); nextV += 333; }
        break;

      case 'af':
        // Atria: chaotic ~350ms ±40%; ventricles: irregular 400–900ms
        if (now >= nextA) { fire('a'); nextA += rand(210, 490); }
        if (now >= nextV) { fire('v'); nextV += rand(400, 900); }
        break;

      case 'pvc':
        tickPvc(now);
        break;
    }
  }

  function tickPvc(now) {
    // Keep at least 2 cycles of events queued ahead
    while (pvcNextCycle < now + PVC_CYCLE * 2) {
      var cs = pvcNextCycle;
      PVC_TPL.forEach(function (ev) {
        pvcQueue.push({ fireMs: cs + ev.dt, tp: ev.tp });
      });
      pvcNextCycle += PVC_CYCLE;
    }
    // Fire any events whose time has arrived
    var rem = [];
    pvcQueue.forEach(function (ev) {
      if (now >= ev.fireMs) fire(ev.tp);
      else rem.push(ev);
    });
    pvcQueue = rem;
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

    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
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

    // Lighting: strong ambient + key/fill/rim directional lights
    scene.add(new THREE.AmbientLight(0xffffff, 1.8));

    var key = new THREE.DirectionalLight(0xfff8f0, 1.0);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    scene.add(key);

    var fill = new THREE.DirectionalLight(0xffe0d8, 0.60);
    fill.position.set(-4, 1, 2);
    scene.add(fill);

    var rim = new THREE.DirectionalLight(0xd0e4ff, 0.35);
    rim.position.set(0, -3, -4);
    scene.add(rim);

    // ── Load GLB ────────────────────────────────────────────────────────────
    var loader = new THREE.GLTFLoader();
    loader.load(
      'heart.glb',
      function (gltf) {
        modelGroup = new THREE.Group();
        var model  = gltf.scene;

        // Centre and scale to fit a ~3-unit sphere
        var box    = new THREE.Box3().setFromObject(model);
        var centre = new THREE.Vector3();
        box.getCenter(centre);
        model.position.sub(centre);
        var sz = new THREE.Vector3();
        box.getSize(sz);
        model.scale.setScalar(3.0 / Math.max(sz.x, sz.y, sz.z));

        model.traverse(function (node) {
          if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }

          // Collect bones from SkinnedMesh skeletons
          if (node.isSkinnedMesh && node.skeleton) {
            node.skeleton.bones.forEach(function (b) {
              if (ATRIA_NAMES.indexOf(b.name) !== -1) bonesAtria.push(b);
              if (VENTS_NAMES.indexOf(b.name) !== -1) bonesVents.push(b);
            });
          }
          // Also pick up standalone bone nodes
          if ((node.isBone || node.type === 'Bone') && node.name) {
            if (ATRIA_NAMES.indexOf(node.name) !== -1) bonesAtria.push(node);
            if (VENTS_NAMES.indexOf(node.name) !== -1) bonesVents.push(node);
          }
        });

        // Deduplicate (skeleton iteration can yield the same bone twice)
        function dedupe(arr) {
          return arr.filter(function (b, i) { return arr.indexOf(b) === i; });
        }
        bonesAtria = dedupe(bonesAtria);
        bonesVents = dedupe(bonesVents);
        useBones   = (bonesAtria.length + bonesVents.length) > 0;

        if (useBones) {
          console.log('heart3d: bones — atria:', bonesAtria.map(function (b) { return b.name; }),
                      'vents:', bonesVents.map(function (b) { return b.name; }));
        } else {
          console.warn('heart3d: target bones not found; using model-scale fallback');
        }

        // AnimationMixer: play 'test' animation (or first available) at very low
        // timeScale for ambient motion; our timing engine overrides the beat.
        if (gltf.animations && gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model);
          var clip   = THREE.AnimationClip.findByName(gltf.animations, 'test')
                       || gltf.animations[0];
          var action = mixer.clipAction(clip);
          action.timeScale = 0.06;
          action.play();
        }

        modelGroup.add(model);
        modelGroup.rotation.x = rotX;
        modelGroup.rotation.y = rotY;
        scene.add(modelGroup);

        // Start rhythm for whatever condition is currently active
        startRhythm(cond);
      },
      undefined,
      function (err) { console.error('heart.glb load error:', err); }
    );

    // ── Drag rotation ────────────────────────────────────────────────────────
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

    // ── Resize ────────────────────────────────────────────────────────────────
    window.addEventListener('resize', function () {
      var el = document.getElementById('heart3d-canvas-wrap');
      if (!el || !renderer) return;
      var nw = el.clientWidth;
      if (nw > 0) renderer.setSize(nw, nw, false);
    });

    // ── Render loop ───────────────────────────────────────────────────────────
    (function loop() {
      requestAnimationFrame(loop);
      var dt = clock.getDelta();

      if (!drag && modelGroup) rotY += dt * 0.15;

      if (modelGroup) {
        modelGroup.rotation.x = rotX;
        modelGroup.rotation.y = rotY;
        if (mixer) mixer.update(dt);  // advance ambient base animation
        tickRhythm();                  // fire contractions at precise ms
        applyContractions();           // apply bone / model-scale transforms
      }

      renderer.render(scene, camera);
    }());
  }

  // ── Patch aeSwitch ───────────────────────────────────────────────────────────
  // scripts.js defines aeSwitch synchronously; patch it before its rAF fires.
  var origSwitch = window.aeSwitch;
  if (origSwitch) {
    window.aeSwitch = function (c) {
      origSwitch(c);
      startRhythm(c); // reset timing engine immediately; safe before model loads
    };
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    requestAnimationFrame(init);
  });

}());
