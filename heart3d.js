/* heart3d.js — Three.js GLB heart viewer, physiologically-accurate arrhythmia timing */
(function () {
  'use strict';

  var THREE = window.THREE;

  var scene, camera, renderer, clock;
  var modelGroup = null;
  var drag = false, pm = { x: 0, y: 0 };
  var rotX = 0.12, rotY = 0.5;

  // ── Bone groups (exact names from the GLB skeleton) ──────────────────────────
  var ATRIA_NAMES = [
    'right_atrium_jnt.6_6',
    'left_atrium_jnt.13_13'
  ];
  var VENTS_NAMES = [
    'cardiac_muscle_jnt.7_7',
    'left_mitral_valve_jnt.15_15',
    'right_mitral_valve_jnt.16_16',
    'aortic_valve_01_jnt.21_21',
    'left_tricuspid_valve_jnt.23_23',
    'right_tricuspid_valve_jnt.24_24'
  ];

  // Bone data: { bone, restScale }  — restScale captured at load time
  var bonesAtria = [];
  var bonesVents = [];
  var useBones   = false;

  // Contraction parameters: default amplitude and duration in ms
  var ATRIA_AMT     = 0.07;  // normal atrial contraction
  var ATRIA_DUR     = 130;
  var ATRIA_AF_AMT  = 0.025; // smaller quiver for AF
  var VENTS_AMT     = 0.10;
  var VENTS_DUR     = 290;

  // ── Contraction envelope: fast attack (20%), smooth decay (80%) ──────────────
  function contEnv(elMs, durMs) {
    var t = elMs / durMs;
    if (t <= 0 || t >= 1) return 0;
    return t < 0.20 ? t / 0.20 : 1.0 - (t - 0.20) / 0.80;
  }

  // ── Active contractions pool ─────────────────────────────────────────────────
  // tp: 'a' | 'v',  amt: override amplitude (optional)
  var contractions = [];

  function fire(tp, amt) {
    contractions.push({
      tp:  tp,
      t0:  performance.now(),
      amt: amt !== undefined ? amt : (tp === 'a' ? ATRIA_AMT : VENTS_AMT)
    });
  }

  function applyContractions() {
    var now  = performance.now();
    var aEnv = 0, vEnv = 0;
    var alive = [];

    contractions.forEach(function (c) {
      var dur = c.tp === 'a' ? ATRIA_DUR : VENTS_DUR;
      var el  = now - c.t0;
      var e   = contEnv(el, dur);
      if (el < dur) alive.push(c);
      if (c.tp === 'a') aEnv = Math.max(aEnv, c.amt * e);
      else              vEnv = Math.max(vEnv, c.amt * e);
    });
    contractions = alive;

    if (useBones) {
      bonesAtria.forEach(function (d) {
        var s = 1 - aEnv;
        d.bone.scale.set(d.restScale.x * s, d.restScale.y * s, d.restScale.z * s);
      });
      bonesVents.forEach(function (d) {
        var s = 1 - vEnv;
        d.bone.scale.set(d.restScale.x * s, d.restScale.y * s, d.restScale.z * s);
      });
    } else if (modelGroup) {
      modelGroup.scale.setScalar(Math.min(1 - aEnv, 1 - vEnv));
    }
  }

  // ── Rhythm state ─────────────────────────────────────────────────────────────
  var cond  = 'normal';
  var nextA = 0;
  var nextV = 0;

  // PVC template: 4 normal beats + early ventricular + compensatory pause
  // Beat 5 normal vents = 4×857+120 = 3548ms; PVC fires 300ms early → 3248ms.
  // Compensatory pause end: 3248+1200 = 4448ms.
  var PVC_CYCLE = 4448;
  var PVC_TPL   = [
    { dt: 0,    tp: 'a' }, { dt: 120,  tp: 'v' },
    { dt: 857,  tp: 'a' }, { dt: 977,  tp: 'v' },
    { dt: 1714, tp: 'a' }, { dt: 1834, tp: 'v' },
    { dt: 2571, tp: 'a' }, { dt: 2691, tp: 'v' },
    { dt: 3248, tp: 'v' }  // PVC — vents only, no preceding atrial beat
  ];
  var pvcQueue     = [];
  var pvcNextCycle = 0;

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
        // 70 bpm (857ms): atria first, ventricles 120ms later
        nextA = now;
        nextV = now + 120;
        break;

      case 'flutter':
        // Atria 300 bpm (200ms); ventricles 150 bpm (400ms), 2:1 block
        nextA = now;
        nextV = now;
        break;

      case 'svt':
        // 200 bpm (300ms): all chambers simultaneous, no AV delay
        nextA = now;
        nextV = now;
        break;

      case 'vt':
        // Ventricles 180 bpm (333ms); atria 70 bpm (857ms), fully dissociated
        nextV = now;
        nextA = now + rand(0, 800);
        break;

      case 'af':
        // Atria quiver at ~350ms ±40%; ventricles irregular 400–900ms
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
        if (now >= nextA) { fire('a');             nextA += 857; }
        if (now >= nextV) { fire('v');             nextV += 857; }
        break;

      case 'flutter':
        if (now >= nextA) { fire('a');             nextA += 200; }
        if (now >= nextV) { fire('v');             nextV += 400; }
        break;

      case 'svt':
        if (now >= nextA) {
          fire('a'); fire('v');
          nextA += 300;
          nextV = nextA;
        }
        break;

      case 'vt':
        if (now >= nextA) { fire('a');             nextA += 857; }
        if (now >= nextV) { fire('v');             nextV += 333; }
        break;

      case 'af':
        // Atria: small-amplitude quiver
        if (now >= nextA) { fire('a', ATRIA_AF_AMT); nextA += rand(210, 490); }
        // Ventricles: irregular 100–160 bpm range
        if (now >= nextV) { fire('v');               nextV += rand(400, 900); }
        break;

      case 'pvc':
        tickPvc(now);
        break;
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
    camera.position.set(0, 0.1, 5.0); // updated after model loads

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, w, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

    clock = new THREE.Clock();

    // Lighting
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

    // ── Load GLB ─────────────────────────────────────────────────────────────
    var loader = new THREE.GLTFLoader();
    loader.load(
      'heart.glb',
      function (gltf) {
        modelGroup = new THREE.Group();
        var model  = gltf.scene;

        // ── Centering and scaling ─────────────────────────────────────────────
        // Box3 is computed before our transforms so it is in the model's own
        // coordinate system (world = model space when model has no parent yet).
        var box    = new THREE.Box3().setFromObject(model);
        var centre = new THREE.Vector3();
        box.getCenter(centre);
        var sz = new THREE.Vector3();
        box.getSize(sz);

        var s = 3.0 / Math.max(sz.x, sz.y, sz.z);

        // Apply scale first so the centring offset accounts for it.
        // After scale s, the bounding-box centre in parent space = s * centre.
        // Setting position = −s * centre puts it exactly at origin.
        model.scale.setScalar(s);
        model.position.copy(centre).multiplyScalar(-s);

        // ── Camera distance: fit model bounding sphere with 20% margin ────────
        var halfDiag = 0.5 * Math.sqrt(sz.x * sz.x + sz.y * sz.y + sz.z * sz.z) * s;
        var fovHalf  = camera.fov * (Math.PI / 180) / 2;
        var dist     = Math.max(4.5, halfDiag / Math.tan(fovHalf) * 1.20);
        camera.position.set(0, halfDiag * 0.08, dist);

        // ── DEBUG: log every node and every skeleton bone ────────────────────
        console.group('heart3d DEBUG — full scene hierarchy');
        model.traverse(function (node) {
          console.log(
            'node | type:', node.type,
            '| name:', JSON.stringify(node.name),
            '| isBone:', !!node.isBone,
            '| isSkinnedMesh:', !!node.isSkinnedMesh
          );
          if (node.isSkinnedMesh && node.skeleton) {
            console.group('  skeleton bones for SkinnedMesh "' + node.name + '"');
            node.skeleton.bones.forEach(function (b, i) {
              console.log('  [' + i + '] ' + JSON.stringify(b.name));
            });
            console.groupEnd();
          }
        });
        console.groupEnd();

        // ── Mesh and bone collection ─────────────────────────────────────────
        model.traverse(function (node) {
          if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }

          // Collect bones from SkinnedMesh skeletons (most reliable path)
          if (node.isSkinnedMesh && node.skeleton) {
            node.skeleton.bones.forEach(function (b) {
              if (ATRIA_NAMES.indexOf(b.name) !== -1) {
                bonesAtria.push({ bone: b, restScale: b.scale.clone() });
              }
              if (VENTS_NAMES.indexOf(b.name) !== -1) {
                bonesVents.push({ bone: b, restScale: b.scale.clone() });
              }
            });
          }
          // Also catch standalone bone nodes
          if ((node.isBone || node.type === 'Bone') && node.name) {
            if (ATRIA_NAMES.indexOf(node.name) !== -1) {
              bonesAtria.push({ bone: node, restScale: node.scale.clone() });
            }
            if (VENTS_NAMES.indexOf(node.name) !== -1) {
              bonesVents.push({ bone: node, restScale: node.scale.clone() });
            }
          }
        });

        // Deduplicate
        function dedupe(arr) {
          return arr.filter(function (d, i) {
            return arr.findIndex(function (x) { return x.bone === d.bone; }) === i;
          });
        }
        bonesAtria = dedupe(bonesAtria);
        bonesVents = dedupe(bonesVents);
        useBones   = (bonesAtria.length + bonesVents.length) > 0;

        if (useBones) {
          console.log('heart3d: matched atria:', bonesAtria.map(function (d) { return d.bone.name; }));
          console.log('heart3d: matched vents:', bonesVents.map(function (d) { return d.bone.name; }));
        } else {
          console.warn('heart3d: no target bones matched — running model-scale fallback');
        }

        // No AnimationMixer — all motion driven by our timing engine below.

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
        tickRhythm();        // schedule contractions at precise ms
        applyContractions(); // apply bone / model-scale transforms
      }

      renderer.render(scene, camera);
    }());
  }

  // ── Patch aeSwitch ────────────────────────────────────────────────────────────
  var origSwitch = window.aeSwitch;
  if (origSwitch) {
    window.aeSwitch = function (c) {
      origSwitch(c);
      startRhythm(c);
    };
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    requestAnimationFrame(init);
  });

}());
