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

  // ── Contraction amplitudes ───────────────────────────────────────────────────
  // Atria use rotation (visible regardless of skin weights) + scale compression
  var ATRIA_ROT   = 0.30; // radians applied at peak — on both X and Z axes
  var ATRIA_SCALE = 0.30; // fractional scale-down at peak
  var ATRIA_DUR   = 140;  // ms
  var ATRIA_AF    = 0.45; // AF quiver uses this fraction of full amplitude

  var VENTS_ROT   = 0.20;
  var VENTS_SCALE = 0.22;
  var VENTS_DUR   = 290;

  // ── Contraction envelope: fast attack (20%), smooth decay (80%) ──────────────
  function contEnv(elMs, durMs) {
    var t = elMs / durMs;
    if (t <= 0 || t >= 1) return 0;
    return t < 0.20 ? t / 0.20 : 1.0 - (t - 0.20) / 0.80;
  }

  // ── Active contractions pool ─────────────────────────────────────────────────
  var contractions = [];

  function fire(tp, frac) {
    var f = (frac !== undefined) ? frac : 1;
    if (tp === 'a') {
      // Log every atrial contraction so it can be confirmed in the console
      console.log('[heart3d] ATRIAL contraction — cond:', cond, '| frac:', f.toFixed(2),
                  '| bonesAtria found:', bonesAtria.length);
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
      var sc  = 1.0 - ATRIA_SCALE * aEnv;
      d.bone.rotation.x = d.restRot.x + rot;
      d.bone.rotation.z = d.restRot.z + rot;
      d.bone.scale.set(d.restScale.x * sc, d.restScale.y * sc, d.restScale.z * sc);
    });

    // Ventricles + valves: rotation on X axis + scale compression
    bonesVents.forEach(function (d) {
      var rot = VENTS_ROT * vEnv;
      var sc  = 1.0 - VENTS_SCALE * vEnv;
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

  // ── Start / switch rhythm ─────────────────────────────────────────────────────
  function startRhythm(c) {
    cond = c;
    contractions = [];
    var now = performance.now();

    switch (c) {
      case 'normal': case 'csp': case 'crt':
        nextA = now; nextV = now + 120;
        document.dispatchEvent(new CustomEvent('heart3d:rhythmStart', { detail: { cond: c, t0: now } }));
        break;

      case 'flutter':
        // Atria 300bpm (200ms); ventricles 150bpm (400ms), 2:1 block
        nextA = now; nextV = now; break;

      case 'at':
        // Atrial tachycardia: atria 180bpm (333ms); ventricles 150bpm (400ms)
        nextA = now; nextV = now; break;

      case 'svt':
        // 200bpm (300ms): all chambers simultaneously
        nextA = now; nextV = now; break;

      case 'vt':
        // Ventricles 180bpm (333ms); atria 70bpm (857ms), dissociated
        nextV = now; nextA = now + rand(0, 800); break;

      case 'af':
        // Atria quiver ~350ms ±40%; ventricles irregular 400–900ms
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
        if (now >= nextA) { fire('a'); nextA += 857; }
        if (now >= nextV) { fire('v'); nextV += 857; }
        break;

      case 'flutter':
        // Atria: 200ms (300bpm). Ventricles: 400ms (150bpm).
        if (now >= nextA) { fire('a'); nextA += 200; }
        if (now >= nextV) { fire('v'); nextV += 400; }
        break;

      case 'at':
        // Atria: 333ms (180bpm). Ventricles: 400ms (150bpm).
        if (now >= nextA) { fire('a'); nextA += 333; }
        if (now >= nextV) { fire('v'); nextV += 400; }
        break;

      case 'svt':
        if (now >= nextA) { fire('a'); fire('v'); nextA += 300; nextV = nextA; }
        break;

      case 'vt':
        if (now >= nextA) { fire('a'); nextA += 857; }
        if (now >= nextV) { fire('v'); nextV += 333; }
        break;

      case 'af':
        if (now >= nextA) { fire('a', ATRIA_AF); nextA += rand(210, 490); }
        if (now >= nextV) { fire('v');            nextV += rand(400, 900); }
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

  // ── Panel-expand helpers ──────────────────────────────────────────────────────
  function getDualView() {
    var wrap = document.getElementById('heart3d-canvas-wrap');
    // wrap → .ae-3d-panel → .ae-dual-view
    return wrap && wrap.parentElement && wrap.parentElement.parentElement;
  }

  function isExpanded() {
    var dv = getDualView();
    return !!(dv && dv.classList.contains('ae-3d-expanded'));
  }

  function resizeRenderer() {
    if (!renderer || !camera) return;
    var wrap = document.getElementById('heart3d-canvas-wrap');
    if (!wrap || !wrap.clientWidth) return;
    var w = wrap.clientWidth;
    // canvas-wrap always keeps aspect-ratio:1 (via CSS) so height = width
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    renderer.setSize(w, w, false);
  }

  function enterExpanded() {
    var dv = getDualView();
    if (dv) dv.classList.add('ae-3d-expanded');
    // Double-rAF: wait for two frames so CSS reflow completes before we read clientWidth
    requestAnimationFrame(function () { requestAnimationFrame(resizeRenderer); });
  }

  function exitExpanded() {
    var dv = getDualView();
    if (dv) dv.classList.remove('ae-3d-expanded');
    requestAnimationFrame(function () { requestAnimationFrame(resizeRenderer); });
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

    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    var key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(3, 5, 4); key.castShadow = true; key.shadow.mapSize.set(512, 512);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-4, 1, 2); scene.add(fill);
    var rim = new THREE.DirectionalLight(0xffffff, 0.2);
    rim.position.set(0, -3, -4); scene.add(rim);

    // ── Load GLB ─────────────────────────────────────────────────────────────
    var loader = new THREE.GLTFLoader();
    loader.load(
      'heart.glb',
      function (gltf) {
        // IMPORTANT: AnimationMixer is deliberately NOT created.
        // The timing engine below drives all bone motion directly.
        if (gltf.animations && gltf.animations.length > 0) {
          console.log('[heart3d] GLB has', gltf.animations.length,
            'clip(s) — AnimationMixer NOT created; manual bone animation only');
        }

        modelGroup = new THREE.Group();
        var model  = gltf.scene;

        // ── Centre + scale ───────────────────────────────────────────────────
        var box    = new THREE.Box3().setFromObject(model);
        var centre = new THREE.Vector3();
        box.getCenter(centre);
        var sz = new THREE.Vector3();
        box.getSize(sz);
        var s = 3.0 / Math.max(sz.x, sz.y, sz.z);
        model.scale.setScalar(s);
        model.position.copy(centre).multiplyScalar(-s);

        var halfDiag = 0.5 * Math.sqrt(sz.x*sz.x + sz.y*sz.y + sz.z*sz.z) * s;
        var fovHalf  = camera.fov * (Math.PI / 180) / 2;
        var dist     = Math.max(4.5, halfDiag / Math.tan(fovHalf) * 1.20);
        camera.position.set(0, halfDiag * 0.08, dist);

        // ── Tint entire model red via material colour × texture ─────────────
        model.traverse(function (node) {
          if (node.isMesh) {
            var orig = node.material;
            var texMap = orig.map || null;

            // Fix blue pixels baked into the texture before applying the tint
            if (texMap && texMap.image) {
              var img = texMap.image;
              var cv  = document.createElement('canvas');
              cv.width  = img.width  || img.naturalWidth  || 1024;
              cv.height = img.height || img.naturalHeight || 1024;
              var ctx = cv.getContext('2d');
              ctx.drawImage(img, 0, 0, cv.width, cv.height);
              var id = ctx.getImageData(0, 0, cv.width, cv.height);
              var px = id.data;
              for (var i = 0; i < px.length; i += 4) {
                var r = px[i], g = px[i + 1], b = px[i + 2];
                if (b > r + 40 && b > g + 20) {
                  // Blue → red
                  px[i]     = Math.max(r, 160);
                  px[i + 1] = Math.round(g * 0.3);
                  px[i + 2] = 0;
                } else if (g > 30 && b > 25) {
                  // Pale pink/beige valve and chordae → pale white
                  px[i]     = 240;
                  px[i + 1] = 235;
                  px[i + 2] = 225;
                }
              }
              ctx.putImageData(id, 0, 0);
              var newTex      = new THREE.CanvasTexture(cv);
              newTex.encoding = texMap.encoding;
              newTex.wrapS    = texMap.wrapS;
              newTex.wrapT    = texMap.wrapT;
              newTex.flipY    = texMap.flipY;
              texMap          = newTex;
            }

            node.material = new THREE.MeshStandardMaterial({
              map:       texMap,
              normalMap: orig.normalMap || null,
              aoMap:     orig.aoMap     || null,
              color:     new THREE.Color(0xaa0000),
              roughness: 0.9,
              metalness: 0.0
            });
          }
        });

        // ── Collect bones + set shadows ──────────────────────────────────────
        model.traverse(function (node) {
          if (node.isMesh) {
            node.castShadow    = true;
            node.receiveShadow = true;
          }

          function tryAdd(b) {
            var d = {
              bone:      b,
              restScale: b.scale.clone(),
              restRot:   { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z }
            };
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

        console.log('[heart3d] atria bones:', bonesAtria.map(function (d) { return d.bone.name; }));
        console.log('[heart3d] vent/valve bones:', bonesVents.map(function (d) { return d.bone.name; }));

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

    // ── Expand / collapse button wiring ───────────────────────────────────────
    var btnExpand   = document.getElementById('heart3d-expand');
    var btnCollapse = document.getElementById('heart3d-collapse');
    if (btnExpand)   btnExpand.addEventListener('click',   enterExpanded);
    if (btnCollapse) btnCollapse.addEventListener('click',  exitExpanded);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isExpanded()) exitExpanded();
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
