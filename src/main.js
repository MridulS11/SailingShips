import * as THREE from 'three';

// ============================================================================
// 1. REAL-TIME 3D WEBGL + GLSL SHADER ENGINE (THREE.JS)
// ============================================================================

const webglCanvas = document.getElementById('hero-webgl-canvas');
const inkCanvas = document.getElementById('hero-ink-overlay');
const inkCtx = inkCanvas.getContext('2d');

const renderer = new THREE.WebGLRenderer({
  canvas: webglCanvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 2;

const textureLoader = new THREE.TextureLoader();

const heroPlateTex = textureLoader.load('/assets/hero_bg_plate.jpg');
heroPlateTex.minFilter = THREE.LinearFilter;
heroPlateTex.magFilter = THREE.LinearFilter;
heroPlateTex.wrapS = THREE.ClampToEdgeWrapping;
heroPlateTex.wrapT = THREE.ClampToEdgeWrapping;

const shipMaskTex = textureLoader.load('/assets/ship_zones_mask.png');
shipMaskTex.minFilter = THREE.LinearFilter;
shipMaskTex.magFilter = THREE.LinearFilter;
shipMaskTex.wrapS = THREE.ClampToEdgeWrapping;
shipMaskTex.wrapT = THREE.ClampToEdgeWrapping;

// Vertex Shader: Keep geometry flat so rigid ship hull & poles never warp
const vertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment Shader:
// - Rigid-Body Ship Rocking on the Sea (Hull + Wooden Masts/Poles/Yardarms rock solidly without bending)
// - Air-Waving Sails, Ropes & Flag ONLY (strictly masked to canvas & rigging via maskData.g)
// - Dark Opaque Sea Submerging Underwater Hull + Shimmering Lantern & Hull Reflections
// - Gloomy Dark Boiling Storm Clouds with Animated Ink Cross-Hatching
const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uSceneTex;
  uniform sampler2D uMaskTex;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uMouse;

  varying vec2 vUv;

  // --- Hash & Value Noise ---
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = rot * p * 2.04 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  // --- Cover UV mapping so 16:9 artwork fills screen cleanly ---
  vec2 getCoverUv(vec2 uv, vec2 res) {
    float screenAspect = res.x / max(res.y, 1.0);
    float texAspect = 1376.0 / 768.0;
    vec2 scale = vec2(1.0);
    if (screenAspect > texAspect) {
      scale.y = texAspect / screenAspect;
    } else {
      scale.x = screenAspect / texAspect;
    }
    scale *= 0.965;
    vec2 parallax = (uMouse - 0.5) * vec2(0.010, 0.006);
    return (uv - 0.5) * scale + 0.5 + parallax;
  }

  // --- Procedural Hand-Drawn Cross-Hatching Function ---
  float sketchHatch(vec2 uv, float lum, float timeJitter) {
    vec2 p = uv * vec2(uResolution.x, uResolution.y) * 0.72;
    float wobble = noise(p * 0.035 + timeJitter) * 2.2;

    float d1 = sin((p.x * 0.81 + p.y * 0.58 + wobble) * 1.35);
    float hatch1 = smoothstep(0.55, 0.88, d1);

    float d2 = sin((p.x * 0.74 - p.y * 0.67 - wobble) * 1.45);
    float hatch2 = smoothstep(0.62, 0.92, d2);

    float grain = noise(p * 0.45 + timeJitter * 2.0);

    float inkDarkness = 0.0;
    inkDarkness += (1.0 - smoothstep(0.18, 0.55, lum)) * hatch1 * 0.34;
    inkDarkness += (1.0 - smoothstep(0.08, 0.34, lum)) * hatch2 * 0.40;
    inkDarkness += (1.0 - grain) * 0.07;

    return clamp(inkDarkness, 0.0, 0.75);
  }

  // --- Deformed UV Computation ---
  vec2 computeAnimatedUv(vec2 baseUv, out vec3 maskData, out float seaMask, out float cloudMask) {
    maskData = texture2D(uMaskTex, baseUv).rgb;
    float shipWeight = maskData.r; // 1.0 uniformly across the entire above-water ship
    float sailWeight = maskData.g; // > 0 ONLY on canvas sails, ropes & flag; 0.0 on all poles & hull

    // Strictly exclude the above-water ship from seaMask and cloudMask so poles/hull never wave!
    float notShip = 1.0 - smoothstep(0.05, 0.45, shipWeight);
    seaMask = smoothstep(0.258, 0.208, baseUv.y) * notShip;
    cloudMask = smoothstep(0.26, 0.42, baseUv.y) * notShip;

    vec2 uv = baseUv;

    // 1. RIGID-BODY SHIP ROCKING BY THE SEA
    // Because shipWeight == 1.0 across the entire ship silhouette (hull + poles + masts + yards),
    // the entire vessel rotates and heaves as a single rigid timber body riding the ocean swells.
    float shipRockAngle = sin(uTime * 1.25) * 0.017 + cos(uTime * 0.72) * 0.007;
    float shipHeaveY = sin(uTime * 1.25 - 1.1) * 0.0075 + cos(uTime * 1.9) * 0.0025;
    float shipSurgeX = cos(uTime * 0.95) * 0.004;

    vec2 pivot = vec2(0.73, 0.22);
    vec2 rel = uv - pivot;
    float c = cos(shipRockAngle);
    float s = sin(shipRockAngle);
    vec2 rigidRockedUv = pivot + mat2(c, -s, s, c) * rel + vec2(shipSurgeX, -shipHeaveY);

    // Smoothly blend from background UV to rigid-rocked ship UV using shipWeight
    uv = mix(uv, rigidRockedUv, shipWeight);

    // Sample the mask in the ship's rocked coordinate frame so the sail/pole boundaries
    // move 1:1 with the rocking ship and never lag behind!
    vec3 rockedMask = texture2D(uMaskTex, uv).rgb;
    float activeSail = rockedMask.g * smoothstep(0.1, 0.5, shipWeight);

    // 2. AIR-WAVING SAILS, ROPES & FLAG ONLY (Poles & Hull have activeSail == 0.0!)
    if (activeSail > 0.001) {
      // Billowing wind waves travelling right-to-left across the canvas sails & ropes
      float windWaveX = sin(uv.y * 30.0 - uTime * 4.5 + uv.x * 15.0) * 0.0052
                      + cos(uv.y * 52.0 - uTime * 6.8) * 0.0018;
      float windWaveY = cos(uv.x * 24.0 - uTime * 3.8 + uv.y * 12.0) * 0.0028;

      vec2 windOffset = vec2(windWaveX, windWaveY) * activeSail;

      // Extra high-frequency wind whip strictly on the top skull flag
      float flagZone = smoothstep(0.87, 0.93, uv.y) * activeSail;
      windOffset.y += sin(uv.x * 75.0 - uTime * 12.0) * 0.0042 * flagZone;
      windOffset.x += cos(uv.y * 50.0 - uTime * 10.0) * 0.0026 * flagZone;

      // Prevent displaced sail UV from ever crossing into a rigid wooden pole (where mask.g == 0),
      // so the pole right below the bottom sail never floats or gets sampled into the waving sail!
      float targetSailWeight = texture2D(uMaskTex, uv + windOffset).g;
      float poleGuard = smoothstep(0.04, 0.30, targetSailWeight);
      uv += windOffset * poleGuard;
    }

    // 3. SKY & STORM CLOUD BOILING / DRIFTING ACTIVITY (Strictly outside the ship)
    if (cloudMask > 0.001) {
      vec2 cloudNoiseUv = baseUv * vec2(5.5, 3.8) + vec2(uTime * 0.065, -uTime * 0.025);
      float cWarpX = (fbm(cloudNoiseUv) - 0.5) * 0.017;
      float cWarpY = (fbm(cloudNoiseUv + vec2(4.2, 1.9)) - 0.5) * 0.012;
      uv += vec2(cWarpX, cWarpY) * cloudMask;
    }

    // 4. REAL-TIME FLOWING OCEAN SWELLS & WAVE ADVECTION (Strictly in the sea)
    if (seaMask > 0.001) {
      float depthFactor = clamp((0.26 - baseUv.y) / 0.26, 0.0, 1.0);
      float persp = 0.22 + 1.30 * pow(depthFactor, 1.25);

      float swell1 = sin(baseUv.x * 22.0 + baseUv.y * 38.0 + uTime * 2.5);
      float swell2 = cos(baseUv.x * 36.0 - baseUv.y * 52.0 + uTime * 3.2);
      float chop = sin(baseUv.x * 70.0 + baseUv.y * 95.0 + uTime * 5.0) * 0.35;

      uv.x += (swell1 * 0.0072 + swell2 * 0.0038) * persp * seaMask;
      uv.y += (swell2 * 0.0050 + chop * 0.0026) * persp * seaMask;
    }

    return clamp(uv, 0.002, 0.998);
  }

  void main() {
    vec2 baseUv = getCoverUv(vUv, uResolution);

    vec3 maskData;
    float seaMask;
    float cloudMask;
    vec2 animUv = computeAnimatedUv(baseUv, maskData, seaMask, cloudMask);

    // Re-sample mask at animUv so shading aligns with the rocked ship position
    vec3 rockedMask = texture2D(uMaskTex, animUv).rgb;
    float shipWeight = maskData.r;
    float sailWeight = rockedMask.g;
    float lanternWeight = rockedMask.b;

    // Sample base color and 4 neighbors for real-time Sobel/DoG Ink Sketch Edge Detection
    vec2 texel = vec2(1.35) / uResolution;
    vec3 colCenter = texture2D(uSceneTex, animUv).rgb;
    vec3 colL = texture2D(uSceneTex, animUv - vec2(texel.x, 0.0)).rgb;
    vec3 colR = texture2D(uSceneTex, animUv + vec2(texel.x, 0.0)).rgb;
    vec3 colU = texture2D(uSceneTex, animUv + vec2(0.0, texel.y)).rgb;
    vec3 colD = texture2D(uSceneTex, animUv - vec2(0.0, texel.y)).rgb;

    float lumC = dot(colCenter, vec3(0.299, 0.587, 0.114));
    float lumL = dot(colL, vec3(0.299, 0.587, 0.114));
    float lumR = dot(colR, vec3(0.299, 0.587, 0.114));
    float lumU = dot(colU, vec3(0.299, 0.587, 0.114));
    float lumD = dot(colD, vec3(0.299, 0.587, 0.114));

    float gx = lumR - lumL;
    float gy = lumU - lumD;
    float edgeMag = sqrt(gx * gx + gy * gy);
    float laplacian = (lumL + lumR + lumU + lumD) * 0.25 - lumC;

    vec3 color = colCenter;

    // ========================================================================
    // A. GLOOMY, DARK, CHURNING STORM SKY & LIVE CLOUD ACTIVITY
    // ========================================================================
    if (cloudMask > 0.001) {
      float skyHeight = smoothstep(0.25, 0.92, baseUv.y);
      float gloomyFactor = mix(0.76, 0.42, pow(skyHeight, 0.85));
      color *= mix(1.0, gloomyFactor, cloudMask);

      vec2 driftUv1 = baseUv * vec2(3.6, 2.4) + vec2(uTime * 0.042, uTime * 0.012);
      vec2 driftUv2 = baseUv * vec2(7.2, 4.8) - vec2(uTime * 0.068, -uTime * 0.018);
      float cloudBillow = fbm(driftUv1 + fbm(driftUv2) * 0.65);

      float cloudContour = smoothstep(0.012, 0.032, abs(cloudBillow - 0.52));
      float darkInkContour = (1.0 - cloudContour) * smoothstep(0.35, 0.85, baseUv.y) * 0.55;

      vec3 stormTint = vec3(0.11, 0.13, 0.16) * smoothstep(0.38, 0.72, cloudBillow);
      color = mix(color, color * 0.68 + stormTint * 0.48, cloudMask * 0.65);
      color *= (1.0 - darkInkContour * cloudMask);

      float lightningCycle = sin(uTime * 0.9) * sin(uTime * 2.3 + 1.4);
      float lightningFlash = pow(max(0.0, lightningCycle), 14.0) * 0.28;
      float cloudCore = smoothstep(0.45, 0.72, cloudBillow) * smoothstep(0.35, 0.82, baseUv.y);
      color += vec3(0.16, 0.19, 0.22) * lightningFlash * cloudCore * cloudMask;
    }

    // ========================================================================
    // B. DARK OPAQUE SEA, WATERLINE OCCLUSION & SHIMMERING WATER REFLECTIONS
    // ========================================================================
    if (seaMask > 0.001) {
      float depth = clamp((0.258 - baseUv.y) / 0.258, 0.0, 1.0);
      vec2 seaP = vec2(
        (baseUv.x - 0.5) / (0.18 + depth * 0.85),
        pow(depth, 0.65) * 14.0
      );

      float w1 = sin(seaP.x * 7.5 + seaP.y * 4.2 + uTime * 2.4 + fbm(seaP * 1.4 + uTime * 0.4) * 2.6);
      float w2 = sin(seaP.x * 13.0 - seaP.y * 6.5 + uTime * 3.1 + noise(seaP * 2.8) * 2.0);

      // Ensure any submerged region directly beneath the ship hull is dark opaque water (no hull visible!)
      float underHullZone = smoothstep(0.56, 0.62, baseUv.x) * smoothstep(0.91, 0.85, baseUv.x)
                          * smoothstep(0.08, 0.21, baseUv.y) * smoothstep(0.235, 0.195, baseUv.y);
      // Suppress any brownish/wooden warmth in the water itself before adding reflections
      vec3 darkSeaTone = vec3(0.035, 0.048, 0.065) + vec3(0.04, 0.05, 0.06) * (0.5 + 0.5 * w1);
      float isBrownish = clamp((color.r - color.b) * 4.0, 0.0, 1.0);
      color = mix(color, darkSeaTone, clamp(underHullZone * (0.65 + 0.35 * isBrownish), 0.0, 0.92) * seaMask);

      // Dark hull reflection shadow rippling on the water surface beneath the ship
      float hullShadowRefl = smoothstep(0.58, 0.64, baseUv.x) * smoothstep(0.89, 0.83, baseUv.x)
                           * smoothstep(0.06, 0.20, baseUv.y);
      float shadowRipple = 0.5 + 0.5 * sin(baseUv.y * 220.0 + w1 * 3.5 + uTime * 4.5);
      color *= 1.0 - hullShadowRefl * (0.28 + 0.18 * shadowRipple) * seaMask;

      // Crisp white-ink sketch contour lines along wave ridges
      float ridgeLine1 = smoothstep(0.84, 0.96, w1) * smoothstep(0.04, 0.35, depth);
      float ridgeLine2 = smoothstep(0.88, 0.98, w2) * smoothstep(0.08, 0.65, depth) * 0.7;
      float woodcutTrough = smoothstep(0.4, 0.85, sin(seaP.y * 28.0 + w1 * 3.5 + uTime * 2.4));

      float troughShadow = smoothstep(0.2, -0.7, w1) * 0.42;
      color *= (1.0 - troughShadow * seaMask);
      color *= (1.0 - (1.0 - woodcutTrough) * 0.24 * seaMask);

      vec3 inkWhite = vec3(0.84, 0.82, 0.77);
      float sketchCrest = (ridgeLine1 * 0.42 + ridgeLine2 * 0.28) * (0.4 + 0.6 * noise(baseUv * 90.0 + uTime));
      color = mix(color, inkWhite, clamp(sketchCrest * seaMask, 0.0, 0.65));

      // Churning White-Ink Bow Wake right along the raised waterline
      vec2 bowCenter = vec2(0.65, 0.195);
      float bowDist = length((baseUv - bowCenter) * vec2(1.3, 4.2));
      float bowFoam = smoothstep(0.22, 0.02, bowDist) *
        smoothstep(0.38, 0.85, fbm(baseUv * vec2(45.0, 85.0) + vec2(uTime * 3.2, -uTime * 1.8)));
      color = mix(color, inkWhite, bowFoam * seaMask * 0.65);

      // Shimmering Warm Golden Water Reflections below the Stern Cabin Windows & Bow Lantern
      float flicker = 0.88 + 0.24 * sin(uTime * 7.5) * cos(uTime * 11.3);
      float waterWaveShimmer = smoothstep(0.35, 0.92, sin(baseUv.y * 240.0 + w1 * 4.5 + uTime * 5.8));

      // Stern cabin window reflections on the dark sea (around x = 0.85..0.88, y = 0.10..0.22)
      vec2 sternWater = vec2(0.862, 0.175);
      float sternDist = length((baseUv - sternWater) * vec2(2.6, 2.8));
      float sternRefl = smoothstep(0.18, 0.0, sternDist) * waterWaveShimmer * flicker * 0.52;

      // Bow cabin lantern reflection on the dark sea (around x = 0.67, y = 0.12..0.20)
      vec2 bowLanternWater = vec2(0.672, 0.165);
      float bowLanternDist = length((baseUv - bowLanternWater) * vec2(3.2, 3.4));
      float bowRefl = smoothstep(0.15, 0.0, bowLanternDist) * waterWaveShimmer * flicker * 0.36;

      color += vec3(0.92, 0.46, 0.15) * (sternRefl + bowRefl) * seaMask;
    }

    // ========================================================================
    // C. WARM FLICKERING CABIN LANTERNS & SAILS SHADING
    // ========================================================================
    if (shipWeight > 0.01) {
      float sailRippleLight = sin(animUv.y * 32.0 - uTime * 4.6 + animUv.x * 16.0) * 0.085 * sailWeight;
      color += vec3(sailRippleLight * 0.85, sailRippleLight * 0.78, sailRippleLight * 0.65);

      float flicker = 0.85 + 0.35 * sin(uTime * 7.5) * cos(uTime * 13.2 + 0.7);
      color += vec3(0.95, 0.48, 0.15) * lanternWeight * flicker * 0.55;
    }

    // ========================================================================
    // D. EXAGGERATED HAND-SKETCHED INK OUTLINES & CROSS-HATCHING PASS
    // ========================================================================
    float finalLum = dot(color, vec3(0.299, 0.587, 0.114));

    float darkInkEdge = smoothstep(0.035, 0.16, edgeMag) * smoothstep(-0.005, 0.04, laplacian + 0.02);
    color *= (1.0 - darkInkEdge * 0.62);

    float whiteChalkEdge = smoothstep(0.05, 0.20, edgeMag) * smoothstep(0.01, 0.06, -laplacian) * smoothstep(0.32, 0.75, finalLum);
    color = mix(color, vec3(0.88, 0.85, 0.79), whiteChalkEdge * 0.45);

    float sketchTimeStep = floor(uTime * 10.0) * 0.1;
    float hatchStrength = sketchHatch(animUv, finalLum, sketchTimeStep);
    color *= (1.0 - hatchStrength * 0.38);

    color = pow(clamp(color, 0.0, 1.0), vec3(1.08));

    gl_FragColor = vec4(color, 1.0);
  }
`;

const uniforms = {
  uSceneTex: { value: heroPlateTex },
  uMaskTex: { value: shipMaskTex },
  uTime: { value: 0 },
  uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  uMouse: { value: new THREE.Vector2(0.5, 0.5) },
};

const geometry = new THREE.PlaneGeometry(2, 2, 64, 64);
const material = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms,
});

const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

// ============================================================================
// 2. LIVE 2D HAND-SKETCHED OVERLAY ENGINE
// ============================================================================

let width = window.innerWidth;
let height = window.innerHeight;

function resizeCanvases() {
  width = window.innerWidth;
  height = window.innerHeight;

  renderer.setSize(width, height);
  uniforms.uResolution.value.set(width, height);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  inkCanvas.width = width * dpr;
  inkCanvas.height = height * dpr;
  inkCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

resizeCanvases();
window.addEventListener('resize', resizeCanvases);

// 1. Floating Warm Embers around the Ship
const EMBER_COUNT = 42;
const embers = Array.from({ length: EMBER_COUNT }, () => ({
  x: 0.62 + Math.random() * 0.28,
  y: 0.52 + Math.random() * 0.25,
  vx: -(0.00025 + Math.random() * 0.00055),
  vy: -(0.0003 + Math.random() * 0.0006),
  size: 1.2 + Math.random() * 2.4,
  alpha: 0.3 + Math.random() * 0.7,
  phase: Math.random() * Math.PI * 2,
}));

// 2. White-Ink Sea Spray Droplets bursting from the Curling Wave (bottom-left) & Ship's Waterline Bow
const SPRAY_COUNT = 55;
const sprayDrops = Array.from({ length: SPRAY_COUNT }, (_, i) => {
  const isBow = i % 3 === 0;
  return {
    isBow,
    originX: isBow ? 0.61 + Math.random() * 0.09 : 0.14 + Math.random() * 0.14,
    originY: isBow ? 0.785 + Math.random() * 0.035 : 0.82 + Math.random() * 0.08,
    x: 0,
    y: 0,
    vx: (Math.random() - 0.55) * 0.0018,
    vy: -(0.0012 + Math.random() * 0.0024),
    gravity: 0.000048,
    life: Math.random(),
    maxLife: 0.65 + Math.random() * 0.55,
    size: 1.0 + Math.random() * 2.2,
  };
});

function resetSprayDrop(d) {
  d.x = d.originX + (Math.random() - 0.5) * 0.04;
  d.y = d.originY + (Math.random() - 0.5) * 0.02;
  d.vx = (Math.random() - 0.62) * 0.0018;
  d.vy = -(0.0011 + Math.random() * 0.0022);
  d.life = 0;
}
sprayDrops.forEach(resetSprayDrop);

// 3. Diagonal Sketch Rain / Wind Charcoal Streaks
const RAIN_COUNT = 68;
const rainStrokes = Array.from({ length: RAIN_COUNT }, () => ({
  x: Math.random(),
  y: Math.random() * 0.85,
  len: 18 + Math.random() * 34,
  speed: 0.006 + Math.random() * 0.008,
  alpha: 0.06 + Math.random() * 0.12,
}));

// 4. Flowing Sketch Wave Ribbons across the Sea (y: 0.76..0.98)
const WAVE_RIBBONS = Array.from({ length: 18 }, (_, idx) => {
  const depthT = idx / 17;
  return {
    yBase: 0.76 + Math.pow(depthT, 1.35) * 0.225,
    speed: (0.045 + depthT * 0.11) * (idx % 2 === 0 ? 1 : 0.85),
    amp: 2.5 + depthT * 11.5,
    freq: 2.5 + (1 - depthT) * 4.5,
    offset: Math.random() * 100,
    width: 0.7 + depthT * 1.4,
    alpha: 0.14 + depthT * 0.28,
  };
});

function renderInkOverlay(time, dt) {
  inkCtx.clearRect(0, 0, width, height);

  // A. Diagonal Charcoal Sketch Rain / Wind Lines in the Stormy Sky
  inkCtx.save();
  inkCtx.lineCap = 'round';
  for (let i = 0; i < rainStrokes.length; i++) {
    const r = rainStrokes[i];
    r.x -= r.speed * 0.58;
    r.y += r.speed;
    if (r.y > 0.88 || r.x < -0.05) {
      r.x = Math.random() * 1.15;
      r.y = -0.05;
    }
    const sx = r.x * width;
    const sy = r.y * height;
    inkCtx.strokeStyle = `rgba(195, 190, 180, ${r.alpha})`;
    inkCtx.lineWidth = 0.85;
    inkCtx.beginPath();
    inkCtx.moveTo(sx, sy);
    inkCtx.lineTo(sx - r.len * 0.58, sy + r.len);
    inkCtx.stroke();
  }
  inkCtx.restore();

  // B. Live Flowing White-Ink Sketch Wave Contours across the Sea
  //    (Never draw over the above-water ship hull!)
  inkCtx.save();
  for (let i = 0; i < WAVE_RIBBONS.length; i++) {
    const w = WAVE_RIBBONS[i];
    const baseY = w.yBase * height;
    const phase = time * w.speed * 12.0 + w.offset;

    inkCtx.beginPath();
    const steps = 48;
    let penDown = false;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // If this wave ribbon is higher than the ship's waterline (w.yBase < 0.795),
      // lift the pen across the ship's hull span (t in 0.575..0.895) so waves never cross the hull!
      if (w.yBase < 0.795 && t > 0.575 && t < 0.895) {
        penDown = false;
        continue;
      }

      const px = t * width;
      const heroCrestBoost = Math.exp(-Math.pow((t - 0.21) / 0.085, 2)) * 1.85;

      const waveY =
        Math.sin(t * w.freq * Math.PI * 2 + phase) * w.amp * (1 + heroCrestBoost * 0.45) +
        Math.cos(t * w.freq * 11.0 - phase * 1.3) * (w.amp * 0.35);

      const jitter = Math.sin(t * 95.0 + Math.floor(time * 10.0)) * 0.9;

      if (!penDown) {
        inkCtx.moveTo(px, baseY + waveY + jitter);
        penDown = true;
      } else {
        inkCtx.lineTo(px, baseY + waveY + jitter);
      }
    }

    inkCtx.strokeStyle = `rgba(222, 216, 204, ${w.alpha * 0.55})`;
    inkCtx.lineWidth = w.width;
    inkCtx.setLineDash([26, 8, 12, 6, 45, 10]);
    inkCtx.lineDashOffset = -time * (35 + i * 4);
    inkCtx.stroke();
  }
  inkCtx.restore();

  // C. White-Ink Sea Spray Droplets at Foreground Wave Crest & Ship's Plunging Bow
  inkCtx.save();
  for (let i = 0; i < sprayDrops.length; i++) {
    const d = sprayDrops[i];
    d.life += dt;
    if (d.life >= d.maxLife) {
      resetSprayDrop(d);
    }
    d.x += d.vx;
    d.y += d.vy;
    d.vy += d.gravity;

    const progress = d.life / d.maxLife;
    const alpha = Math.sin(progress * Math.PI) * 0.82;
    const px = d.x * width;
    const py = d.y * height;

    inkCtx.fillStyle = `rgba(232, 226, 214, ${alpha})`;
    inkCtx.beginPath();
    inkCtx.arc(px, py, d.size * (1 - progress * 0.3), 0, Math.PI * 2);
    inkCtx.fill();
  }
  inkCtx.restore();

  // D. Floating Glowing Embers Drifting from "The Black Dread"
  inkCtx.save();
  for (let i = 0; i < embers.length; i++) {
    const e = embers[i];
    e.x += e.vx + Math.sin(time * 2.2 + e.phase) * 0.00022;
    e.y += e.vy + Math.cos(time * 1.7 + e.phase) * 0.00015;

    if (e.y < 0.28 || e.x < 0.45) {
      e.x = 0.65 + Math.random() * 0.24;
      e.y = 0.60 + Math.random() * 0.16;
    }

    const pulse = 0.55 + 0.45 * Math.sin(time * 6.0 + e.phase);
    const ex = e.x * width;
    const ey = e.y * height;

    const grad = inkCtx.createRadialGradient(ex, ey, 0, ex, ey, e.size * 3.2);
    grad.addColorStop(0, `rgba(255, 215, 150, ${e.alpha * pulse})`);
    grad.addColorStop(0.4, `rgba(225, 118, 48, ${e.alpha * pulse * 0.75})`);
    grad.addColorStop(1, 'rgba(217, 119, 54, 0)');

    inkCtx.fillStyle = grad;
    inkCtx.beginPath();
    inkCtx.arc(ex, ey, e.size * 3.2, 0, Math.PI * 2);
    inkCtx.fill();
  }
  inkCtx.restore();
}

// ============================================================================
// 3. INTERACTIVITY & ANIMATION LOOP
// ============================================================================

const targetMouse = new THREE.Vector2(0.5, 0.5);
window.addEventListener('pointermove', (e) => {
  targetMouse.x = e.clientX / window.innerWidth;
  targetMouse.y = 1.0 - e.clientY / window.innerHeight;
});

const joinCrewBtn = document.getElementById('join-crew-btn');
if (joinCrewBtn) {
  joinCrewBtn.addEventListener('click', () => {
    const loreSection = document.getElementById('lore');
    if (loreSection) {
      loreSection.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

const clock = new THREE.Clock();
let prevTime = 0;

function animate() {
  requestAnimationFrame(animate);

  const elapsed = clock.getElapsedTime();
  const dt = Math.min(elapsed - prevTime, 0.05);
  prevTime = elapsed;

  uniforms.uTime.value = elapsed;
  uniforms.uMouse.value.lerp(targetMouse, 0.05);

  renderer.render(scene, camera);
  renderInkOverlay(elapsed, dt);
}

animate();
