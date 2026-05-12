/* af-ablation.js — AF ablation split-screen animation */
(function () {
  'use strict';

  var THREE = window.THREE;

  var scene, camera, renderer, clock;
  var modelGroup = null;
  var cathMesh   = null;
  var cathGeom   = null;
  var ringMeshes = [];

  var ablStep   = 1;
  var isPlaying = true;
  var stepMs    = 0;

  var STEP_DUR    = [4500, 3500, 3500, 6000]; // ms per step
  var REVEAL_FROM = [0.00, 0.48, 0.72, 0.92];
  var REVEAL_TO   = [0.48, 0.72, 0.92, 0.92];
  var cathReveal  = 0;

  // Fixed camera angle — matches heart3d.js starting view, no auto-rotation
  var FIXED_ROT_X = 0.12;
  var FIXED_ROT_Y = 0.5;

  // Heartbeat (50 bpm simple scale)
  var beatT       = 0;
  var BEAT_PERIOD = 1200; // ms

  // ── Catheter waypoints — model-local space ────────────────────────────────────
  // Heart is scaled to 3 units and centred at origin inside modelGroup.
  // All waypoints stay well within ±0.9 units of centre — inside the heart walls.
  // Path: IVC/RA junction → RA → interatrial septum → LA.
  var CATH_WPS = [
    new THREE.Vector3( 0.16, -0.82,  0.05),   // IVC/RA inlet — bottom of RA
    new THREE.Vector3( 0.13, -0.52,  0.04),   // ascending IVC
    new THREE.Vector3( 0.10, -0.20,  0.02),   // entering RA
    new THREE.Vector3( 0.06,  0.10,  0.00),   // mid RA                ← step 1 end
    new THREE.Vector3( 0.02,  0.24, -0.05),   // upper RA, pre-septal
    new THREE.Vector3(-0.01,  0.30, -0.11),   // at interatrial septum ← step 2 end
    new THREE.Vector3(-0.10,  0.26, -0.21),   // crossing into LA
    new THREE.Vector3(-0.20,  0.18, -0.30),   // LA body               ← step 3 / 4
  ];

  // Ablation ring positions — model-local, on the posterior-left LA wall
  // near the four pulmonary vein ostia
  var PV_POS = [
    new THREE.Vector3(-0.25,  0.30, -0.40),   // LSPV upper-left
    new THREE.Vector3( 0.04,  0.32, -0.36),   // RSPV upper-right
    new THREE.Vector3(-0.27, -0.00, -0.38),   // LIPV lower-left
    new THREE.Vector3( 0.03,  0.00, -0.33),   // RIPV lower-right
  ];
  var PV_PHASES = [0, 0.5, 0.25, 0.75];

  // ── Valve bone names (same as heart3d.js) ─────────────────────────────────────
  var PALE_BONE_NAMES = [
    'left_mitral_valve_jnt15_15',       'right_mitral_valve_jnt16_16',
    'aortic_valve_01_jnt21_21',         'aortic_valve_02_jnt17_17',
    'aortic_valve_03_jnt19_19',         'left_tricuspid_valve_jnt23_23',
    'right_tricuspid_valve_jnt24_24',
    'right_pulmonary_valve_jnt9_9',     'right_pulmonary_valve_endjnt10_10',
    'left_pulmonary_valve_jnt11_11',    'left_pulmonary_valve_endjnt12_12',
    'cardiac_muscle_endjnt8_8',
    'aortic_valve_02_endjnt18_18',      'aortic_valve_03_endjnt20_20',
    'aortic_valve_01_endjnt22_22'
  ];

  // ── UI refs ───────────────────────────────────────────────────────────────────
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
    ringMeshes.forEach(function (r) { r.visible = (ablStep === 4); });
    applyUI();
  }

  function applyUI() {
    if (ui.counter)   ui.counter.textContent  = 'Step ' + ablStep + ' of 4';
    if (ui.stepLabel) ui.stepLabel.textContent = STEP_LABELS[ablStep - 1];
    ui.descs && ui.descs.forEach(function (el) {
      el.style.display = (parseInt(el.dataset.step, 10) === ablStep) ? 'block' : 'none';
    });
    ui.overlays && ui.overlays.forEach(function (el, i) {
      if (el) el.style.opacity = (i + 1 === ablStep) ? '1' : '0';
    });
  }

  // ── Full material setup (exact copy from heart3d.js) ─────────────────────────
  function applyHeartMaterial(model) {
    model.traverse(function (node) {
      if (!node.isSkinnedMesh || !node.skeleton) return;

      // Blue pixel fix on texture
      var orig   = node.material;
      var texMap = (orig && orig.map) || null;
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
            px[i]     = Math.max(r, 160);
            px[i + 1] = Math.round(g * 0.3);
            px[i + 2] = 0;
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

      // Resolve valve bone indices by name
      var paleIdxs = [];
      node.skeleton.bones.forEach(function (bone, idx) {
        if (PALE_BONE_NAMES.indexOf(bone.name) !== -1) paleIdxs.push(idx);
      });

      var gl2 = paleIdxs.length
        ? paleIdxs.map(function (i) {
            return '_si.x==' + i + '||_si.y==' + i + '||_si.z==' + i + '||_si.w==' + i;
          }).join('||')
        : 'false';
      var gl1 = paleIdxs.length
        ? paleIdxs.map(function (i) {
            var f = i + '.0';
            return 'abs(skinIndex.x-' + f + ')<0.5||abs(skinIndex.y-' + f + ')<0.5||abs(skinIndex.z-' + f + ')<0.5||abs(skinIndex.w-' + f + ')<0.5';
          }).join('||')
        : 'false';

      var mat = new THREE.MeshStandardMaterial({
        map:       texMap,
        color:     new THREE.Color(0.85, 0.15, 0.10),
        roughness: 0.9,
        metalness: 0.0
      });

      mat.onBeforeCompile = function (shader) {
        shader.vertexShader   = 'varying float vIsValve;\n' + shader.vertexShader;
        shader.fragmentShader = 'varying float vIsValve;\n' + shader.fragmentShader;

        shader.vertexShader = shader.vertexShader.replace(
          '#include <skinning_vertex>',
          [
            '#include <skinning_vertex>',
            '{',
            '  vec4 _sw = skinWeight;',
            '  float _mw = _sw.x;',
            '#ifdef WEBGL2',
            '  ivec4 _si = skinIndex;',
            '  int _dom = _si.x;',
            '  if(_sw.y>_mw){_mw=_sw.y;_dom=_si.y;}',
            '  if(_sw.z>_mw){_mw=_sw.z;_dom=_si.z;}',
            '  if(_sw.w>_mw){_mw=_sw.w;_dom=_si.w;}',
            '  vIsValve = (' + gl2 + ') ? 1.0 : 0.0;',
            '#else',
            '  float _domF = skinIndex.x;',
            '  if(_sw.y>_mw){_mw=_sw.y;_domF=skinIndex.y;}',
            '  if(_sw.z>_mw){_mw=_sw.z;_domF=skinIndex.z;}',
            '  if(_sw.w>_mw){_mw=_sw.w;_domF=skinIndex.w;}',
            '  vIsValve = (' + gl1 + ') ? 1.0 : 0.0;',
            '#endif',
            '}'
          ].join('\n')
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <map_fragment>',
          [
            '#include <map_fragment>',
            'if (vIsValve > 0.5) {',
            '  diffuseColor.rgb = vec3(0.92, 0.82, 0.45);',
            '}'
          ].join('\n')
        );
      };

      node.material = mat;
    });

    // Shadows on all meshes
    model.traverse(function (node) {
      if (node.isMesh) {
        node.castShadow    = true;
        node.receiveShadow = true;
      }
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
    scene.background = new THREE.Color(0xF9F9F9);

    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 200);

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, w, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

    clock = new THREE.Clock();

    // Identical lighting to heart3d.js
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    var key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-4, 1, 2);
    scene.add(fill);
    var rim = new THREE.DirectionalLight(0xffffff, 0.2);
    rim.position.set(0, -3, -4);
    scene.add(rim);

    var loader = new THREE.GLTFLoader();
    loader.load('heart.glb', onLoaded, undefined, function (e) {
      console.error('af-ablation heart.glb error:', e);
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

    // Centre + scale (same as heart3d.js)
    var box = new THREE.Box3().setFromObject(model);
    var ctr = new THREE.Vector3();
    box.getCenter(ctr);
    var sz = new THREE.Vector3();
    box.getSize(sz);
    var s = 3.0 / Math.max(sz.x, sz.y, sz.z);
    model.scale.setScalar(s);
    model.position.copy(ctr).multiplyScalar(-s);

    var halfDiag = 0.5 * Math.sqrt(sz.x*sz.x + sz.y*sz.y + sz.z*sz.z) * s;
    var fovHalf  = camera.fov * (Math.PI / 180) / 2;
    var dist     = Math.max(3.8, halfDiag / Math.tan(fovHalf) * 1.00);
    camera.position.set(0, halfDiag * 0.08, dist);

    // Full material with canvas pixel-fix + valve shader
    applyHeartMaterial(model);

    // Fixed rotation — no auto-rotate
    modelGroup.rotation.x = FIXED_ROT_X;
    modelGroup.rotation.y = FIXED_ROT_Y;
    modelGroup.add(model);
    scene.add(modelGroup);

    // Catheter and rings live inside modelGroup → always move with the heart
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
    modelGroup.add(cathMesh); // inside modelGroup — stays inside the heart
  }

  function buildRings() {
    PV_POS.forEach(function (pos) {
      var geom = new THREE.TorusGeometry(0.10, 0.016, 8, 32);
      var mat  = new THREE.MeshStandardMaterial({
        color:       0xFF5500,
        emissive:    new THREE.Color(0.75, 0.18, 0.0),
        transparent: true,
        opacity:     0.0,
      });
      var mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(pos);
      mesh.rotation.x = Math.PI / 2;
      mesh.visible    = false;
      modelGroup.add(mesh); // inside modelGroup → attached to heart
      ringMeshes.push(mesh);
    });
  }

  function tick(dt) {
    if (!modelGroup) return;

    // Scale heartbeat (50 bpm)
    beatT += dt * 1000;
    if (beatT >= BEAT_PERIOD) beatT -= BEAT_PERIOD;
    var bp  = beatT / BEAT_PERIOD;
    var bsq = bp < 0.08 ? (1.0 - 0.07 * (bp / 0.08))
            : bp < 0.38 ? (1.0 - 0.07 * (1.0 - (bp - 0.08) / 0.30))
            : 1.0;
    modelGroup.scale.setScalar(bsq);

    // No auto-rotation — heart stays at FIXED_ROT_X / FIXED_ROT_Y

    if (!isPlaying) return;

    stepMs += dt * 1000;
    var dur = STEP_DUR[ablStep - 1];

    // Advance catheter reveal
    var t = Math.min(1.0, stepMs / (dur * 0.80));
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
