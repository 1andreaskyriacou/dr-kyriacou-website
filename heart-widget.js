/* heart-widget.js — compact fixed 3D heart + ECG widget, 70 bpm sinus only */
(function () {
  'use strict';

  var THREE = window.THREE;

  var W = 120, H_3D = 88, H_ECG = 32;

  // Animation state
  var scene, camera, renderer, clock;
  var modelGroup = null;
  var rotY = 0.5;
  var bonesAtria = [], bonesVents = [];
  var contractions = [];
  var nextA = 0, nextV = 0;
  var beatEpoch = performance.now();

  var ATRIA_ROT = 0.52, ATRIA_SCALE = 0.38, ATRIA_DUR = 160;
  var VENTS_ROT = 0.20, VENTS_SCALE = 0.22, VENTS_DUR = 290;
  var BEAT_MS   = 857; // 70 bpm

  var ATRIA_NAMES = [
    'right_atrium_jnt6_6', 'left_atrium_jnt13_13', 'left_atrium_storage_jnt14_14'
  ];
  var VENTS_NAMES = [
    'cardiac_muscle_jnt7_7',         'cardiac_muscle_endjnt8_8',
    'right_pulmonary_valve_jnt9_9',  'left_pulmonary_valve_jnt11_11',
    'left_mitral_valve_jnt15_15',    'right_mitral_valve_jnt16_16',
    'aortic_valve_02_jnt17_17',      'aortic_valve_03_jnt19_19',
    'aortic_valve_01_jnt21_21',      'left_tricuspid_valve_jnt23_23',
    'right_tricuspid_valve_jnt24_24'
  ];
  var PALE_BONE_NAMES = [
    'left_mitral_valve_jnt15_15',    'right_mitral_valve_jnt16_16',
    'aortic_valve_01_jnt21_21',      'aortic_valve_02_jnt17_17',
    'aortic_valve_03_jnt19_19',      'left_tricuspid_valve_jnt23_23',
    'right_tricuspid_valve_jnt24_24',
    'right_pulmonary_valve_jnt9_9',  'right_pulmonary_valve_endjnt10_10',
    'left_pulmonary_valve_jnt11_11', 'left_pulmonary_valve_endjnt12_12',
    'cardiac_muscle_endjnt8_8',
    'aortic_valve_02_endjnt18_18',   'aortic_valve_03_endjnt20_20',
    'aortic_valve_01_endjnt22_22'
  ];

  function contEnv(elMs, durMs, ar) {
    var t = elMs / durMs; ar = ar || 0.20;
    if (t <= 0 || t >= 1) return 0;
    return t < ar ? t / ar : 1.0 - (t - ar) / (1.0 - ar);
  }

  function fire(tp) { contractions.push({ tp: tp, t0: performance.now() }); }

  function applyContractions() {
    var now = performance.now(), aEnv = 0, vEnv = 0, alive = [];
    contractions.forEach(function (c) {
      var dur = c.tp === 'a' ? ATRIA_DUR : VENTS_DUR;
      var el  = now - c.t0;
      var e   = c.tp === 'a' ? contEnv(el, dur, 0.10) : contEnv(el, dur);
      if (el < dur) alive.push(c);
      if (c.tp === 'a') aEnv = Math.max(aEnv, e);
      else              vEnv = Math.max(vEnv, e);
    });
    contractions = alive;
    bonesAtria.forEach(function (d) {
      var rot = ATRIA_ROT * aEnv, sc = 1.0 - ATRIA_SCALE * aEnv;
      d.bone.rotation.x = d.restRot.x + rot;
      d.bone.rotation.z = d.restRot.z + rot;
      d.bone.scale.set(d.restScale.x * sc, d.restScale.y * sc, d.restScale.z * sc);
    });
    bonesVents.forEach(function (d) {
      var rot = VENTS_ROT * vEnv, sc = 1.0 - VENTS_SCALE * vEnv;
      d.bone.rotation.x = d.restRot.x + rot;
      d.bone.scale.set(d.restScale.x * sc, d.restScale.y * sc, d.restScale.z * sc);
    });
  }

  function tickRhythm() {
    var now = performance.now();
    if (now >= nextA) { fire('a'); nextA += BEAT_MS; }
    if (now >= nextV) { fire('v'); nextV += BEAT_MS; }
  }

  // ECG
  var ecgCtx, ecgMid, ecgAmp, PX_PER_MS;
  var ECG_BEAT_PX = 80;

  function gauss(x, mu, sig) { return Math.exp(-0.5 * Math.pow((x - mu) / sig, 2)); }
  function pqrst(p) {
    return  0.14 * gauss(p, 0.120, 0.040)
          - 0.07 * gauss(p, 0.270, 0.016)
          + 0.95 * gauss(p, 0.320, 0.022)
          - 0.20 * gauss(p, 0.380, 0.016)
          + 0.24 * gauss(p, 0.580, 0.070);
  }

  function drawEcg() {
    if (!ecgCtx) return;
    var now = performance.now();
    ecgCtx.fillStyle = 'rgba(5,12,22,0.95)';
    ecgCtx.fillRect(0, 0, W, H_ECG);

    var SMALL = ECG_BEAT_PX / 5;
    var sOff  = (now - beatEpoch) * PX_PER_MS % SMALL;
    ecgCtx.strokeStyle = 'rgba(74,222,128,0.09)';
    ecgCtx.lineWidth   = 0.5;
    for (var gx = W - sOff; gx >= -SMALL; gx -= SMALL) {
      ecgCtx.beginPath(); ecgCtx.moveTo(gx, 0); ecgCtx.lineTo(gx, H_ECG); ecgCtx.stroke();
    }

    ecgCtx.strokeStyle = '#4ade80';
    ecgCtx.lineWidth   = 1.2;
    ecgCtx.lineJoin    = 'round';
    ecgCtx.shadowBlur  = 4;
    ecgCtx.shadowColor = 'rgba(74,222,128,0.5)';
    ecgCtx.beginPath();
    for (var x = 0; x < W; x++) {
      var t     = now - beatEpoch - (W - 1 - x) / PX_PER_MS;
      var phase = ((t % BEAT_MS) + BEAT_MS) % BEAT_MS / BEAT_MS;
      var y     = ecgMid - pqrst(phase) * ecgAmp;
      if (x === 0) ecgCtx.moveTo(0, y); else ecgCtx.lineTo(x, y);
    }
    ecgCtx.stroke();
    ecgCtx.shadowBlur = 0;
  }

  function init() {
    if (!THREE || !THREE.GLTFLoader) return;

    // Build widget DOM
    var widget = document.createElement('div');
    widget.style.cssText = [
      'position:fixed', 'top:72px', 'right:14px',
      'width:' + W + 'px',
      'border-radius:10px', 'overflow:hidden',
      'box-shadow:0 4px 18px rgba(10,35,66,0.22),0 0 0 1px rgba(201,168,76,0.25)',
      'background:#f9f6f1', 'z-index:900', 'pointer-events:none'
    ].join(';');

    var hCanvas = document.createElement('canvas');
    hCanvas.style.cssText = 'display:block;width:' + W + 'px;height:' + H_3D + 'px;';

    var eCanvas = document.createElement('canvas');
    eCanvas.style.cssText = 'display:block;width:' + W + 'px;height:' + H_ECG + 'px;';

    widget.appendChild(hCanvas);
    widget.appendChild(eCanvas);
    document.body.appendChild(widget);

    // ECG canvas resolution
    var dpr = window.devicePixelRatio || 1;
    eCanvas.width  = Math.round(W   * dpr);
    eCanvas.height = Math.round(H_ECG * dpr);
    ecgCtx = eCanvas.getContext('2d');
    ecgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ecgMid    = H_ECG * 0.50;
    ecgAmp    = H_ECG * 0.35;
    PX_PER_MS = ECG_BEAT_PX / BEAT_MS;

    // Three.js scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf9f6f1);

    camera = new THREE.PerspectiveCamera(35, W / H_3D, 0.01, 200);
    camera.position.set(0, 0.1, 5.0);

    renderer = new THREE.WebGLRenderer({ canvas: hCanvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H_3D, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;

    clock = new THREE.Clock();

    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    var key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(3, 5, 4); scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-4, 1, 2); scene.add(fill);
    var rim = new THREE.DirectionalLight(0xffffff, 0.2);
    rim.position.set(0, -3, -4); scene.add(rim);

    var loader = new THREE.GLTFLoader();
    loader.load('heart.glb', function (gltf) {
      modelGroup = new THREE.Group();
      var model  = gltf.scene;

      var box = new THREE.Box3().setFromObject(model);
      var centre = new THREE.Vector3(), sz = new THREE.Vector3();
      box.getCenter(centre); box.getSize(sz);
      var s = 3.0 / Math.max(sz.x, sz.y, sz.z);
      model.scale.setScalar(s);
      model.position.copy(centre).multiplyScalar(-s);

      var halfDiag = 0.5 * Math.sqrt(sz.x * sz.x + sz.y * sz.y + sz.z * sz.z) * s;
      var fovHalf  = camera.fov * (Math.PI / 180) / 2;
      camera.position.set(0, halfDiag * 0.08, Math.max(3.8, halfDiag / Math.tan(fovHalf) * 1.00));

      // Valve shader
      model.traverse(function (node) {
        if (!node.isSkinnedMesh || !node.skeleton) return;
        var orig = node.material, texMap = (orig && orig.map) || null;
        if (texMap && texMap.image) {
          var img = texMap.image;
          var cv  = document.createElement('canvas');
          cv.width  = img.width  || img.naturalWidth  || 1024;
          cv.height = img.height || img.naturalHeight || 1024;
          var c2 = cv.getContext('2d');
          c2.drawImage(img, 0, 0, cv.width, cv.height);
          var id = c2.getImageData(0, 0, cv.width, cv.height), px = id.data;
          for (var i = 0; i < px.length; i += 4) {
            var r = px[i], g = px[i+1], b = px[i+2];
            if (b > r + 40 && b > g + 20) { px[i] = Math.max(r, 160); px[i+1] = Math.round(g * 0.3); px[i+2] = 0; }
          }
          c2.putImageData(id, 0, 0);
          var nt = new THREE.CanvasTexture(cv);
          nt.encoding = texMap.encoding; nt.wrapS = texMap.wrapS;
          nt.wrapT = texMap.wrapT; nt.flipY = texMap.flipY;
          texMap = nt;
        }
        var paleIdxs = [];
        node.skeleton.bones.forEach(function (bone, idx) {
          if (PALE_BONE_NAMES.indexOf(bone.name) !== -1) paleIdxs.push(idx);
        });
        var gl2 = paleIdxs.length
          ? paleIdxs.map(function (i) { return '_si.x==' + i + '||_si.y==' + i + '||_si.z==' + i + '||_si.w==' + i; }).join('||')
          : 'false';
        var gl1 = paleIdxs.length
          ? paleIdxs.map(function (i) { var f = i + '.0'; return 'abs(skinIndex.x-' + f + ')<0.5||abs(skinIndex.y-' + f + ')<0.5||abs(skinIndex.z-' + f + ')<0.5||abs(skinIndex.w-' + f + ')<0.5'; }).join('||')
          : 'false';
        var mat = new THREE.MeshStandardMaterial({ map: texMap, color: new THREE.Color(0.85, 0.15, 0.10), roughness: 0.9, metalness: 0.0 });
        mat.onBeforeCompile = function (shader) {
          shader.vertexShader   = 'varying float vIsValve;\n' + shader.vertexShader;
          shader.fragmentShader = 'varying float vIsValve;\n' + shader.fragmentShader;
          shader.vertexShader = shader.vertexShader.replace('#include <skinning_vertex>', [
            '#include <skinning_vertex>', '{',
            '  vec4 _sw = skinWeight; float _mw = _sw.x;',
            '#ifdef WEBGL2',
            '  ivec4 _si = skinIndex; int _dom = _si.x;',
            '  if(_sw.y>_mw){_mw=_sw.y;_dom=_si.y;} if(_sw.z>_mw){_mw=_sw.z;_dom=_si.z;} if(_sw.w>_mw){_mw=_sw.w;_dom=_si.w;}',
            '  vIsValve = (' + gl2 + ') ? 1.0 : 0.0;',
            '#else',
            '  float _domF = skinIndex.x;',
            '  if(_sw.y>_mw){_mw=_sw.y;_domF=skinIndex.y;} if(_sw.z>_mw){_mw=_sw.z;_domF=skinIndex.z;} if(_sw.w>_mw){_mw=_sw.w;_domF=skinIndex.w;}',
            '  vIsValve = (' + gl1 + ') ? 1.0 : 0.0;',
            '#endif', '}'
          ].join('\n'));
          shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', [
            '#include <map_fragment>',
            'if (vIsValve > 0.5) { diffuseColor.rgb = vec3(0.92, 0.82, 0.45); }'
          ].join('\n'));
        };
        node.material = mat;
      });

      // Collect bones
      model.traverse(function (node) {
        function tryAdd(b) {
          var d = { bone: b, restScale: b.scale.clone(), restRot: { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z } };
          if (ATRIA_NAMES.indexOf(b.name) !== -1) bonesAtria.push(d);
          if (VENTS_NAMES.indexOf(b.name) !== -1) bonesVents.push(d);
        }
        if (node.isSkinnedMesh && node.skeleton) node.skeleton.bones.forEach(tryAdd);
        if (node.isBone || node.type === 'Bone') tryAdd(node);
      });
      function dedupe(arr) {
        return arr.filter(function (d, i) { return arr.findIndex(function (x) { return x.bone === d.bone; }) === i; });
      }
      bonesAtria = dedupe(bonesAtria);
      bonesVents = dedupe(bonesVents);

      modelGroup.add(model);
      modelGroup.rotation.x = 0.12;
      modelGroup.rotation.y = rotY;
      scene.add(modelGroup);

      var now = performance.now();
      beatEpoch = now; nextA = now; nextV = now + 120;
    });

    // Render loop
    (function loop() {
      requestAnimationFrame(loop);
      var dt = clock.getDelta();
      if (modelGroup) {
        rotY += dt * 0.15;
        modelGroup.rotation.y = rotY;
        tickRhythm();
        applyContractions();
      }
      renderer.render(scene, camera);
      drawEcg();
    }());
  }

  document.addEventListener('DOMContentLoaded', function () {
    requestAnimationFrame(init);
  });
}());
