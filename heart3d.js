/* heart3d.js — Interactive 3D beating heart using Three.js
   Procedural geometry: ventricles, atria, great vessels
   Arrhythmia-specific beat animations synced to ae-panel selection
*/
(function () {
  'use strict';

  var THREE = window.THREE;
  var scene, camera, renderer, clock;
  var heartGroup, atriaGroup, raMesh, laMesh;
  var globalTime = 0;
  var currentCond = 'normal';
  var isVisible = false;
  var animId = null;
  var initialized = false;

  // Drag-to-rotate state
  var isDragging = false;
  var prevMouse = { x: 0, y: 0 };
  var targetRotY = 0.4;
  var targetRotX = 0.08;
  var currentRotY = 0.4;
  var currentRotX = 0.08;

  // ── Utility ──────────────────────────────────────────────────────────────
  function simpleHash(n) {
    // Deterministic pseudo-random [0,1)
    return (Math.abs(Math.sin(n * 127.1 + 311.7) * 43758.5453)) % 1.0;
  }

  // Beat envelope: phase [0,1] → contraction amplitude [0,1]
  // Fast systolic contraction, slow diastolic relaxation
  function beatCurve(phase) {
    if (phase < 0.18) return Math.sin((phase / 0.18) * Math.PI * 0.5);
    if (phase < 0.32) return 1.0 - ((phase - 0.18) / 0.14) * 0.25;
    var relax = Math.max(0, 1.0 - (phase - 0.32) / 0.68);
    return 0.75 * relax;
  }

  // ── Geometry helpers ──────────────────────────────────────────────────────
  function deformVentricles(geo) {
    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i);
      var y = pos.getY(i);
      var z = pos.getZ(i);
      // These start as points on a unit sphere

      // Stretch into heart-body ellipsoid
      var nx = x * 1.07;
      var ny = y * 1.30;
      var nz = z * 0.82;

      // Apex taper: bottom narrows and deflects slightly leftward
      if (y < 0.0) {
        var t = y * y;               // 0 at equator, 1 at south pole
        nx *= (1.0 - t * 0.48);
        nz *= (1.0 - t * 0.40);
        nx += y * 0.09;              // apex shifts left (anatomical)
        ny += t * 0.05;              // apex pulled slightly down
      }

      // Widen base (top portion)
      if (y > 0.45) {
        var bw = (y - 0.45) * 0.28;
        nx *= (1.0 + bw);
        nz *= (1.0 + bw * 0.55);
      }

      // Anterior interventricular groove — shallow indent at x≈0, z>0 face
      if (nz > 0.0) {
        var groove = Math.exp(-nx * nx * 5.0) * nz * 0.065;
        nz -= groove;
      }

      // Subtle surface irregularity (simulates cardiac muscle texture)
      var noise = (simpleHash(x * 17.3 + y * 31.7 + z * 53.1) - 0.5) * 0.018;
      nx += x * noise;
      ny += y * noise;
      nz += z * noise;

      pos.setXYZ(i, nx, ny, nz);
    }
    geo.computeVertexNormals();
  }

  function deformAtrium(geo, scaleX, scaleY, scaleZ) {
    var pos = geo.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i) * scaleX;
      var y = pos.getY(i) * scaleY;
      var z = pos.getZ(i) * scaleZ;
      var noise = (simpleHash(x * 19.1 + y * 43.3 + z * 71.7) - 0.5) * 0.02;
      pos.setXYZ(i, x + x * noise, y + y * noise, z + z * noise);
    }
    geo.computeVertexNormals();
  }

  // ── Build heart geometry ──────────────────────────────────────────────────
  function buildHeart() {
    heartGroup = new THREE.Group();
    scene.add(heartGroup);

    // Materials
    var muscleMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.38, 0.06, 0.06),   // deep cardiac red
      roughness: 0.64,
      metalness: 0.05,
    });

    var muscleLightMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.55, 0.09, 0.08),   // slightly brighter red
      roughness: 0.60,
      metalness: 0.06,
    });

    var arteryMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.72, 0.10, 0.07),
      roughness: 0.55,
      metalness: 0.08,
    });

    var veinMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.22, 0.06, 0.30),   // dark blue-purple
      roughness: 0.68,
      metalness: 0.04,
    });

    var fatMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.82, 0.72, 0.30),   // epicardial fat (yellowish)
      roughness: 0.80,
      metalness: 0.02,
    });

    // ── Ventricular body ─────────────────────────────────────────────────
    var ventGeo = new THREE.SphereGeometry(1.0, 56, 36);
    deformVentricles(ventGeo);
    var ventMesh = new THREE.Mesh(ventGeo, muscleMat);
    ventMesh.position.set(0.04, -0.18, 0.0);
    ventMesh.castShadow = true;
    ventMesh.receiveShadow = true;
    heartGroup.add(ventMesh);

    // ── Atrioventricular groove (fat pad at base) ────────────────────────
    var avGrooveGeo = new THREE.TorusGeometry(0.92, 0.12, 10, 36, Math.PI * 1.55);
    var avGrooveMesh = new THREE.Mesh(avGrooveGeo, fatMat);
    avGrooveMesh.position.set(0.05, 0.88, 0.0);
    avGrooveMesh.rotation.x = Math.PI * 0.48;
    avGrooveMesh.rotation.z = 0.22;
    heartGroup.add(avGrooveMesh);

    // ── Atria group (animated independently for AF) ──────────────────────
    atriaGroup = new THREE.Group();
    heartGroup.add(atriaGroup);

    // Right atrium — right side, anterior
    var raGeo = new THREE.SphereGeometry(0.43, 28, 22);
    deformAtrium(raGeo, 0.98, 0.86, 0.76);
    raMesh = new THREE.Mesh(raGeo, muscleMat);
    raMesh.position.set(-0.80, 0.65, 0.10);
    raMesh.castShadow = true;
    atriaGroup.add(raMesh);

    // Right atrial appendage
    var raAppGeo = new THREE.SphereGeometry(0.20, 14, 12);
    deformAtrium(raAppGeo, 1.3, 0.7, 0.6);
    var raAppMesh = new THREE.Mesh(raAppGeo, muscleMat);
    raAppMesh.position.set(-0.78, 0.85, 0.32);
    raAppMesh.rotation.z = -0.3;
    atriaGroup.add(raAppMesh);

    // Left atrium — posterior, left
    var laGeo = new THREE.SphereGeometry(0.41, 28, 22);
    deformAtrium(laGeo, 1.08, 0.80, 0.92);
    laMesh = new THREE.Mesh(laGeo, muscleLightMat);
    laMesh.position.set(0.50, 0.60, -0.30);
    laMesh.castShadow = true;
    atriaGroup.add(laMesh);

    // Left atrial appendage
    var laAppGeo = new THREE.SphereGeometry(0.18, 14, 12);
    deformAtrium(laAppGeo, 1.4, 0.65, 0.55);
    var laAppMesh = new THREE.Mesh(laAppGeo, muscleLightMat);
    laAppMesh.position.set(-0.22, 0.80, 0.35);
    laAppMesh.rotation.z = 0.25;
    atriaGroup.add(laAppMesh);

    // ── Great vessels ────────────────────────────────────────────────────

    // Ascending aorta
    var ascAortaGeo = new THREE.CylinderGeometry(0.17, 0.20, 0.74, 16);
    var ascAortaMesh = new THREE.Mesh(ascAortaGeo, arteryMat);
    ascAortaMesh.position.set(0.22, 1.28, 0.10);
    ascAortaMesh.rotation.z = 0.20;
    ascAortaMesh.castShadow = true;
    heartGroup.add(ascAortaMesh);

    // Aortic arch
    var aortaArchGeo = new THREE.TorusGeometry(0.24, 0.14, 10, 22, Math.PI * 0.80);
    var aortaArchMesh = new THREE.Mesh(aortaArchGeo, arteryMat);
    aortaArchMesh.position.set(0.44, 1.58, 0.10);
    aortaArchMesh.rotation.z = Math.PI * 0.52;
    aortaArchMesh.rotation.x = 0.20;
    aortaArchMesh.castShadow = true;
    heartGroup.add(aortaArchMesh);

    // Pulmonary trunk (wider, anterior to aorta)
    var paGeo = new THREE.CylinderGeometry(0.22, 0.23, 0.65, 16);
    var paMesh = new THREE.Mesh(paGeo, arteryMat);
    paMesh.position.set(-0.16, 1.22, 0.24);
    paMesh.rotation.z = -0.18;
    paMesh.castShadow = true;
    heartGroup.add(paMesh);

    // Pulmonary bifurcation
    var paBifGeo = new THREE.SphereGeometry(0.22, 14, 12);
    var paBifMesh = new THREE.Mesh(paBifGeo, arteryMat);
    paBifMesh.position.set(-0.18, 1.55, 0.24);
    heartGroup.add(paBifMesh);

    // Superior vena cava (entering RA from above) — blue-purple
    var svcGeo = new THREE.CylinderGeometry(0.10, 0.11, 0.40, 12);
    var svcMesh = new THREE.Mesh(svcGeo, veinMat);
    svcMesh.position.set(-0.86, 1.08, 0.08);
    svcMesh.rotation.z = 0.10;
    svcMesh.castShadow = true;
    heartGroup.add(svcMesh);

    // Inferior vena cava (entering RA from below)
    var ivcGeo = new THREE.CylinderGeometry(0.09, 0.10, 0.32, 10);
    var ivcMesh = new THREE.Mesh(ivcGeo, veinMat);
    ivcMesh.position.set(-0.74, 0.32, -0.10);
    ivcMesh.rotation.z = 0.35;
    ivcMesh.rotation.x = 0.20;
    heartGroup.add(ivcMesh);

    // Pulmonary veins × 2 entering LA from behind
    var pv1Geo = new THREE.CylinderGeometry(0.09, 0.09, 0.30, 10);
    var pv1Mesh = new THREE.Mesh(pv1Geo, veinMat);
    pv1Mesh.position.set(0.82, 0.62, -0.50);
    pv1Mesh.rotation.set(0.45, 0.0, 0.30);
    heartGroup.add(pv1Mesh);

    var pv2Geo = new THREE.CylinderGeometry(0.09, 0.09, 0.28, 10);
    var pv2Mesh = new THREE.Mesh(pv2Geo, veinMat);
    pv2Mesh.position.set(0.66, 0.44, -0.52);
    pv2Mesh.rotation.set(0.38, 0.0, 0.22);
    heartGroup.add(pv2Mesh);

    // Coronary arteries — right coronary
    var rcaGeo = new THREE.TorusGeometry(0.88, 0.04, 8, 28, Math.PI * 0.65);
    var rcaMesh = new THREE.Mesh(rcaGeo, arteryMat);
    rcaMesh.position.set(-0.05, 0.74, 0.0);
    rcaMesh.rotation.x = Math.PI * 0.42;
    rcaMesh.rotation.z = 0.15;
    heartGroup.add(rcaMesh);

    // Left anterior descending coronary
    var ladGeo = new THREE.TubeGeometry(
      new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0.10, 0.82, 0.72),
        new THREE.Vector3(0.06, 0.10, 0.90),
        new THREE.Vector3(0.08, -0.80, 0.62)
      ), 20, 0.04, 7, false
    );
    var ladMesh = new THREE.Mesh(ladGeo, arteryMat);
    heartGroup.add(ladMesh);

    // Anatomical orientation: apex down-left, base upper-right
    heartGroup.rotation.z = 0.15;
    heartGroup.rotation.x = 0.08;
    heartGroup.rotation.y = targetRotY;
  }

  // ── Lighting ──────────────────────────────────────────────────────────────
  function setupLighting() {
    // Warm ambient
    scene.add(new THREE.AmbientLight(0xffe8d4, 0.42));

    // Main key light — upper left front
    var key = new THREE.DirectionalLight(0xfff5ee, 0.88);
    key.position.set(-2.2, 3.5, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    scene.add(key);

    // Warm fill — front right
    var fill = new THREE.PointLight(0xff7844, 0.50, 14);
    fill.position.set(2.8, 0.8, 3.8);
    scene.add(fill);

    // Cool rim — rear, creates depth separation
    var rim = new THREE.PointLight(0x5577cc, 0.22, 12);
    rim.position.set(0.5, 1.5, -4.5);
    scene.add(rim);

    // Subtle underlight — warms the apex
    var under = new THREE.PointLight(0xff3311, 0.14, 8);
    under.position.set(0, -4, 1);
    scene.add(under);

    // Hemisphere sky/ground
    scene.add(new THREE.HemisphereLight(0xfff0e0, 0x330808, 0.28));
  }

  // ── Beat patterns ────────────────────────────────────────────────────────
  // Returns { vScale, aScale } — scale multipliers (1.0 = resting, <1 = contracted)
  function getBeatScales(cond, t) {
    var vScale = 1.0;
    var aScale = 1.0;

    switch (cond) {
      case 'normal': {
        // 70 bpm — period 0.857s; atria contract slightly ahead (PR interval ~0.16s)
        var p = 0.857;
        vScale = 1.0 - 0.082 * beatCurve((t % p) / p);
        aScale = 1.0 - 0.068 * beatCurve(((t + 0.13) % p) / p);
        break;
      }

      case 'af': {
        // Irregular ventricular response ~90–110 bpm
        // Simulate irregular timing with overlapping sinusoids
        var af1 = Math.sin(t * 9.8);
        var af2 = Math.sin(t * 14.3);
        var irregPeriod = 0.60 + (af1 * 0.08 + af2 * 0.05) * 0.18;
        irregPeriod = Math.max(0.42, irregPeriod);
        vScale = 1.0 - 0.078 * beatCurve((t % irregPeriod) / irregPeriod);
        // Atria: chaotic quiver, no coordinated contraction
        var quiver = 0.022 * (Math.sin(t * 38.0) + Math.sin(t * 51.7) + Math.sin(t * 67.3));
        aScale = 1.0 + quiver;
        break;
      }

      case 'flutter': {
        // 150 bpm — period 0.40s; regular fast
        var p = 0.40;
        vScale = 1.0 - 0.079 * beatCurve((t % p) / p);
        aScale = 1.0 - 0.058 * beatCurve(((t + 0.065) % p) / p);
        break;
      }

      case 'at': {
        // 160 bpm — period 0.375s; focal atrial tachycardia
        var p = 0.375;
        vScale = 1.0 - 0.079 * beatCurve((t % p) / p);
        aScale = 1.0 - 0.062 * beatCurve(((t + 0.060) % p) / p);
        break;
      }

      case 'svt': {
        // 200 bpm — period 0.30s; very fast, diminished stroke volume
        var p = 0.30;
        vScale = 1.0 - 0.070 * beatCurve((t % p) / p);
        aScale = 1.0 - 0.054 * beatCurve(((t + 0.045) % p) / p);
        break;
      }

      case 'vt': {
        // 180 bpm — period 0.333s; AV dissociation: ventricles fast, atria independent at ~72bpm
        var vP = 0.333;
        var aP = 0.857; // atria at sinus rate, dissociated
        vScale = 1.0 - 0.086 * beatCurve((t % vP) / vP);
        // Asymmetric: emphasise LV origin; slight x-axis oscillation added in animate()
        aScale = 1.0 - 0.062 * beatCurve((t % aP) / aP);
        break;
      }

      case 'pvc': {
        // 72 bpm with PVC every 5 normal beats, followed by compensatory pause
        // Cycle: beat, beat, beat, beat, PVC (early), long pause — ~5.5 × 0.833s
        var normalP = 0.833;
        var cycleLen = normalP * 4 + 0.45 + normalP * 1.5; // ~5.48s
        var pos = t % cycleLen;
        var phase = 0;
        if (pos < normalP) {
          phase = (pos / normalP);
        } else if (pos < normalP * 2) {
          phase = ((pos - normalP) / normalP);
        } else if (pos < normalP * 3) {
          phase = ((pos - normalP * 2) / normalP);
        } else if (pos < normalP * 4) {
          phase = ((pos - normalP * 3) / normalP);
        } else if (pos < normalP * 4 + 0.45) {
          // PVC: early, wider QRS (more forceful but abnormal)
          phase = (pos - normalP * 4) / 0.45;
        } else {
          // Compensatory pause — no beat
          phase = 0;
        }
        vScale = 1.0 - 0.082 * beatCurve(phase);
        aScale = vScale; // Atria track sinus beats; for PVC, atria dissociated (simplified to same)
        break;
      }

      case 'csp':
      case 'crt': {
        // Paced 65 bpm — regular, physiologically coordinated
        var p = 0.923;
        vScale = 1.0 - 0.082 * beatCurve((t % p) / p);
        aScale = 1.0 - 0.066 * beatCurve(((t + 0.12) % p) / p);
        break;
      }

      default: {
        var p = 0.857;
        vScale = 1.0 - 0.082 * beatCurve((t % p) / p);
        aScale = vScale;
      }
    }

    return { vScale: vScale, aScale: aScale };
  }

  // ── Animation loop ────────────────────────────────────────────────────────
  function animate() {
    animId = requestAnimationFrame(animate);
    if (!heartGroup || !renderer) return;

    var delta = clock.getDelta();
    globalTime += delta;

    // Smooth rotation interpolation
    var lerpSpeed = 0.12;
    if (!isDragging) {
      targetRotY += delta * 0.18; // slow auto-rotate when idle
    }
    currentRotY += (targetRotY - currentRotY) * lerpSpeed;
    currentRotX += (targetRotX - currentRotX) * lerpSpeed;

    heartGroup.rotation.y = currentRotY;
    heartGroup.rotation.x = currentRotX;
    heartGroup.rotation.z = 0.15;

    var scales = getBeatScales(currentCond, globalTime);
    var vs = scales.vScale;
    var as = scales.aScale;

    // VT: add slight asymmetric oscillation to simulate abnormal contraction wavefront
    var vtTwist = 0;
    if (currentCond === 'vt') {
      vtTwist = 0.015 * Math.sin(globalTime * Math.PI * 2 / 0.333);
    }

    // Scale heartGroup = ventricular scale
    heartGroup.scale.setScalar(vs);

    // Atria scale = aScale in world space; heartGroup already applied vs,
    // so local atriaGroup scale must be as/vs to compensate
    if (atriaGroup) {
      var localA = as / vs;
      atriaGroup.scale.setScalar(Math.max(0.88, Math.min(1.14, localA)));
      // VT: atria sit at independent rhythm — add slight positional wiggle for dissociation feel
      if (currentCond === 'vt') {
        atriaGroup.rotation.z = vtTwist * 0.5;
      } else {
        atriaGroup.rotation.z = 0;
      }
    }

    renderer.render(scene, camera);
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  function setupControls(canvas) {
    function onDown(cx, cy) {
      isDragging = true;
      prevMouse.x = cx;
      prevMouse.y = cy;
    }
    function onMove(cx, cy) {
      if (!isDragging) return;
      var dx = cx - prevMouse.x;
      var dy = cy - prevMouse.y;
      targetRotY += dx * 0.012;
      targetRotX += dy * 0.009;
      targetRotX = Math.max(-1.1, Math.min(1.1, targetRotX));
      prevMouse.x = cx;
      prevMouse.y = cy;
    }
    function onUp() { isDragging = false; }

    canvas.addEventListener('mousedown', function (e) { onDown(e.clientX, e.clientY); });
    window.addEventListener('mousemove', function (e) { onMove(e.clientX, e.clientY); });
    window.addEventListener('mouseup', onUp);

    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) onDown(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length === 1) { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); }
    }, { passive: false });
    canvas.addEventListener('touchend', onUp);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    if (!THREE) { console.warn('Heart3D: Three.js not loaded'); return; }
    if (initialized) return;
    initialized = true;

    var canvas = document.getElementById('heart3d-canvas');
    if (!canvas) return;

    // Derive size from container (canvas has no CSS size set yet)
    var container = document.getElementById('ae-3d-view');
    var w = (container && container.clientWidth > 0) ? container.clientWidth : 380;
    var h = w; // 1:1 aspect ratio

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf9f6f1);
    scene.fog = new THREE.Fog(0xf9f6f1, 9, 22);

    // Camera
    camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 100);
    camera.position.set(0, 0.2, 5.8);
    camera.lookAt(0, 0.1, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    if (THREE.sRGBEncoding !== undefined) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }

    // Clock
    clock = new THREE.Clock();

    buildHeart();
    setupLighting();
    setupControls(canvas);

    window.addEventListener('resize', function () {
      if (window.Heart3D) window.Heart3D.resize();
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.Heart3D = {
    show: function () {
      var container = document.getElementById('ae-3d-view');
      if (!container) return;
      if (!initialized) init();
      isVisible = true;
      if (!animId) animate();
      // Force renderer to correct size after display change
      setTimeout(function () { window.Heart3D.resize(); }, 50);
    },

    hide: function () {
      isVisible = false;
      if (animId !== null) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    },

    setCondition: function (cond) {
      currentCond = cond;
    },

    resize: function () {
      if (!camera || !renderer) return;
      var container = document.getElementById('ae-3d-view');
      if (!container || container.clientWidth === 0) return;
      var w = container.clientWidth;
      var h = w; // maintain 1:1
      camera.aspect = 1;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  };

  // ── Hook into aeSwitch ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var original = window.aeSwitch;
    if (!original) return;
    window.aeSwitch = function (cond) {
      original(cond);
      window._ae3dCond = cond;
      if (window.Heart3D) window.Heart3D.setCondition(cond);
    };
  });

}());
