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

// Vertex Shader: 3D Gerstner Ocean Undulation + Ship Heave/Pitch + Sail Billow
const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec2 uMouse;
  varying vec2 vUv;
  varying float vWaveElevation;

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Sea region (uv.y < 0.28): 3D rolling wave elevation
    float seaWeight = smoothstep(0.29, 0.02, uv.y);
    float wave1 = sin(uv.x * 18.0 + uTime * 2.1 + uv.y * 12.0) * 0.012;
    float wave2 = cos(uv.x * 32.0 - uTime * 1.6 + uv.y * 24.0) * 0.007;
    vWaveElevation = (wave1 + wave2) * seaWeight;

    pos.y += vWaveElevation;
    pos.z += vWaveElevation * 2.0;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

// Fragment Shader:
// - Live Sailing Ship (Rigid 3D Pitch/Roll/Heave + Billowing Cloth Sails + Whipping Flag)
// - Gloomy Dark Boiling Storm Clouds with Animated Ink Cross-Hatching & Distant Lightning
// - Live Flowing Ocean Swells with Procedural White-Ink Sketch Crests & Bow Wake
// - Exaggerated Sobel/DoG Ink Outlines & Multi-Angle Charcoal Cross-Hatching
const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uSceneTex;
  uniform sampler2D uMaskTex;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uMouse;
  uniform float uStormSurge;

  varying vec2 vUv;
  varying float vWaveElevation;

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
    // Slight 0.96 zoom so ship pitching/heaving never hits texture clamping edges
    scale *= 0.965;
    vec2 parallax = (uMouse - 0.5) * vec2(0.012, 0.008);
    return (uv - 0.5) * scale + 0.5 + parallax;
  }

  // --- Procedural Hand-Drawn Cross-Hatching Function ---
  float sketchHatch(vec2 uv, float lum, float timeJitter) {
    vec2 p = uv * vec2(uResolution.x, uResolution.y) * 0.72;
    // Slight hand-drawn organic waviness in pen lines
    float wobble = noise(p * 0.035 + timeJitter) * 2.4;

    // Primary diagonal hatch (+36 deg)
    float d1 = sin((p.x * 0.81 + p.y * 0.58 + wobble) * 1.35);
    float hatch1 = smoothstep(0.55, 0.88, d1);

    // Secondary cross-hatch (-42 deg)
    float d2 = sin((p.x * 0.74 - p.y * 0.67 - wobble) * 1.45);
    float hatch2 = smoothstep(0.62, 0.92, d2);

    // Fine charcoal grain
    float grain = noise(p * 0.45 + timeJitter * 2.0);

    float inkDarkness = 0.0;
    // Mid-tone hatching
    inkDarkness += (1.0 - smoothstep(0.18, 0.55, lum)) * hatch1 * 0.36;
    // Deep shadow cross-hatching
    inkDarkness += (1.0 - smoothstep(0.08, 0.34, lum)) * hatch2 * 0.42;
    // Charcoal paper tooth
    inkDarkness += (1.0 - grain) * 0.08;

    return clamp(inkDarkness, 0.0, 0.78);
  }

  // --- Deformed UV Computation for Ship Sailing, Sails Billowing, Clouds Boiling & Sea Flowing ---
  vec2 computeAnimatedUv(vec2 baseUv, out vec3 maskData, out float seaMask, out float cloudMask) {
    maskData = texture2D(uMaskTex, baseUv).rgb;
    float shipWeight = maskData.r;
    float sailWeight = maskData.g;

    // Waterline is around y = 0.255 in texture UV (where 0 = bottom, 1 = top)
    seaMask = smoothstep(0.275, 0.215, baseUv.y) * (1.0 - shipWeight * 0.65);
    cloudMask = smoothstep(0.27, 0.42, baseUv.y) * (1.0 - shipWeight * 0.85);

    vec2 uv = baseUv;

    // 1. SHIP SAILING MOTION (Pitching, Rolling, Heaving on Swells + Forward Surge)
    float surgeFreq = 1.35;
    float shipRockAngle = sin(uTime * surgeFreq) * 0.022 + cos(uTime * 0.82) * 0.009;
    float shipHeaveY = sin(uTime * surgeFreq - 0.9) * 0.0095 + cos(uTime * 2.1) * 0.003;
    float shipSurgeX = cos(uTime * 1.05) * 0.0055;

    // Pivot at the ship's hull waterline center (0.72, 0.23)
    vec2 pivot = vec2(0.72, 0.23);
    vec2 rel = uv - pivot;
    float c = cos(shipRockAngle * shipWeight);
    float s = sin(shipRockAngle * shipWeight);
    vec2 rotatedRel = mat2(c, -s, s, c) * rel;
    uv = pivot + rotatedRel;
    uv.y -= shipHeaveY * shipWeight;
    uv.x += shipSurgeX * shipWeight;

    // 2. BILLOWING SAILS & WHIPPING MAST PENNANT
    // Travelling wind wave across the tattered canvas sails (moving right-to-left with the wind)
    float sailWaveX = sin(baseUv.y * 28.0 - uTime * 4.4 + baseUv.x * 14.0) * 0.0052;
    float sailWaveY = cos(baseUv.x * 22.0 - uTime * 3.8 + baseUv.y * 12.0) * 0.0032;
    uv.x += sailWaveX * sailWeight;
    uv.y += sailWaveY * sailWeight;

    // Extra high-frequency whip for the skull-and-crossbones flag at the top of the mainmast (uv.y > 0.86)
    float flagZone = smoothstep(0.84, 0.94, baseUv.y) * shipWeight;
    uv.y += sin(baseUv.x * 65.0 - uTime * 11.0) * 0.0045 * flagZone;
    uv.x += cos(baseUv.y * 45.0 - uTime * 9.5) * 0.003 * flagZone;

    // 3. SKY & STORM CLOUD BOILING / DRIFTING ACTIVITY
    if (cloudMask > 0.001) {
      vec2 cloudNoiseUv = baseUv * vec2(5.5, 3.8) + vec2(uTime * 0.065, -uTime * 0.025);
      float cWarpX = (fbm(cloudNoiseUv) - 0.5) * 0.018;
      float cWarpY = (fbm(cloudNoiseUv + vec2(4.2, 1.9)) - 0.5) * 0.013;
      uv += vec2(cWarpX, cWarpY) * cloudMask;
    }

    // 4. REAL-TIME FLOWING OCEAN SWELLS & WAVE ADVECTION
    if (seaMask > 0.001) {
      // Perspective factor: closer to bottom (baseUv.y -> 0) moves faster and has larger amplitude
      float depthFactor = clamp((0.275 - baseUv.y) / 0.275, 0.0, 1.0);
      float persp = 0.25 + 1.35 * pow(depthFactor, 1.25);

      float swell1 = sin(baseUv.x * 22.0 + baseUv.y * 38.0 + uTime * 2.6);
      float swell2 = cos(baseUv.x * 36.0 - baseUv.y * 52.0 + uTime * 3.3);
      float chop = sin(baseUv.x * 70.0 + baseUv.y * 95.0 + uTime * 5.2) * 0.4;

      uv.x += (swell1 * 0.0075 + swell2 * 0.004) * persp * seaMask;
      uv.y += (swell2 * 0.0055 + chop * 0.003) * persp * seaMask;
    }

    return clamp(uv, 0.002, 0.998);
  }

  void main() {
    vec2 baseUv = getCoverUv(vUv, uResolution);

    vec3 maskData;
    float seaMask;
    float cloudMask;
    vec2 animUv = computeAnimatedUv(baseUv, maskData, seaMask, cloudMask);

    float shipWeight = maskData.r;
    float sailWeight = maskData.g;
    float lanternWeight = maskData.b;

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
      // Darken upper sky significantly so it feels oppressive, stormy, and abyssal
      float skyHeight = smoothstep(0.25, 0.92, baseUv.y);
      float gloomyFactor = mix(0.76, 0.42, pow(skyHeight, 0.85));
      color *= mix(1.0, gloomyFactor, cloudMask);

      // Live Procedural Boiling Charcoal Cloud Banks drifting across the sky
      vec2 driftUv1 = baseUv * vec2(3.6, 2.4) + vec2(uTime * 0.042, uTime * 0.012);
      vec2 driftUv2 = baseUv * vec2(7.2, 4.8) - vec2(uTime * 0.068, -uTime * 0.018);
      float cloudBillow = fbm(driftUv1 + fbm(driftUv2) * 0.65);

      // Compute cloud ridge contour lines (hand-sketched cloud puffs)
      float cloudContour = smoothstep(0.012, 0.032, abs(cloudBillow - 0.52));
      float darkInkContour = (1.0 - cloudContour) * smoothstep(0.35, 0.85, baseUv.y) * 0.55;

      // Subtle charcoal cloud light/shadow modulation
      vec3 stormTint = vec3(0.11, 0.13, 0.16) * smoothstep(0.38, 0.72, cloudBillow);
      color = mix(color, color * 0.68 + stormTint * 0.48, cloudMask * 0.65);
      color *= (1.0 - darkInkContour * cloudMask);

      // Occasional subtle distant storm lightning pulse inside the upper-right & center clouds
      float lightningCycle = sin(uTime * 0.9) * sin(uTime * 2.3 + 1.4);
      float lightningFlash = pow(max(0.0, lightningCycle), 14.0) * 0.28 + uStormSurge * 0.22;
      float cloudCore = smoothstep(0.45, 0.72, cloudBillow) * smoothstep(0.35, 0.82, baseUv.y);
      color += vec3(0.16, 0.19, 0.22) * lightningFlash * cloudCore * cloudMask;
    }

    // ========================================================================
    // B. LIVE FLOWING OCEAN WAVES WITH EXAGGERATED WHITE-INK SKETCH CRESTS
    // ========================================================================
    if (seaMask > 0.001) {
      float depth = clamp((0.275 - baseUv.y) / 0.275, 0.0, 1.0);
      // Perspective wave coordinates
      vec2 seaP = vec2(
        (baseUv.x - 0.5) / (0.18 + depth * 0.85),
        pow(depth, 0.65) * 14.0
      );

      // Multi-layered flowing wave ridges (moving from right-horizon toward foreground-left)
      float w1 = sin(seaP.x * 7.5 + seaP.y * 4.2 + uTime * 2.4 + fbm(seaP * 1.4 + uTime * 0.4) * 2.6);
      float w2 = sin(seaP.x * 13.0 - seaP.y * 6.5 + uTime * 3.1 + noise(seaP * 2.8) * 2.0);
      float w3 = cos(seaP.x * 24.0 + seaP.y * 11.0 + uTime * 3.9);

      // Crisp white-ink sketch contour lines along wave ridges
      float ridgeLine1 = smoothstep(0.84, 0.96, w1) * smoothstep(0.04, 0.35, depth);
      float ridgeLine2 = smoothstep(0.88, 0.98, w2) * smoothstep(0.08, 0.65, depth) * 0.7;
      // Woodcut parallel trough engraving lines
      float woodcutTrough = smoothstep(0.4, 0.85, sin(seaP.y * 28.0 + w1 * 3.5 + uTime * 2.4));

      // Deepen dark wave troughs
      float troughShadow = smoothstep(0.2, -0.7, w1) * 0.38;
      color *= (1.0 - troughShadow * seaMask);
      color *= (1.0 - (1.0 - woodcutTrough) * 0.22 * seaMask);

      // Add bone-white ink sketch wave highlights
      vec3 inkWhite = vec3(0.84, 0.82, 0.77);
      float sketchCrest = (ridgeLine1 * 0.42 + ridgeLine2 * 0.28) * (0.4 + 0.6 * noise( baseUv * 90.0 + uTime ));
      color = mix(color, inkWhite, clamp(sketchCrest * seaMask, 0.0, 0.65));

      // Churning White-Ink Bow Wake where the ship's hull cuts the water
      vec2 bowCenter = vec2(0.64, 0.165);
      float bowDist = length((baseUv - bowCenter) * vec2(1.4, 3.8));
      float bowFoam = smoothstep(0.24, 0.02, bowDist) *
        smoothstep(0.35, 0.85, fbm(baseUv * vec2(45.0, 85.0) + vec2(uTime * 3.2, -uTime * 1.8)));
      color = mix(color, inkWhite, bowFoam * seaMask * 0.62);

      // Warm flickering lantern reflection on the water below the ship's stern
      vec2 sternWater = vec2(0.81, 0.14);
      float sternDist = length((baseUv - sternWater) * vec2(1.8, 3.2));
      float waterShimmer = smoothstep(0.5, 0.9, sin(baseUv.y * 180.0 + uTime * 6.0 + w1 * 4.0));
      float lanternRefl = smoothstep(0.22, 0.0, sternDist) * waterShimmer * 0.35;
      color += vec3(0.85, 0.42, 0.14) * lanternRefl * seaMask;
    }

    // ========================================================================
    // C. WARM FLICKERING CABIN LANTERNS & SAILS SHADING
    // ========================================================================
    if (shipWeight > 0.01) {
      // Dynamic shadow ripple on billowing sails
      float sailRippleLight = sin(baseUv.y * 28.0 - uTime * 4.4 + baseUv.x * 14.0) * 0.09 * sailWeight;
      color += vec3(sailRippleLight * 0.85, sailRippleLight * 0.78, sailRippleLight * 0.65);

      // Flickering warm firelight in the cabin windows & hull lanterns
      float flicker = 0.85 + 0.35 * sin(uTime * 7.5) * cos(uTime * 13.2 + 0.7);
      color += vec3(0.95, 0.48, 0.15) * lanternWeight * flicker * 0.55;
    }

    // ========================================================================
    // D. EXAGGERATED HAND-SKETCHED INK OUTLINES & CROSS-HATCHING PASS
    // ========================================================================
    float finalLum = dot(color, vec3(0.299, 0.587, 0.114));

    // 1. Exaggerated Dark Ink Pen Outlines (Sobel + Laplacian)
    float darkInkEdge = smoothstep(0.035, 0.16, edgeMag) * smoothstep(-0.005, 0.04, laplacian + 0.02);
    color *= (1.0 - darkInkEdge * 0.62);

    // 2. Exaggerated White-Ink Chalk/Etching Highlights on Wave Crests & Sails
    float whiteChalkEdge = smoothstep(0.05, 0.20, edgeMag) * smoothstep(0.01, 0.06, -laplacian) * smoothstep(0.32, 0.75, finalLum);
    color = mix(color, vec3(0.88, 0.85, 0.79), whiteChalkEdge * 0.45);

    // 3. Multi-Angle Charcoal Cross-Hatching Overlay
    // Subtle 12fps-style boiling jitter for authentic living sketch feel
    float sketchTimeStep = floor(uTime * 10.0) * 0.1;
    float hatchStrength = sketchHatch(animUv, finalLum, sketchTimeStep);
    color *= (1.0 - hatchStrength * 0.38);

    // Subtle high-contrast filmic etching curve
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
  uStormSurge: { value: 0.0 },
};

const geometry = new THREE.PlaneGeometry(2, 2, 160, 100);
const material = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms,
});

const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

// ============================================================================
// 2. LIVE 2D HAND-SKETCHED OVERLAY ENGINE
//    - Flowing White-Ink Wave Crests & Curling Foreground Wave Spray
//    - Boiling Sky Charcoal Cross-Hatching & Diagonal Storm Rain Streaks
//    - Floating Glowing Embers Drifting from the Ship's Hull
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

// --- Particle Systems for Live Sketch Atmosphere ---

// 1. Floating Warm Embers around the Ship (x: 0.58..0.92, y: 0.45..0.82)
const EMBER_COUNT = 42;
const embers = Array.from({ length: EMBER_COUNT }, () => ({
  x: 0.62 + Math.random() * 0.28,
  y: 0.52 + Math.random() * 0.28,
  vx: -(0.00025 + Math.random() * 0.00055),
  vy: -(0.0003 + Math.random() * 0.0006),
  size: 1.2 + Math.random() * 2.4,
  alpha: 0.3 + Math.random() * 0.7,
  phase: Math.random() * Math.PI * 2,
}));

// 2. White-Ink Sea Spray Droplets bursting from the Curling Wave (bottom-left) & Ship's Bow
const SPRAY_COUNT = 55;
const sprayDrops = Array.from({ length: SPRAY_COUNT }, (_, i) => {
  const isBow = i % 3 === 0;
  return {
    isBow,
    originX: isBow ? 0.62 + Math.random() * 0.09 : 0.14 + Math.random() * 0.14,
    originY: isBow ? 0.81 + Math.random() * 0.04 : 0.82 + Math.random() * 0.08,
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
  const depthT = idx / 17; // 0 near horizon, 1 at bottom foreground
  return {
    yBase: 0.755 + Math.pow(depthT, 1.35) * 0.23,
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
  inkCtx.save();
  for (let i = 0; i < WAVE_RIBBONS.length; i++) {
    const w = WAVE_RIBBONS[i];
    const baseY = w.yBase * height;
    const phase = time * w.speed * 12.0 + w.offset;

    inkCtx.beginPath();
    const steps = 42;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = t * width;
      // Add organic curling peaks (especially on the bottom-left around t = 0.15..0.28)
      const heroCrestBoost =
        Math.exp(-Math.pow((t - 0.21) / 0.08, 2)) *
        Math.smoothstep
          ? 1.0
          : Math.exp(-Math.pow((t - 0.21) / 0.085, 2)) * 1.85;

      const waveY =
        Math.sin(t * w.freq * Math.PI * 2 + phase) * w.amp * (1 + heroCrestBoost * 0.45) +
        Math.cos(t * w.freq * 11.0 - phase * 1.3) * (w.amp * 0.35);

      // Sketchy hand-jitter
      const jitter = Math.sin(t * 95.0 + Math.floor(time * 10.0)) * 0.9;

      if (s === 0) {
        inkCtx.moveTo(px, baseY + waveY + jitter);
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
      e.y = 0.62 + Math.random() * 0.18;
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

let stormSurgeTarget = 0.0;
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

  stormSurgeTarget = Math.max(0.0, stormSurgeTarget - dt * 0.6);
  uniforms.uStormSurge.value += (stormSurgeTarget - uniforms.uStormSurge.value) * 0.08;

  renderer.render(scene, camera);
  renderInkOverlay(elapsed, dt);
}

animate();
