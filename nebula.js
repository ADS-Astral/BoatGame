import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";

const loadingEl = document.getElementById("loading");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ReinhardToneMapping;
renderer.toneMappingExposure = 1.5;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(12, 8, 16);
const listener = new THREE.AudioListener();
camera.add(listener);
const audioLoader = new THREE.AudioLoader();
const bgSound = new THREE.Audio(listener);
const openingSound = new THREE.Audio(listener);
let openingPlayed = false;
let openingFinished = false;
const alarmSound = new THREE.Audio(listener);
const haulSounds = {
  success: new THREE.Audio(listener),
  oceanPerch: new THREE.Audio(listener),
  wrong: new THREE.Audio(listener),
};
const mosaRoar = new THREE.PositionalAudio(listener);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.update();

const hemiLight = new THREE.HemisphereLight(0xcfe8ff, 0x32394b, 1.1);
scene.add(hemiLight);

const textureLoader = new THREE.TextureLoader();
const diffuse = textureLoader.load("Water_Diffuse.jpg", (tex) => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(100, 100);
});
const normal = textureLoader.load("Water_Normal.jpg", (tex) => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(100, 100);
});
const crestTex = textureLoader.load("Crest_Material.png", (tex) => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
});
const calmMaterials = [];
const splashState = {
  mesh: null,
  particles: [],
  poolSize: 20,
  cooldown: 0,
};
const splashGravity = -18;

const maxRogueWaves = 3;
const waveConfig = {
  ampMin: 10,
  ampMax: 80,
  speedMin: 18,
  speedMax: 42,
  sigmaAlong: 35,
  sigmaAcross: 110,
  spawnDistance: 900,
  travelMax: 2200,
  respawnDelay: [1.5, 4], // seconds between waves per slot
};
const waves = Array.from({ length: maxRogueWaves }, () => ({
  amplitude: 0,
  sigmaAlong: waveConfig.sigmaAlong,
  sigmaAcross: waveConfig.sigmaAcross,
  speed: 0,
  dir: new THREE.Vector2(),
  center: new THREE.Vector2(),
  traveled: 0,
  active: false,
  cooldown: 0,
}));

const gerstnerWaves = [
  { dir: new THREE.Vector2(1, 0), amp: 1.6, len: 120, speed: 1.5, steep: 0.45 },
  { dir: new THREE.Vector2(0.3, 1).normalize(), amp: 1.2, len: 90, speed: 1.7, steep: 0.4 },
  { dir: new THREE.Vector2(-0.8, 0.6).normalize(), amp: 0.9, len: 60, speed: 2.2, steep: 0.35 },
];
const gerstnerMaxAmp = Math.max(...gerstnerWaves.map((w) => w.amp));
const mothershipState = { object: null, yaw: 0, smoothY: 0 };
const sharkState = {
  object: null,
  mixer: null,
  action: null,
  yaw: 0,
  modelYawOffset: -Math.PI / 2,
  speed: 8,
  wanderTimer: 0,
  sprinting: false,
};
const sharkNetChaseRadius = 220;
const sharkSprintSpeed = 18;
const mosasaurState = {
  object: null,
  mixer: null,
  action: null,
  yaw: 0,
  modelYawOffset: -Math.PI / 2,
  speed: 30,
  active: false,
  spawnTimer: 8,
  phase: "hidden", // hidden | swim | jump | dive
  jumpTimer: 0,
  jumpDuration: 2.4,
  jumpHeight: 30,
  diveTimer: 0,
  inScene: false,
  waveRef: null,
  boundsDepth: 10,
  jumpVel: new THREE.Vector3(),
  jumpGravity: -30,
};

const groundBaseHeight = -0.01;
const groundSize = 2000;
const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize, 200, 200);
const groundMaterial = new THREE.MeshStandardMaterial({
  map: diffuse,
  normalMap: normal,
  roughness: 0.5,
  metalness: 0.05,
  transparent: true,
  opacity: 1,
});
applyGerstnerWaves(groundMaterial);
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.position.y = groundBaseHeight;
ground.receiveShadow = true;
scene.add(ground);
initSplashSystem();
// surround center with calm wave tiles
const calmGeometry = new THREE.PlaneGeometry(groundSize, groundSize, 100, 100);
function makeCalmMaterial() {
  const m = new THREE.MeshStandardMaterial({
    map: diffuse,
    normalMap: normal,
    roughness: 0.5,
    metalness: 0.05,
    transparent: true,
    opacity: 1,
  });
  applyCalmWaves(m);
  calmMaterials.push(m);
  return m;
}
for (let ix = -1; ix <= 1; ix++) {
  for (let iz = -1; iz <= 1; iz++) {
    if (ix === 0 && iz === 0) continue;
    const calmMesh = new THREE.Mesh(calmGeometry, makeCalmMaterial());
    calmMesh.rotation.x = -Math.PI / 2;
    calmMesh.position.set(ix * groundSize, groundBaseHeight, iz * groundSize);
    calmMesh.receiveShadow = true;
    scene.add(calmMesh);
  }
}

const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

new RGBELoader().load(
  "HDRI_Sky_16k.hdr",
  (hdr) => {
    const envMap = pmremGenerator.fromEquirectangular(hdr).texture;
    scene.environment = envMap;
    scene.background = envMap;
    hdr.dispose();
    pmremGenerator.dispose();
  },
  undefined,
  (err) => {
    console.error("Failed to load HDR:", err);
  }
);

function initSplashSystem() {
  const geo = new THREE.SphereGeometry(0.15, 6, 6);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.9,
    roughness: 0.2,
    metalness: 0,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    depthTest: false,
  });
  splashState.mesh = new THREE.InstancedMesh(geo, mat, splashState.poolSize);
  splashState.mesh.renderOrder = 999;
  splashState.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  splashState.particles = Array.from({ length: splashState.poolSize }, () => ({
    active: false,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    life: 0,
    ttl: 0,
  }));
  scene.add(splashState.mesh);
  for (let i = 0; i < splashState.poolSize; i++) {
    const m = new THREE.Matrix4();
    m.makeScale(0, 0, 0);
    splashState.mesh.setMatrixAt(i, m);
  }
  splashState.mesh.instanceMatrix.needsUpdate = true;
}

// load ambient wind
audioLoader.load(
  "wind_BG_Sound.mp3",
  (buffer) => {
    bgSound.setBuffer(buffer);
    bgSound.setLoop(true);
    bgSound.setVolume(0.4);
    bgSound.play();
  },
  undefined,
  (err) => console.warn("Failed to load wind_BG_Sound.mp3", err)
);
// load opening message (play after 5s)
audioLoader.load(
  "Opening_Message.mp3",
  (buffer) => {
    openingSound.setBuffer(buffer);
    openingSound.setLoop(false);
    openingSound.setVolume(0.7);
    const durationMs = (buffer.duration || 0) * 1000;
    setTimeout(() => {
      if (!gameOver && !openingPlayed) {
        openingPlayed = true;
        openingSound.play();
        if (openingSound.source) {
          openingSound.source.onended = () => markOpeningFinished();
        }
        if (durationMs > 0) {
          setTimeout(() => markOpeningFinished(), durationMs + 100);
        }
      } else if (!openingFinished) {
        markOpeningFinished();
      }
    }, 5000);
  },
  undefined,
  (err) => {
    console.warn("Failed to load Opening_Message.mp3", err);
    markOpeningFinished();
  }
);
audioLoader.load(
  "completehaul100.mp3",
  (buffer) => {
    haulSounds.success.setBuffer(buffer);
    haulSounds.success.setLoop(false);
  },
  undefined,
  (err) => console.warn("Failed to load completehaul100.mp3", err)
);
audioLoader.load(
  "completehaulOP.mp3",
  (buffer) => {
    haulSounds.oceanPerch.setBuffer(buffer);
    haulSounds.oceanPerch.setLoop(false);
  },
  undefined,
  (err) => console.warn("Failed to load completehaulOP.mp3", err)
);
audioLoader.load(
  "completehaulwrong.mp3",
  (buffer) => {
    haulSounds.wrong.setBuffer(buffer);
    haulSounds.wrong.setLoop(false);
  },
  undefined,
  (err) => console.warn("Failed to load completehaulwrong.mp3", err)
);
audioLoader.load(
  "alarm1.mp3",
  (buffer) => {
    alarmSound.setBuffer(buffer);
    alarmSound.setLoop(true);
    alarmSound.setVolume(0);
    alarmSound.play();
  },
  undefined,
  (err) => console.warn("Failed to load alarm1.mp3", err)
);
audioLoader.load(
  "mosaRoar.mp3",
  (buffer) => {
    mosaRoar.setBuffer(buffer);
    mosaRoar.setLoop(false);
    mosaRoar.setVolume(0);
  },
  undefined,
  (err) => console.warn("Failed to load mosaRoar.mp3", err)
);

const controlModes = { CAR: "car", SPECTATOR: "spectator" };
let controlMode = controlModes.CAR;

const vehicle = {
  object: null,
  velocity: 0,
  yaw: 0,
  maxSpeed: 32,
  accel: 18,
  brake: 14,
  drag: 4.5,
  steerRate: 1.8,
  vy: 0,
  pitch: 0,
  roll: 0,
  airborne: false,
  driftVel: 0,
  driftScale: 14,
  driftDamp: 6,
  driftMax: 10,
  turboMaxMult: 1.6,
  turboAccelMult: 1.4,
  onWave: false,
  surfaceHeight: 0,
  surfaceGradX: 0,
  surfaceGradZ: 0,
};

const netState = {
  anchor: null,
  active: false,
  phase: "idle", // idle | drop | fill | rise
  progress: 0,
  duration: 7,
  dropTime: 1.5,
  riseTime: 1.2,
  elapsed: 0,
  maxTons: 12,
  targetTons: 12,
  currentTons: 0,
  mesh: null,
  rope: null,
  anchorPos: new THREE.Vector3(),
  targetPos: new THREE.Vector3(),
  startPos: new THREE.Vector3(),
  endPos: new THREE.Vector3(),
  sizeScale: 1,
  catchSpecies: null,
};

const netAssets = {
  coneGeo: new THREE.ConeGeometry(0.45, 0.9, 14),
  sphereGeo: new THREE.SphereGeometry(0.6, 16, 12),
  ropeGeo: new THREE.CylinderGeometry(0.03, 0.03, 1, 6),
  netMat: new THREE.MeshStandardMaterial({
    color: 0xf5d487,
    transparent: true,
    opacity: 0.9,
    roughness: 0.4,
    metalness: 0.05,
  }),
  ropeMat: new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.8,
    metalness: 0.05,
  }),
};

const followCamera = {
  distance: 12,
  height: 5,
  lookAhead: 6,
  stiffness: 6,
};

const gltfLoader = new GLTFLoader();
gltfLoader.setPath("./");
gltfLoader.setCrossOrigin("anonymous");
gltfLoader.load(
  "boat.glb",
  (gltf) => {
    gltf.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    gltf.scene.position.set(0, 0, 0);
    gltf.scene.scale.setScalar(0.75);
    gltf.scene.rotation.y = Math.PI / 2;
    vehicle.object = gltf.scene;
    vehicle.yaw = gltf.scene.rotation.y;
    scene.add(gltf.scene);
    controls.target.copy(gltf.scene.position);
    netState.anchor =
      gltf.scene.getObjectByName("NetAnchor") ||
      gltf.scene.children.find((c) => c.name && c.name.toLowerCase().includes("netanchor")) ||
      gltf.scene;
    if (!netState.anchor || netState.anchor === gltf.scene) {
      console.warn("NetAnchor not found in boat.glb; defaulting to boat root.");
    }
    initNetRig();

    loadingEl.textContent = "Car mode (H to toggle)";
  },
  (event) => {
    if (event.total > 0) {
      const pct = ((event.loaded / event.total) * 100).toFixed(0);
      loadingEl.textContent = `Loading boat ${pct}%`;
    } else {
      loadingEl.textContent = "Loading boat...";
    }
  },
  (error) => {
    loadingEl.textContent = "Failed to load boat.glb";
    console.error("GLTF load error", error);
  }
);

gltfLoader.load(
  "mothership.glb",
  (gltf) => {
    mothershipState.object = gltf.scene;
    mothershipState.object.scale.setScalar(100);
    mothershipState.object.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    const pos = randomEdgePosition();
    mothershipState.object.position.copy(pos);
    mothershipState.yaw = Math.random() * Math.PI * 2;
    mothershipState.object.rotation.y = mothershipState.yaw;
    scene.add(mothershipState.object);
    const h = groundBaseHeight + sampleWave(pos.x, pos.z).height + sampleGerstner(pos.x, pos.z, 0).height;
    mothershipState.object.position.y = h;
    mothershipState.smoothY = h;
  },
  undefined,
  (err) => console.error("Failed to load mothership.glb", err)
);

gltfLoader.load(
  "shark.glb",
  (gltf) => {
    sharkState.object = gltf.scene;
    sharkState.object.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    sharkState.object.position.set(20, 0, -15);
    sharkState.object.scale.setScalar(6);
    sharkState.yaw = 0;
    sharkState.object.rotation.y = sharkState.yaw + sharkState.modelYawOffset;
    scene.add(sharkState.object);

    sharkState.mixer = new THREE.AnimationMixer(gltf.scene);
    mixers.push(sharkState.mixer);
    if (gltf.animations.length > 0) {
      sharkState.action = sharkState.mixer.clipAction(
        gltf.animations.find((a) => a.name.toLowerCase().includes("take")) ||
          gltf.animations[0]
      );
      sharkState.action.play();
    }
  },
  undefined,
  (err) => console.error("Failed to load shark.glb", err)
);

gltfLoader.load(
  "mosasaurus.glb",
  (gltf) => {
    mosasaurState.object = gltf.scene;
    mosasaurState.object.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    mosasaurState.object.scale.setScalar(1);
    const box = new THREE.Box3().setFromObject(mosasaurState.object);
    const size = new THREE.Vector3();
    box.getSize(size);
    mosasaurState.boundsDepth = size.z || mosasaurState.boundsDepth;
    if (mosaRoar) {
      mosasaurState.object.add(mosaRoar);
      mosaRoar.setRefDistance(25);
      mosaRoar.setMaxDistance(groundSize * 0.6);
      mosaRoar.setDistanceModel("linear");
    }
    mosasaurState.yaw = 0;
    mosasaurState.object.rotation.y = mosasaurState.yaw + mosasaurState.modelYawOffset;
    mosasaurState.object.visible = false;
    scene.add(mosasaurState.object);

    mosasaurState.mixer = new THREE.AnimationMixer(gltf.scene);
    mixers.push(mosasaurState.mixer);
    if (gltf.animations.length > 0) {
      mosasaurState.action = mosasaurState.mixer.clipAction(
        gltf.animations.find((a) => a.name.toLowerCase().includes("swim")) || gltf.animations[0]
      );
      mosasaurState.action.play();
    }
  },
  undefined,
  (err) => console.error("Failed to load mosasaurus.glb", err)
);

const moveState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  flip: false,
  somersault: false,
  turbo: false,
  netDeploy: false,
  netDrop: false,
};
const spectatorSpeed = 12;
const worldUp = new THREE.Vector3(0, 1, 0);

const cameraDir = new THREE.Vector3();
const strafeDir = new THREE.Vector3();
const moveDelta = new THREE.Vector3();
const tmpForward = new THREE.Vector3();
const camDesired = new THREE.Vector3();
const camLook = new THREE.Vector3();
const tmpNetDir = new THREE.Vector3();
const tmpNetMid = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpMat4 = new THREE.Matrix4();
const tmpVecA = new THREE.Vector3();
const tmpQuatIdentity = new THREE.Quaternion();
const tmpVecB = new THREE.Vector3();
let lastTime = performance.now();
let shaderTime = 0;
const boatHeightDamp = 8;
const boatSurfaceSmooth = 6;
const hudEl = document.getElementById("hud");
const hudValue = hudEl?.querySelector(".value");
const minimapCanvas = document.getElementById("minimap-canvas");
const minimapCtx = minimapCanvas?.getContext("2d") || null;
const minimapRange = 800;
const netBar = document.getElementById("netbar");
const netBarFill = netBar?.querySelector(".fill");
const netBarTons = netBar?.querySelector(".tons");
const netBarTotal = netBar?.querySelector(".total");
const fishDisplay = document.createElement("div");
const sectionOverlay = document.createElement("div");
fishDisplay.id = "fish-display";
Object.assign(fishDisplay.style, {
  position: "fixed",
  top: "12px",
  right: "12px",
  width: "100px",
  height: "100px",
  background: "rgba(0,0,0,0.55)",
  borderRadius: "12px",
  overflow: "hidden",
  border: "1px solid rgba(255,255,255,0.12)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
  display: "none",
  alignItems: "center",
  justifyContent: "center",
  padding: "6px",
  boxSizing: "border-box",
  pointerEvents: "none",
});
Object.assign(sectionOverlay.style, {
  position: "fixed",
  top: "12px",
  left: "12px",
  padding: "8px 12px",
  background: "rgba(0,0,0,0.65)",
  borderRadius: "10px",
  color: "#e6edf3",
  fontSize: "13px",
  border: "1px solid rgba(255,255,255,0.1)",
  boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
  pointerEvents: "none",
});
const fishImg = document.createElement("img");
fishImg.style.width = "100%";
fishImg.style.height = "100%";
fishImg.style.objectFit = "contain";
fishDisplay.appendChild(fishImg);
document.body.appendChild(fishDisplay);
document.body.appendChild(sectionOverlay);
const fishSpecies = [
  { name: "Shrimp", image: "ShrimpImage.png", sound: "Shrimp.mp3" },
  { name: "Tuna", image: "TunaImage.png", sound: "Tuna.mp3" },
  { name: "Ocean Perch", image: "OceanPerchImage.png", sound: "Snapper.mp3" },
  { name: "Mackerel", image: "MackerelImage.png", sound: "Mackerel.mp3" },
  { name: "Salmon", image: "SalmonImage.png", sound: "Salmon.mp3" },
  { name: "Snapper", image: "SnapperImage.png", sound: "Snapper.mp3" },
];
const fishAudioBuffers = new Map();
const speciesTotals = Object.fromEntries(fishSpecies.map((f) => [f.name, 0]));
const cargoTotals = Object.fromEntries(fishSpecies.map((f) => [f.name, 0]));
let cashTotal = 0;
const gridDivisions = 4;
const fishGrid = Array(gridDivisions * gridDivisions).fill(null);
let activeFishSound = null;
let pendingFish = null;
let targetFish = null;
const mothershipDockRange = 25;
function selectRandomFish() {
  const idx = Math.floor(Math.random() * fishSpecies.length);
  return fishSpecies[idx];
}
function showFishCatch(fish) {
  if (!fish) return;
  fishImg.src = fish.image;
  fishImg.alt = fish.name;
  fishDisplay.style.display = "flex";
  playFishSound(fish);
}
function hideFishCatch() {
  fishDisplay.style.display = "none";
}
function queueFishReveal(fish) {
  pendingFish = fish || null;
  tryShowPendingFish();
}
function tryShowPendingFish() {
  if (!openingFinished || !pendingFish) return;
  showFishCatch(pendingFish);
  pendingFish = null;
}

function applyGrittyHudFont() {
  const font = `"Impact","Haettenschweiler","Arial Black","Franklin Gothic Medium",sans-serif`;
  document.body.style.fontFamily = font;
  const hudElems = [
    document.getElementById("hud"),
    document.getElementById("status"),
    document.getElementById("controls-panel"),
    document.getElementById("netbar"),
    document.getElementById("minimap"),
  ];
  hudElems.forEach((el) => {
    if (el) {
      el.style.fontFamily = font;
      el.style.letterSpacing = "0.5px";
    }
  });
}
function playFishSound(fish) {
  const key = fish.sound;
  const buffer = fishAudioBuffers.get(key);
  const playBuffer = (buf) => {
    if (activeFishSound && activeFishSound.isPlaying) {
      activeFishSound.stop();
    }
    const fishSound = new THREE.Audio(listener);
    fishSound.setBuffer(buf);
    fishSound.setVolume(0.7);
    fishSound.setLoop(false);
    fishSound.onEnded = () => {
      if (activeFishSound === fishSound) activeFishSound = null;
    };
    fishSound.play();
    activeFishSound = fishSound;
  };
  if (buffer) {
    playBuffer(buffer);
    return;
  }
  audioLoader.load(
    key,
    (buf) => {
      fishAudioBuffers.set(key, buf);
      playBuffer(buf);
    },
    undefined,
  (err) => console.warn(`Failed to load fish sound ${key}`, err)
  );
}
function resetCargoTotals() {
  Object.keys(cargoTotals).forEach((k) => (cargoTotals[k] = 0));
}
function getCargoWeight() {
  return Object.values(cargoTotals).reduce((a, b) => a + b, 0);
}
function playHaulComplete(kind, onEnd) {
  const snd = haulSounds[kind];
  if (!snd || !snd.buffer) {
    onEnd && onEnd();
    return;
  }
  if (snd.isPlaying) snd.stop();
  snd.setLoop(false);
  snd.setVolume(1);
  snd.play();
  const source = snd.source;
  if (source) {
    source.onended = () => onEnd && onEnd();
  } else if (snd.buffer) {
    setTimeout(() => onEnd && onEnd(), (snd.buffer.duration || 0) * 1000 + 100);
  } else {
    onEnd && onEnd();
  }
}
function computePayout() {
  let payout = 0;
  const targetName = targetFish?.name || null;
  for (const [name, tons] of Object.entries(cargoTotals)) {
    if (!tons) continue;
    let rate = 1.2;
    if (targetName && name === targetName) {
      rate = 6;
    } else if (
      targetName &&
      ((targetName === "Snapper" && name === "Ocean Perch") ||
        (targetName === "Ocean Perch" && name === "Snapper"))
    ) {
      rate = 3.5;
    }
    payout += rate * tons;
  }
  return payout;
}
function initFishGrid() {
  const choices = [...fishSpecies, null]; // null means no fish
  let hasFish = false;
  while (!hasFish) {
    for (let i = 0; i < fishGrid.length; i++) {
      const pick = choices[Math.floor(Math.random() * choices.length)];
      fishGrid[i] = pick;
    }
    hasFish = fishGrid.some((f) => f);
  }
}
function getSectionIndex(x, z) {
  const half = groundSize * 0.5;
  if (Math.abs(x) > half || Math.abs(z) > half) return null;
  const cell = groundSize / gridDivisions;
  const ix = THREE.MathUtils.clamp(Math.floor((x + half) / cell), 0, gridDivisions - 1);
  const iz = THREE.MathUtils.clamp(Math.floor((z + half) / cell), 0, gridDivisions - 1);
  return iz * gridDivisions + ix;
}
function getFishForPosition(x, z) {
  const idx = getSectionIndex(x, z);
  if (idx === null) return null;
  return fishGrid[idx];
}
function refreshSectionOverlay() {
  const pos = vehicle.object ? vehicle.object.position : camera.position;
  const idx = getSectionIndex(pos.x, pos.z);
  const cargo = getCargoWeight();
  if (idx === null) {
    sectionOverlay.textContent = `Target: ${targetFish ? targetFish.name : "--"} | Outside fishing area | Cargo: ${cargo.toFixed(1)} t | Cash: $${cashTotal.toFixed(2)}`;
    return;
  }
  const fish = fishGrid[idx];
  const row = Math.floor(idx / gridDivisions) + 1;
  const col = (idx % gridDivisions) + 1;
  const caught = fish && speciesTotals[fish.name] ? speciesTotals[fish.name] : 0;
  sectionOverlay.textContent = `Target: ${targetFish ? targetFish.name : "--"} | Zone ${row}-${col}: ${fish ? fish.name : "No fish"}${fish ? ` | Caught: ${caught.toFixed(1)} t` : ""} | Cargo: ${cargo.toFixed(1)} t | Cash: $${cashTotal.toFixed(2)}`;
}
function pickTargetFishFromGrid() {
  const available = fishGrid.filter((f) => f);
  if (available.length === 0) return selectRandomFish();
  return available[Math.floor(Math.random() * available.length)];
}
function setNewTargetFish() {
  targetFish = pickTargetFishFromGrid();
  queueFishReveal(targetFish);
  refreshSectionOverlay();
}
initFishGrid();
setNewTargetFish();
refreshSectionOverlay();
let netBarVisible = false;
let totalTons = 0;
let gameOver = false;
let sinkTimer = 0;
let sinkMode = "none"; // none | rogue | overload
const mixers = [];
const controlsPanel = document.getElementById("controls-panel");
const touchControls = document.getElementById("touch-controls");
const joystick = document.getElementById("joystick");
const joystickStick = joystick?.querySelector(".stick");
const btnTurbo = document.getElementById("btn-turbo");
const btnNet = document.getElementById("btn-net");
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  navigator.userAgent
);
const statusHaul = document.getElementById("status-haul");
if (isMobile) {
  setupTouchControls();
  statusHaul && (document.getElementById("status-hint").textContent = "Use joystick + buttons");
}

applyGrittyHudFont();

controls.enabled = controlMode === controlModes.SPECTATOR;

function setKeyState(code, isDown) {
  switch (code) {
    case "KeyW":
    case "ArrowUp":
      moveState.forward = isDown;
      break;
    case "KeyS":
    case "ArrowDown":
      moveState.back = isDown;
      break;
    case "KeyA":
    case "ArrowLeft":
      moveState.left = isDown;
      break;
    case "KeyD":
    case "ArrowRight":
      moveState.right = isDown;
      break;
    case "KeyR":
      moveState.flip = isDown;
      break;
    case "KeyE":
      moveState.somersault = isDown;
      break;
    case "KeyF":
      moveState.netDeploy = isDown;
      if (isDown && !isMobile) handleNetAction();
      break;
    case "KeyG":
      moveState.netDrop = isDown;
      if (isDown && !isMobile) dropNetToBottom();
      break;
    case "KeyL":
      if (isDown && !isMobile) unloadAtMothership();
      break;
    case "ShiftLeft":
    case "ShiftRight":
      moveState.turbo = isDown;
      break;
    default:
      break;
  }
}

function toggleMode() {
  controlMode =
    controlMode === controlModes.CAR ? controlModes.SPECTATOR : controlModes.CAR;
  controls.enabled = controlMode === controlModes.SPECTATOR;
  if (vehicle.object && controlMode === controlModes.SPECTATOR) {
    controls.target.copy(vehicle.object.position);
  }
  loadingEl.textContent =
    controlMode === controlModes.CAR
      ? "Car mode (H to toggle)"
      : "Spectator mode (H to toggle)";
}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyH" && !e.repeat) {
    toggleMode();
    return;
  }
  if (e.code === "KeyK" && !e.repeat) {
    toggleControlsPanel();
    return;
  }
  if (e.code === "KeyF" && !e.repeat && !isMobile) {
    handleNetAction();
    return;
  }
  setKeyState(e.code, true);
});
window.addEventListener("keyup", (e) => {
  if (e.code === "KeyH") return;
  setKeyState(e.code, false);
});

function updateCar(dt) {
  if (!vehicle.object) return;

  const steerInput = (moveState.left ? 1 : 0) + (moveState.right ? -1 : 0);
  const accelInput = (moveState.forward ? 1 : 0) + (moveState.back ? -1 : 0);
  const netLoad = netState.active ? netState.progress : 0;
  const netSlow = netState.active ? THREE.MathUtils.lerp(1, 0.25, netLoad) : 1;
  const weightSlow = Math.max(0.5, 1 - totalTons / 120);
  const maxSpeed =
    vehicle.maxSpeed *
    (moveState.turbo ? vehicle.turboMaxMult : 1) *
    netSlow *
    weightSlow;

  if (accelInput !== 0) {
    let accelRate = accelInput > 0 ? vehicle.accel : vehicle.brake;
    if (accelInput > 0 && moveState.turbo) accelRate *= vehicle.turboAccelMult;
    vehicle.velocity += accelInput * accelRate * dt;
  } else {
    const drag = Math.sign(vehicle.velocity) * vehicle.drag * dt;
    if (Math.abs(vehicle.velocity) > Math.abs(drag)) {
      vehicle.velocity -= drag;
    } else {
      vehicle.velocity = 0;
    }
  }

  vehicle.velocity = THREE.MathUtils.clamp(vehicle.velocity, -maxSpeed * 0.4, maxSpeed);

  const speedFactor = THREE.MathUtils.clamp(
    Math.abs(vehicle.velocity) / maxSpeed,
    0,
    1
  );
  vehicle.yaw +=
    steerInput * vehicle.steerRate * speedFactor * dt * Math.sign(vehicle.velocity || 1);

  tmpForward.set(Math.sin(vehicle.yaw), 0, Math.cos(vehicle.yaw));
  strafeDir.crossVectors(tmpForward, worldUp).normalize();

  const desiredDrift =
    steerInput *
    vehicle.driftScale *
    Math.sign(vehicle.velocity || 1) *
    Math.min(1, Math.abs(vehicle.velocity) / maxSpeed);
  const clampedDrift = THREE.MathUtils.clamp(desiredDrift, -vehicle.driftMax, vehicle.driftMax);
  vehicle.driftVel = THREE.MathUtils.damp(
    vehicle.driftVel,
    clampedDrift,
    vehicle.driftDamp,
    dt
  );

  vehicle.object.position.addScaledVector(tmpForward, vehicle.velocity * dt);
  vehicle.object.position.addScaledVector(strafeDir, vehicle.driftVel * dt);

  const wasOnWave = vehicle.onWave;
  vehicle.onWave = false;

  const groundInfo = getGroundInfo(
    vehicle.object.position.x,
    vehicle.object.position.z
  );
  const gerstner = sampleGerstner(
    vehicle.object.position.x,
    vehicle.object.position.z,
    shaderTime
  );

  const targetSurfHeight = groundInfo.height + gerstner.height;
  const targetGradX = groundInfo.gradX + gerstner.gradX;
  const targetGradZ = groundInfo.gradZ + gerstner.gradZ;
  vehicle.surfaceHeight = THREE.MathUtils.damp(
    vehicle.surfaceHeight || targetSurfHeight,
    targetSurfHeight,
    boatSurfaceSmooth,
    dt
  );
  vehicle.surfaceGradX = THREE.MathUtils.damp(
    vehicle.surfaceGradX || targetGradX,
    targetGradX,
    boatSurfaceSmooth,
    dt
  );
  vehicle.surfaceGradZ = THREE.MathUtils.damp(
    vehicle.surfaceGradZ || targetGradZ,
    targetGradZ,
    boatSurfaceSmooth,
    dt
  );

  const travelSign = vehicle.velocity >= 0 ? 1 : -1;
  const slopeAlongForward =
    vehicle.surfaceGradX * tmpForward.x +
    vehicle.surfaceGradZ * tmpForward.z;
  const slopeAlongTravel = slopeAlongForward * travelSign;

  vehicle.vy -= 25 * dt;
  vehicle.object.position.y += vehicle.vy * dt;

  const targetY = vehicle.surfaceHeight;
  const verticalError = targetY - vehicle.object.position.y;
  const nearSurface = verticalError >= -2;

  if (nearSurface) {
    vehicle.object.position.y = THREE.MathUtils.damp(
      vehicle.object.position.y,
      targetY,
      boatHeightDamp,
      dt
    );
    if (vehicle.airborne && verticalError > -0.2) {
      vehicle.roll = 0;
    }
    vehicle.airborne = false;
    vehicle.vy = 0;
    vehicle.onWave = groundInfo.onWave;

    const targetPitch = Math.atan2(slopeAlongForward, 1);
    vehicle.pitch = THREE.MathUtils.damp(
      vehicle.pitch,
      targetPitch,
      10,
      dt
    );
    vehicle.roll = THREE.MathUtils.damp(vehicle.roll, 0, 10, dt);

    const uphill = Math.max(0, slopeAlongTravel);
    const slopePenalty = uphill * 30;
    vehicle.velocity = Math.max(0, vehicle.velocity - slopePenalty * dt);

    if (groundInfo.onWave) {
      const climbLift = Math.max(0, vehicle.velocity) * uphill * 0.6;
      vehicle.vy = Math.max(vehicle.vy, climbLift);
    }
  } else {
    vehicle.airborne = true;
    if (wasOnWave) {
      const launchLift =
        Math.abs(vehicle.velocity) * Math.max(0, slopeAlongTravel) * 0.8;
      vehicle.vy = Math.max(vehicle.vy, launchLift);
    }
    const spinRate = 4 * Math.PI;
    if (moveState.flip) vehicle.roll += spinRate * dt;
    if (moveState.somersault) vehicle.pitch += spinRate * dt;
  }

  vehicle.object.rotation.set(vehicle.pitch, vehicle.yaw, vehicle.roll);
  controls.target.copy(vehicle.object.position);
}

function updateFollowCamera(dt) {
  if (!vehicle.object) return;

  tmpForward.set(Math.sin(vehicle.yaw), 0, Math.cos(vehicle.yaw));
  camDesired.copy(vehicle.object.position);
  camDesired.addScaledVector(tmpForward, -followCamera.distance);
  camDesired.y += followCamera.height;

  camera.position.lerp(
    camDesired,
    1 - Math.exp(-followCamera.stiffness * dt)
  );

  camLook.copy(vehicle.object.position);
  camLook.addScaledVector(tmpForward, followCamera.lookAhead);
  camera.lookAt(camLook);
}

function updateSpectator(dt) {
  camera.getWorldDirection(cameraDir);
  cameraDir.y = 0;
  cameraDir.normalize();

  strafeDir.crossVectors(cameraDir, worldUp).normalize();

  moveDelta.set(0, 0, 0);
  if (moveState.forward) moveDelta.add(cameraDir);
  if (moveState.back) moveDelta.sub(cameraDir);
  if (moveState.left) moveDelta.sub(strafeDir);
  if (moveState.right) moveDelta.add(strafeDir);

  if (moveDelta.lengthSq() > 0) {
    moveDelta.normalize().multiplyScalar(spectatorSpeed * dt);
    camera.position.add(moveDelta);
    controls.target.add(moveDelta);
  }

  controls.update();
}

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function randomMosaSpawn() {
  return 5 + Math.random() * 235; // 5s to ~4 minutes
}

function respawnSharkAtEdge() {
  if (!sharkState.object) return;
  const pos = randomEdgePosition();
  const water =
    groundBaseHeight +
    sampleWave(pos.x, pos.z).height +
    sampleGerstner(pos.x, pos.z, shaderTime).height;
  sharkState.object.visible = false;
  sharkState.object.position.set(pos.x, water, pos.z);
  sharkState.yaw = Math.random() * Math.PI * 2;
  sharkState.object.rotation.y = sharkState.yaw + sharkState.modelYawOffset;
  sharkState.sprinting = false;
  sharkState.wanderTimer = 0;
  sharkState.object.visible = true;
}

function handleMosaSharkOverlap() {
  respawnSharkAtEdge();
  resetMosasaur();
  mosasaurState.spawnTimer = randomMosaSpawn();
}

function playMosaRoar(origin) {
  if (!mosaRoar || !mosaRoar.buffer) return;
  const boatPos = vehicle.object ? vehicle.object.position : camera.position;
  const dist = origin.distanceTo(boatPos);
  const maxRange = groundSize * 0.5;
  const vol = THREE.MathUtils.clamp(1 - dist / maxRange, 0.01, 1);
  mosaRoar.setVolume(vol);
  mosaRoar.position.copy(origin);
  if (!mosaRoar.parent && mosasaurState.object) {
    mosasaurState.object.add(mosaRoar);
  }
  mosaRoar.setRefDistance(25);
  mosaRoar.setMaxDistance(maxRange);
  mosaRoar.setDistanceModel("linear");
  if (!mosaRoar.isPlaying) {
    mosaRoar.play();
  } else {
    mosaRoar.stop();
    mosaRoar.play();
  }
}
window.addEventListener("resize", handleResize);

function animate() {
  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  shaderTime += dt;

  if (gameOver) {
    updateCapsize(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
    return;
  }

  updateWave(dt);
  updateNet(dt);
  updateSplash(dt);
  updateGerstnerTime(shaderTime);
  updateCalmTime(shaderTime);
  updateShark(dt);
  updateMosasaur(dt);
  updateSharkAlarm();
  updateMothership(dt);
  mixers.forEach((m) => m.update(dt));
  updateWaterMask();

  if (controlMode === controlModes.CAR) {
    updateCar(dt);
    updateFollowCamera(dt);
  } else {
    updateSpectator(dt);
  }

  refreshSectionOverlay();
  renderer.render(scene, camera);
  renderMinimap();
  requestAnimationFrame(animate);
}

animate();

function sampleSingleWave(w, x, z) {
  if (!w.active) return { height: 0, dHdx: 0, dHdz: 0 };
  const dx = x - w.center.x;
  const dz = z - w.center.y;
  const along = dx * w.dir.x + dz * w.dir.y;
  const perp = dx * -w.dir.y + dz * w.dir.x;
  const sigma2A = w.sigmaAlong * w.sigmaAlong;
  const sigma2P = w.sigmaAcross * w.sigmaAcross;
  const height =
    w.amplitude *
    Math.exp(-(along * along) / (2 * sigma2A) - (perp * perp) / (2 * sigma2P));
  const dE_dx = -(along * w.dir.x) / sigma2A + (perp * w.dir.y) / sigma2P;
  const dE_dz = -(along * w.dir.y) / sigma2A - (perp * w.dir.x) / sigma2P;
  return { height, dHdx: height * dE_dx, dHdz: height * dE_dz };
}

function sampleWave(x, z) {
  let height = 0;
  let dHdx = 0;
  let dHdz = 0;
  for (const w of waves) {
    const s = sampleSingleWave(w, x, z);
    height += s.height;
    dHdx += s.dHdx;
    dHdz += s.dHdz;
  }
  const atten = edgeFalloff(x, z);
  return { height: height * atten, dHdx: dHdx * atten, dHdz: dHdz * atten };
}

function sampleGerstner(x, z, time) {
  let h = 0;
  let gx = 0;
  let gz = 0;
  for (const w of gerstnerWaves) {
    const k = (Math.PI * 2) / w.len;
    const phase = k * (w.dir.x * x + w.dir.y * z) + w.speed * time;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    h += w.amp * s;
    const grad = w.amp * k * c;
    gx += grad * w.dir.x;
    gz += grad * w.dir.y;
  }
  return { height: h, gradX: gx, gradZ: gz };
}

function edgeFalloff(x, z) {
  const half = groundSize * 0.5;
  const fx = THREE.MathUtils.clamp(1 - Math.abs(x) / half, 0, 1);
  const fz = THREE.MathUtils.clamp(1 - Math.abs(z) / half, 0, 1);
  return Math.pow(Math.min(fx, fz), 1.2);
}

function getGroundInfo(x, z) {
  const sample = sampleWave(x, z);
  const normal = new THREE.Vector3(-sample.dHdx, 1, -sample.dHdz).normalize();
  const onWave = sample.height > 0.05;
  return {
    height: groundBaseHeight + sample.height,
    gradX: sample.dHdx,
    gradZ: sample.dHdz,
    normal,
    onWave,
  };
}

function updateWave(dt) {
  for (const w of waves) {
    if (!w.active) {
      if (w.cooldown > 0) {
        w.cooldown -= dt;
        continue;
      }
      spawnWave(w);
    }
    moveWave(w, dt);
  }
  triggerCrestSplash(dt);
  updateHud();
  updateWaveMesh();
  checkRogueCapsize();
}

function moveWave(w, dt) {
  const delta = w.speed * dt;
  w.center.addScaledVector(w.dir, delta);
  w.traveled += delta;
  if (w.traveled > waveConfig.travelMax) {
    w.active = false;
    w.cooldown =
      waveConfig.respawnDelay[0] +
      Math.random() * (waveConfig.respawnDelay[1] - waveConfig.respawnDelay[0]);
  }
}

function updateWaveMesh() {
  const positions = ground.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const zWorld = -positions.getY(i);
    const h = sampleWave(x, zWorld).height;
    positions.setZ(i, h);
  }
  positions.needsUpdate = true;
  ground.geometry.computeVertexNormals();
}

function triggerCrestSplash(dt) {
  if (!vehicle.object && !camera) return;
  if (splashState.cooldown > 0) splashState.cooldown -= dt;
  if (splashState.cooldown > 0) return;
  const origin = vehicle.object ? vehicle.object.position : camera.position;
  const sampleRadius = 220;
  let best = { wave: null, height: 0, pos: null };
  for (let i = 0; i < 6; i++) {
    const ang = Math.random() * Math.PI * 2;
    const r = Math.random() * sampleRadius;
    const px = origin.x + Math.cos(ang) * r;
    const pz = origin.z + Math.sin(ang) * r;
    for (const w of waves) {
      if (!w.active) continue;
      const s = sampleSingleWave(w, px, pz);
      if (s.height > best.height) {
        best.height = s.height;
        best.wave = w;
        best.pos = { x: px, z: pz };
      }
    }
  }
  if (best.wave && best.height > 0.35 && best.pos) {
    const crestY =
      groundBaseHeight +
      sampleWave(best.pos.x, best.pos.z).height +
      sampleGerstner(best.pos.x, best.pos.z, shaderTime).height +
      0.9;
    spawnSplashParticles(
      new THREE.Vector3(best.pos.x, crestY, best.pos.z),
      best.wave.dir
    );
    splashState.cooldown = 0.25;
  }
}

function spawnSplashParticles(origin, waveDir) {
  if (!splashState.mesh) return;
  const dir3 = tmpVecA.set(waveDir.x, 0, waveDir.y).normalize();
  const upBoost = 9;
  for (let i = 0; i < splashState.poolSize; i++) {
    const p = splashState.particles[i];
    p.active = true;
    p.life = 0;
    p.ttl = 0.9 + Math.random() * 0.5;
    p.pos.copy(origin);
    p.pos.x += (Math.random() - 0.5) * 0.8;
    p.pos.z += (Math.random() - 0.5) * 0.8;
    p.vel.copy(dir3).multiplyScalar(5 + Math.random() * 6);
    p.vel.y = upBoost + Math.random() * 3.5;
    p.vel.x += (Math.random() - 0.5) * 1.2;
    p.vel.z += (Math.random() - 0.5) * 1.2;
  }
  splashState.mesh.instanceMatrix.needsUpdate = true;
}

function updateSplash(dt) {
  if (!splashState.mesh) return;
  for (let i = 0; i < splashState.poolSize; i++) {
    const p = splashState.particles[i];
    if (!p.active) {
      tmpMat4.makeScale(0, 0, 0);
      splashState.mesh.setMatrixAt(i, tmpMat4);
      continue;
    }
    p.life += dt;
    if (p.life >= p.ttl) {
      p.active = false;
      tmpMat4.makeScale(0, 0, 0);
      splashState.mesh.setMatrixAt(i, tmpMat4);
      continue;
    }
    p.vel.y += splashGravity * dt;
    p.pos.addScaledVector(p.vel, dt);
    const scale = THREE.MathUtils.lerp(0.45, 0.1, p.life / p.ttl);
    tmpMat4.compose(p.pos, tmpQuatIdentity, new THREE.Vector3(scale, scale, scale));
    splashState.mesh.setMatrixAt(i, tmpMat4);
  }
  splashState.mesh.instanceMatrix.needsUpdate = true;
}

function updateHud() {
  if (!hudValue) return;
  const active = waves.filter((w) => w.active);
  if (active.length === 0) {
    hudValue.textContent = "—";
    hudEl?.classList.remove("pulse");
    hudValue.style.color = "#7ee787";
    return;
  }
  const maxAmp = Math.max(...active.map((w) => w.amplitude));
  hudValue.textContent = `${maxAmp.toFixed(1)}m`;
  hudEl?.classList.add("pulse");
}

function initNetRig() {
  if (netState.mesh) return;
  netState.mesh = new THREE.Mesh(netAssets.coneGeo, netAssets.netMat.clone());
  netState.mesh.rotation.x = Math.PI;
  netState.mesh.visible = false;
  netState.mesh.castShadow = true;
  scene.add(netState.mesh);

  netState.rope = new THREE.Mesh(netAssets.ropeGeo, netAssets.ropeMat.clone());
  netState.rope.visible = false;
  scene.add(netState.rope);
}

function handleNetAction() {
  if (!vehicle.object) return;
  if (!netState.mesh) initNetRig();
  if (!netState.active) {
    startNet();
  } else if (netState.phase === "fill" || netState.phase === "drop") {
    startNetRise();
  }
}

function dropNetToBottom() {
  if (!netState.active || !netState.mesh) return;
  netState.active = false;
  netState.phase = "idle";
  netState.progress = 0;
  netState.currentTons = 0;
  netState.catchSpecies = null;
  sharkState.sprinting = false;
  netState.mesh.visible = true;
  netState.rope.visible = false;
  netState.mesh.position.set(
    netState.mesh.position.x,
    groundBaseHeight - 20,
    netState.mesh.position.z
  );
  netState.mesh.scale.setScalar(0.6);
  setNetbarVisibility(false);
}

function startNet() {
  const anchorWorld = getNetAnchorPosition();
  netState.anchorPos.copy(anchorWorld);
  netState.catchSpecies = getFishForPosition(anchorWorld.x, anchorWorld.z);
  sharkState.sprinting = true;
  netState.targetPos.copy(anchorWorld);
  netState.targetPos.y = groundBaseHeight - 10;
  netState.progress = 0;
  netState.targetTons = netState.catchSpecies ? 9 + Math.random() * 6 : 0;
  netState.maxTons = netState.targetTons;
  netState.currentTons = 0;
  netState.duration = 5 + Math.random() * 5;
  netState.elapsed = 0;
  netState.phase = "drop";
  netState.active = true;
  netState.mesh.geometry = netAssets.coneGeo;
  netState.mesh.rotation.set(Math.PI, 0, 0);
  netState.mesh.scale.setScalar(0.6);
  netState.mesh.position.copy(anchorWorld);
  netState.mesh.visible = true;
  netState.rope.visible = true;
  netState.sizeScale = 0.6;
  setNetbarVisibility(true);
  updateNetbar(0);
}

function startNetRise() {
  netState.phase = "rise";
  netState.elapsed = 0;
  netState.startPos.copy(netState.mesh.position);
  netState.endPos.copy(getNetAnchorPosition());
  netState.sizeScale = 0.6 + netState.progress;
  netState.mesh.geometry = netAssets.sphereGeo;
  netState.mesh.rotation.set(0, 0, 0);
  netState.mesh.scale.setScalar(netState.sizeScale);
  netBar?.classList.remove("pulse");
}

function updateNet(dt) {
  if (!netState.active || !netState.mesh) return;
  const anchorWorld = getNetAnchorPosition();
  netState.anchorPos.copy(anchorWorld);
  const boatPos = vehicle.object ? vehicle.object.position : anchorWorld;
  const waveAtBoat = sampleWave(boatPos.x, boatPos.z).height;

  switch (netState.phase) {
    case "drop": {
      netState.elapsed += dt;
      const t = THREE.MathUtils.clamp(netState.elapsed / netState.dropTime, 0, 1);
      netState.mesh.position.lerpVectors(netState.anchorPos, netState.targetPos, t);
      netState.mesh.scale.setScalar(THREE.MathUtils.lerp(0.6, 0.9, t));
      if (t >= 1) {
        netState.phase = "fill";
        netState.elapsed = 0;
      }
      break;
    }
    case "fill": {
      netState.elapsed += dt;
      netState.progress = THREE.MathUtils.clamp(netState.elapsed / netState.duration, 0, 1);
      const s = 0.6 + netState.progress * 0.9;
      netState.mesh.scale.setScalar(s);
      netState.currentTons = netState.targetTons * netState.progress;
      updateNetbar(netState.progress);
      if (netState.progress >= 1) {
        startNetRise();
      }
      break;
    }
    case "rise": {
      netState.elapsed += dt;
      const t = THREE.MathUtils.clamp(netState.elapsed / netState.riseTime, 0, 1);
      netState.endPos.copy(getNetAnchorPosition());
      netState.mesh.position.lerpVectors(netState.startPos, netState.endPos, t);
      netState.mesh.scale.setScalar(0.6 + netState.progress * 1.2);
      if (t >= 1) {
        finishNet();
      }
      // Removed capsize trigger here; handled in updateWave via crest height check
      break;
    }
    default:
      break;
  }

  updateRope(netState.anchorPos, netState.mesh.position);
}

function finishNet() {
  netState.active = false;
  netState.phase = "idle";
  totalTons += netState.currentTons;
  if (netState.catchSpecies && netState.currentTons > 0) {
    speciesTotals[netState.catchSpecies.name] =
      (speciesTotals[netState.catchSpecies.name] || 0) + netState.currentTons;
    cargoTotals[netState.catchSpecies.name] =
      (cargoTotals[netState.catchSpecies.name] || 0) + netState.currentTons;
  }
  netState.currentTons = 0;
  netState.progress = 0;
  if (netState.mesh) netState.mesh.visible = false;
  if (netState.rope) netState.rope.visible = false;
  if (netBarTotal) netBarTotal.textContent = `(${totalTons.toFixed(1)} t total)`;
  setNetbarVisibility(false);
  updateStatusHaul(0, totalTons);
  netState.catchSpecies = null;
  sharkState.sprinting = false;
  if (!gameOver && totalTons >= 80) {
    triggerCapsize("overload");
  }
}

function markOpeningFinished() {
  if (openingFinished) return;
  openingFinished = true;
  tryShowPendingFish();
}

function unloadAtMothership() {
  if (!vehicle.object || !mothershipState.object) return;
  const dist = vehicle.object.position.distanceTo(mothershipState.object.position);
  if (dist > mothershipDockRange) {
    console.log("Return to mothership to unload.");
    return;
  }
  const cargo = getCargoWeight();
  if (cargo <= 0.001) {
    console.log("No cargo to unload.");
    return;
  }
  const payout = computePayout();
  cashTotal += payout;
  const mainSpecies = Object.entries(cargoTotals).reduce(
    (acc, [name, tons]) => (tons > acc.tons ? { name, tons } : acc),
    { name: null, tons: 0 }
  );
  let haulSoundType = "wrong";
  if (mainSpecies.name === targetFish?.name) {
    haulSoundType = "success";
  } else if (mainSpecies.name === "Ocean Perch" && mainSpecies.name !== "Snapper") {
    haulSoundType = "oceanPerch";
  }
  targetFish = null;
  refreshSectionOverlay();
  resetCargoTotals();
  totalTons = 0;
  updateStatusHaul(0, totalTons);
  if (netBarTotal) netBarTotal.textContent = `(0.0 t total)`;
  console.log(`Unloaded ${cargo.toFixed(1)} t for $${payout.toFixed(2)}. Total cash: $${cashTotal.toFixed(2)}.`);
  playHaulComplete(haulSoundType, () => {
    setNewTargetFish();
    refreshSectionOverlay();
  });
}

function updateRope(anchorPos, netPos) {
  if (!netState.rope) return;
  const rope = netState.rope;
  const dir = tmpNetDir.subVectors(netPos, anchorPos);
  const dist = dir.length();
  if (dist < 0.01) {
    rope.visible = false;
    return;
  }
  rope.visible = true;
  const mid = tmpNetMid.copy(anchorPos).addScaledVector(dir, 0.5);
  rope.position.copy(mid);
  rope.scale.set(1, dist, 1);
  dir.normalize();
  tmpQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  rope.setRotationFromQuaternion(tmpQuat);
}

function triggerCapsize(mode = "rogue") {
  gameOver = true;
  sinkMode = mode;
  sinkTimer = 0;
  if (loadingEl) {
    loadingEl.textContent =
      mode === "overload"
        ? "Overloaded! Boat sinking..."
        : "Capsized by rogue wave... restarting";
  }
  setNetbarVisibility(false);
}

function updateCapsize(dt) {
  if (!vehicle.object) {
    if (sinkTimer > 2) location.reload();
    sinkTimer += dt;
    return;
  }
  sinkTimer += dt;
  vehicle.object.rotation.z += Math.PI * dt * 0.6;
  vehicle.object.position.y -= 3.5 * dt;
  camera.position.lerp(
    vehicle.object.position.clone().add(new THREE.Vector3(8, 6, 8)),
    1 - Math.exp(-2 * dt)
  );
  camera.lookAt(vehicle.object.position);
  if (sinkTimer >= 3) {
    location.reload();
  }
}

function getNetAnchorPosition() {
  const out = new THREE.Vector3();
  if (netState.anchor && netState.anchor.getWorldPosition) {
    netState.anchor.getWorldPosition(out);
  } else if (vehicle.object) {
    out.copy(vehicle.object.position);
  } else {
    out.set(0, 0, 0);
  }
  return out;
}

function setNetbarVisibility(show) {
  if (!netBar) return;
  netBar.style.display = show ? "block" : "none";
  netBarVisible = show;
  if (!show) {
    netBar.classList.remove("pulse");
  }
}

function updateNetbar(progress) {
  if (!netBar || !netBarFill || !netBarTons) return;
  netBarFill.style.width = `${(progress * 100).toFixed(1)}%`;
  const tonnes = progress * netState.maxTons;
  netBarTons.textContent = `${tonnes.toFixed(1)} t`;
  if (netBarTotal) netBarTotal.textContent = `(${totalTons.toFixed(1)} t total)`;
  if (!netBarVisible) setNetbarVisibility(true);
  if (progress >= 1) netBar.classList.add("pulse");
  updateStatusHaul(tonnes, totalTons);
}

function toggleControlsPanel() {
  if (!controlsPanel) return;
  const visible = controlsPanel.style.display === "block";
  controlsPanel.style.display = visible ? "none" : "block";
}

function setupTouchControls() {
  if (!isMobile || !touchControls) return;
  touchControls.style.display = "flex";

  // Joystick setup
  if (joystick && joystickStick) {
    let joyActive = false;
    const joyCenter = { x: 0, y: 0 };
    const radius = 50;
    const setFromEvent = (e) => {
      const rect = joystick.getBoundingClientRect();
      joyCenter.x = rect.left + rect.width / 2;
      joyCenter.y = rect.top + rect.height / 2;
      const dx = e.clientX - joyCenter.x;
      const dy = e.clientY - joyCenter.y;
      const dist = Math.hypot(dx, dy);
      const clamped = dist > radius ? radius / dist : 1;
      const nx = dx * clamped;
      const ny = dy * clamped;
      joystickStick.style.transform = `translate(${nx}px, ${ny}px)`;
      // Map to movement
      moveState.forward = ny < -10;
      moveState.back = ny > 10;
      moveState.left = nx < -10;
      moveState.right = nx > 10;
    };
    const resetJoy = () => {
      joystickStick.style.transform = "translate(-50%, -50%)";
      moveState.forward = moveState.back = moveState.left = moveState.right = false;
    };
    joystick.addEventListener("pointerdown", (e) => {
      joyActive = true;
      joystick.setPointerCapture(e.pointerId);
      setFromEvent(e);
    });
    joystick.addEventListener("pointermove", (e) => {
      if (!joyActive) return;
      setFromEvent(e);
    });
    joystick.addEventListener("pointerup", (e) => {
      joyActive = false;
      joystick.releasePointerCapture(e.pointerId);
      resetJoy();
    });
    joystick.addEventListener("pointercancel", () => {
      joyActive = false;
      resetJoy();
    });
  }

  // Buttons
  if (btnTurbo) {
    btnTurbo.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      moveState.turbo = true;
    });
    btnTurbo.addEventListener("pointerup", (e) => {
      e.preventDefault();
      moveState.turbo = false;
    });
    btnTurbo.addEventListener("pointerout", (e) => {
      e.preventDefault();
      moveState.turbo = false;
    });
  }

  if (btnNet) {
    let lastTap = 0;
    btnNet.addEventListener("pointerdown", (e) => {
      e.preventDefault();
    });
    btnNet.addEventListener("pointerup", (e) => {
      e.preventDefault();
      const now = performance.now();
      if (now - lastTap < 400) {
        dropNetToBottom();
      } else {
        handleNetAction();
      }
      lastTap = now;
    });
  }

  // Hint text for mobile
  const hint = document.getElementById("status-hint");
  if (hint) hint.textContent = "Use joystick + buttons";
}

function handleTouchAction(action, isDown) {
  // legacy handler no longer used
}

function renderMinimap() {
  if (!minimapCtx || !vehicle.object) return;
  const ctx = minimapCtx;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const halfW = w / 2;
  const halfH = h / 2;
  const radius = Math.min(halfW, halfH) - 6;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  ctx.save();
  ctx.translate(halfW, halfH);
  // grid drift to convey motion under fixed boat
  const gridStep = 40;
  const boatPos = vehicle.object.position;
  const offsetX = (boatPos.x % gridStep) * (radius / minimapRange);
  const offsetZ = (boatPos.z % gridStep) * (radius / minimapRange);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  for (let gx = -radius * 2; gx <= radius * 2; gx += gridStep * (radius / minimapRange)) {
    ctx.beginPath();
    ctx.moveTo(gx - offsetX, -radius);
    ctx.lineTo(gx - offsetX, radius);
    ctx.stroke();
  }
  for (let gz = -radius * 2; gz <= radius * 2; gz += gridStep * (radius / minimapRange)) {
    ctx.beginPath();
    ctx.moveTo(-radius, gz - offsetZ);
    ctx.lineTo(radius, gz - offsetZ);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#6cf";
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();

  const range = minimapRange;

  if (mothershipState.object) {
    const dx = mothershipState.object.position.x - boatPos.x;
    const dz = mothershipState.object.position.z - boatPos.z;
    const dist = Math.hypot(dx, dz);
    const capped = Math.min(dist, range);
    const scale = radius / range;
    const px = (dx / (dist || 1)) * capped * scale;
    const pz = (dz / (dist || 1)) * capped * scale;
    ctx.fillStyle = "#4ea5ff";
    ctx.beginPath();
    ctx.arc(px, pz, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const wv of waves) {
    if (!wv.active) continue;
    const dx = wv.center.x - boatPos.x;
    const dz = wv.center.y - boatPos.z;
    const dist = Math.hypot(dx, dz);
    const capped = Math.min(dist, range);
    const scale = radius / range;
    const px = (dx / (dist || 1)) * capped * scale;
    const pz = (dz / (dist || 1)) * capped * scale;
  const ampNorm = THREE.MathUtils.clamp(
    (wv.amplitude - waveConfig.ampMin) / (waveConfig.ampMax - waveConfig.ampMin),
    0,
    1
  );
    ctx.fillStyle = `rgba(255,80,80,${0.5 + ampNorm * 0.5})`;
    ctx.beginPath();
    ctx.arc(px, pz, 5 + ampNorm * 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function spawnWave(w) {
  const angle = Math.random() * Math.PI * 2;
  w.dir.set(Math.cos(angle), Math.sin(angle)).normalize();
  const perp = new THREE.Vector2(-w.dir.y, w.dir.x);
  const offset = (Math.random() * 600) - 300;
  w.center.copy(w.dir).multiplyScalar(-waveConfig.spawnDistance).addScaledVector(perp, offset);
  w.amplitude =
    waveConfig.ampMin + Math.random() * (waveConfig.ampMax - waveConfig.ampMin);
  w.speed =
    waveConfig.speedMin + Math.random() * (waveConfig.speedMax - waveConfig.speedMin);
  w.sigmaAlong = waveConfig.sigmaAlong;
  w.sigmaAcross = waveConfig.sigmaAcross;
  w.traveled = 0;
  w.active = true;
}

function applyGerstnerWaves(material) {
  material.userData.gerstner = { waves: gerstnerWaves, uniforms: null };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uMaskCenter = { value: new THREE.Vector2(0, 0) };
    shader.uniforms.uMaskRadius = { value: 18 };
    shader.uniforms.uMaskCenterBoat = { value: new THREE.Vector2(0, 0) };
    shader.uniforms.uMaskRadiusBoat = { value: 0 };
    shader.uniforms.uTileSize = { value: 20.0 };
    shader.uniforms.uBaseScale = { value: 1.0 };
    shader.uniforms.uFoamMap = { value: crestTex };
    shader.uniforms.uFoamScale = { value: 1.5 };
    shader.uniforms.uDir = { value: gerstnerWaves.map((w) => w.dir) };
    shader.uniforms.uWaves = {
      value: gerstnerWaves.map((w) => new THREE.Vector4(w.amp, w.len, w.speed, w.steep)),
    };
    material.userData.gerstner.uniforms = shader.uniforms;

    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `
      #include <common>
      uniform float uTime;
      uniform vec2 uDir[3];
      uniform vec4 uWaves[3];
      uniform vec2 uMaskCenterBoat;
      uniform float uMaskRadiusBoat;
      varying vec3 vWorldPos;
      varying float vCrest;

      void applyGerstner(vec3 pos, out vec3 displaced, out vec3 gNormal, out float crest) {
        vec3 disp = pos;
        float dHdx = 0.0;
        float dHdy = 0.0;

        for (int i = 0; i < 3; i++) {
          vec2 dir = normalize(uDir[i]);
          float amp = uWaves[i].x;
          float len = uWaves[i].y;
          float spd = uWaves[i].z;
          float steep = uWaves[i].w;
          float k = 6.28318530718 / len;
          float phase = k * (dir.x * pos.x + dir.y * pos.y) + spd * uTime;
          float s = sin(phase);
          float c = cos(phase);

          disp.x += dir.x * (steep * amp * c);
          disp.y += dir.y * (steep * amp * c);
          disp.z += amp * s;

          dHdx += amp * k * c * dir.x;
          dHdy += amp * k * c * dir.y;
        }

        displaced = disp;
        gNormal = normalize(vec3(-dHdx, -dHdy, 1.0));
        crest = length(vec2(dHdx, dHdy)) * 2.0;
      }
      `
    );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        `
      vec3 displacedPos;
      vec3 gNormal;
      float crestFactor;
      applyGerstner(vec3(position), displacedPos, gNormal, crestFactor);
      vec3 objectNormal = gNormal;
      vWorldPos = (modelMatrix * vec4(displacedPos, 1.0)).xyz;
      vCrest = crestFactor;
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      vec3 transformed = displacedPos;
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `
      #include <common>
      uniform vec2 uMaskCenter;
      uniform float uMaskRadius;
      uniform vec2 uMaskCenterBoat;
      uniform float uMaskRadiusBoat;
      uniform float uTileSize;
      uniform float uBaseScale;
      uniform sampler2D uFoamMap;
      uniform float uFoamScale;
      varying vec3 vWorldPos;
      varying float vCrest;

      float hash11(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      vec2 rotateUV(vec2 uv, float angle) {
        float s = sin(angle);
        float c = cos(angle);
        uv -= 0.5;
        uv = mat2(c, -s, s, c) * uv;
        uv += 0.5;
        return uv;
      }

      vec2 tileUV(vec2 worldPos) {
        vec2 cell = floor(worldPos / uTileSize);
        vec2 local = fract(worldPos / uTileSize);
        float r = hash11(cell);
        float rot = r < 0.25 ? 0.0 : (r < 0.5 ? 1.5707963 : (r < 0.75 ? 3.1415926 : 4.71238898));
        vec2 uv = rotateUV(local, rot);
        return uv * uBaseScale;
      }
      `
    );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <dithering_fragment>",
        `
      {
        vec2 foamUv = tileUV(vWorldPos.xz) * uFoamScale;
        vec4 crestSample = texture2D(uFoamMap, foamUv);
        float foamMask = crestSample.r;
        float foam = smoothstep(0.12, 0.32, vCrest);
        foam = pow(foam, 1.5) * foamMask;
        vec3 crestTint = crestSample.rgb;
        vec3 crestColor = mix(gl_FragColor.rgb * crestTint, vec3(1.0), 0.5);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, crestColor, foam);
      }
      {
        float d = length(vWorldPos.xz - uMaskCenter);
        float alphaMaskShark = mix(0.7, 1.0, smoothstep(uMaskRadius * 0.4, uMaskRadius, d));
        float db = length(vWorldPos.xz - uMaskCenterBoat);
        float alphaMaskBoat = mix(0.7, 1.0, smoothstep(uMaskRadiusBoat * 0.4, uMaskRadiusBoat, db));
        float alphaMask = min(alphaMaskShark, alphaMaskBoat);
        gl_FragColor.a *= alphaMask;
      }
      #include <dithering_fragment>
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      #ifdef USE_MAP
        vec2 tiledUv = tileUV(vWorldPos.xz);
        vec4 texelColor = texture2D(map, tiledUv);
        diffuseColor *= texelColor;
      #endif
      `
    );

  };
}

function applyCalmWaves(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `
      #include <common>
      uniform float uTime;
      `
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      `
      vec3 displacedPos = vec3(position);
      float k0 = 6.28318530718 / 80.0;
      float k1 = 6.28318530718 / 120.0;
      float k2 = 6.28318530718 / 60.0;
      vec2 d0 = normalize(vec2(1.0, 0.3));
      vec2 d1 = normalize(vec2(-0.6, 1.0));
      vec2 d2 = normalize(vec2(0.2, -1.0));
      float ph0 = k0 * (d0.x * position.x + d0.y * position.y) + 0.6 * uTime;
      float ph1 = k1 * (d1.x * position.x + d1.y * position.y) + 0.5 * uTime;
      float ph2 = k2 * (d2.x * position.x + d2.y * position.y) + 0.8 * uTime;
      float h = 0.15 * sin(ph0) + 0.12 * sin(ph1) + 0.1 * sin(ph2);
      displacedPos.z += h;
      vec3 objectNormal = normalize(vec3(
        - (0.15 * k0 * cos(ph0) * d0.x + 0.12 * k1 * cos(ph1) * d1.x + 0.1 * k2 * cos(ph2) * d2.x),
        - (0.15 * k0 * cos(ph0) * d0.y + 0.12 * k1 * cos(ph1) * d1.y + 0.1 * k2 * cos(ph2) * d2.y),
        1.0
      ));
      `
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      vec3 transformed = displacedPos;
      `
    );
    material.userData.calm = { uniforms: shader.uniforms };
  };
}

function updateGerstnerTime(time) {
  const g = groundMaterial.userData.gerstner;
  if (g && g.uniforms) {
    g.uniforms.uTime.value = time;
  }
}

function updateCalmTime(time) {
  calmMaterials.forEach((m) => {
    if (m.userData.calm?.uniforms) {
      m.userData.calm.uniforms.uTime.value = time;
    }
  });
}

function updateWaterMask() {
  const g = groundMaterial.userData.gerstner;
  if (!g || !g.uniforms) return;
  const centerShark = sharkState.object
    ? new THREE.Vector2(sharkState.object.position.x, sharkState.object.position.z)
    : new THREE.Vector2(0, 0);
  g.uniforms.uMaskCenter.value.copy(centerShark);

  if (vehicle.object) {
    g.uniforms.uMaskCenterBoat.value.set(
      vehicle.object.position.x,
      vehicle.object.position.z
    );
    g.uniforms.uMaskRadiusBoat.value = 14;
  } else {
    g.uniforms.uMaskRadiusBoat.value = 0;
  }
}

function checkRogueCapsize() {
  if (gameOver || !netState.active || netState.phase === "drop") return;
  if (!vehicle.object) return;
  const boatPos = vehicle.object.position;
  const waveHeight = sampleWave(boatPos.x, boatPos.z).height;
  if (waveHeight >= waveConfig.ampMax * 0.5) {
    triggerCapsize("rogue");
  }
}

function lerpAngle(a, b, t) {
  const twoPi = Math.PI * 2;
  let diff = (b - a) % twoPi;
  if (diff > Math.PI) diff -= twoPi;
  if (diff < -Math.PI) diff += twoPi;
  return a + diff * t;
}

function updateShark(dt) {
  if (!sharkState.object) return;
  const chasing = (netState.active && netState.phase !== "idle") || sharkState.sprinting;
  if (!netState.active && sharkState.sprinting) {
    sharkState.sprinting = false;
  }
  sharkState.wanderTimer -= dt;
  if (!chasing && sharkState.wanderTimer <= 0) {
    sharkState.wanderTimer = 3 + Math.random() * 3;
    sharkState.speed = 6 + Math.random() * 6;
    sharkState.yaw += (Math.random() - 0.5) * Math.PI * 0.6;
  }

  const limit = groundSize * 0.45;
  const pos = sharkState.object.position;
  if (Math.abs(pos.x) > limit || Math.abs(pos.z) > limit) {
    const angleToCenter = Math.atan2(-pos.x, -pos.z);
    sharkState.yaw = lerpAngle(sharkState.yaw, angleToCenter, dt * 0.6);
  } else if (chasing && vehicle.object) {
    const angleToBoat = Math.atan2(
      vehicle.object.position.x - pos.x,
      vehicle.object.position.z - pos.z
    );
    sharkState.yaw = lerpAngle(sharkState.yaw, angleToBoat, dt * 3.5);
    const dist = pos.distanceTo(vehicle.object.position);
    const sprinting = dist <= sharkNetChaseRadius;
    const chaseFactor = netState.progress || 0;
    const base = 10 + chaseFactor * 12;
    sharkState.speed = sprinting ? sharkSprintSpeed : base;
  }

  const forward = tmpForward.set(Math.sin(sharkState.yaw), 0, Math.cos(sharkState.yaw));
  pos.addScaledVector(forward, sharkState.speed * dt);
  sharkState.object.rotation.y = sharkState.yaw + sharkState.modelYawOffset;

  // collision with boat
  if (vehicle.object) {
    const d = pos.distanceTo(vehicle.object.position);
    if (d < 3.0) {
      vehicle.velocity = 0;
      if (netState.active && !gameOver) triggerCapsize("rogue");
    }
  }

  // collision with net or rope segment
  if (netState.active && netState.mesh && netState.mesh.visible && !gameOver) {
    const a = netState.anchorPos;
    const b = netState.mesh.position;
    const seg = tmpNetMid.subVectors(b, a);
    const lenSq = seg.lengthSq();
    let distSeg = Infinity;
    if (lenSq > 0) {
      const t = THREE.MathUtils.clamp(
        tmpForward.subVectors(pos, a).dot(seg) / lenSq,
        0,
        1
      );
      const closest = tmpForward.copy(a).addScaledVector(seg, t);
      distSeg = pos.distanceTo(closest);
    }
    const distNet = pos.distanceTo(b);
    if (Math.min(distSeg, distNet) < 3.0) {
      triggerCapsize("rogue");
    }
  }

  if (mosasaurState.object && mosasaurState.active) {
    const overlapDist = pos.distanceTo(mosasaurState.object.position);
    const overlapThresh = Math.max(mosasaurState.boundsDepth * 0.6, 20);
    if (overlapDist < overlapThresh) {
      handleMosaSharkOverlap();
    }
  }
}

function spawnMosasaur() {
  if (!mosasaurState.object) return;
  const pos = randomEdgePosition();
  mosasaurState.object.position.copy(pos);
  const targetPos = sharkState.object ? sharkState.object.position : new THREE.Vector3(0, 0, 0);
  mosasaurState.yaw = Math.atan2(targetPos.x - pos.x, targetPos.z - pos.z);
  mosasaurState.object.rotation.y = mosasaurState.yaw + mosasaurState.modelYawOffset;
  if (!mosasaurState.inScene) {
    scene.add(mosasaurState.object);
    mosasaurState.inScene = true;
  }
  mosasaurState.object.visible = true;
  mosasaurState.active = true;
  mosasaurState.phase = "swim";
  mosasaurState.jumpTimer = 0;
  mosasaurState.diveTimer = 0;
  mosasaurState.waveRef = null;
  mosasaurState.jumpVel.set(0, 0, 0);
  if (mosasaurState.action) {
    mosasaurState.action.reset().play();
  }
}

function spawnMosaWave(pos, dir) {
  const slot =
    waves.find((w) => !w.active) ||
    waves.reduce((min, w) => (w.traveled > min.traveled ? w : min), waves[0]);
  if (!slot) return;
  slot.dir.copy(new THREE.Vector2(dir.x, dir.z).normalize());
  const forwardOffset = mosasaurState.boundsDepth * 0.25;
  slot.center.set(pos.x + slot.dir.x * forwardOffset, pos.z + slot.dir.y * forwardOffset);
  slot.amplitude = waveConfig.ampMax * 0.9;
  slot.speed = 0;
  slot.traveled = 0;
  slot.sigmaAlong = waveConfig.sigmaAlong;
  slot.sigmaAcross = waveConfig.sigmaAcross;
  slot.active = true;
  slot.cooldown = 0;
  mosasaurState.waveRef = slot;
}

function sinkMosaWave() {
  if (mosasaurState.waveRef) {
    mosasaurState.waveRef.active = false;
    mosasaurState.waveRef.cooldown = 2;
    mosasaurState.waveRef = null;
  }
}

function resetMosasaur() {
  mosasaurState.active = false;
  mosasaurState.phase = "hidden";
  mosasaurState.spawnTimer = randomMosaSpawn();
  mosasaurState.object.visible = false;
  if (mosasaurState.inScene) {
    scene.remove(mosasaurState.object);
    mosasaurState.inScene = false;
  }
  mosasaurState.waveRef = null;
  mosasaurState.jumpVel.set(0, 0, 0);
}

function updateMosasaur(dt) {
  if (!mosasaurState.object) return;
  if (!mosasaurState.active) {
    mosasaurState.spawnTimer -= dt;
    if (mosasaurState.spawnTimer <= 0) {
      mosasaurState.spawnTimer = randomMosaSpawn();
      spawnMosasaur();
    }
    return;
  }
  if (mosasaurState.phase !== "hidden" && sharkState.object) {
    const overlapDist = mosasaurState.object.position.distanceTo(sharkState.object.position);
    const overlapThresh = Math.max(mosasaurState.boundsDepth * 0.6, 20);
    if (overlapDist < overlapThresh) {
      handleMosaSharkOverlap();
      return;
    }
  }
  const pos = mosasaurState.object.position;
  if (mosasaurState.phase === "swim") {
    const targetPos = sharkState.object ? sharkState.object.position : new THREE.Vector3(0, 0, 0);
  const desiredYaw = Math.atan2(targetPos.x - pos.x, targetPos.z - pos.z);
  mosasaurState.yaw = desiredYaw;
  mosasaurState.object.rotation.y = mosasaurState.yaw + mosasaurState.modelYawOffset;
}

tmpForward.set(Math.sin(mosasaurState.yaw), 0, Math.cos(mosasaurState.yaw));
mosasaurState.speed = waveConfig.speedMax;
pos.addScaledVector(tmpForward, mosasaurState.speed * dt);

  const waterHeight =
    groundBaseHeight +
    sampleWave(pos.x, pos.z).height +
    sampleGerstner(pos.x, pos.z, shaderTime).height;

  switch (mosasaurState.phase) {
    case "swim": {
      pos.y = THREE.MathUtils.damp(pos.y, waterHeight, 3, dt);
      if (mosasaurState.waveRef) {
        const forwardOffset = mosasaurState.boundsDepth * 0.25;
        mosasaurState.waveRef.center.set(
          pos.x + tmpForward.x * forwardOffset,
          pos.z + tmpForward.z * forwardOffset
        );
        mosasaurState.waveRef.speed = 0;
        mosasaurState.waveRef.active = true;
      }
      const dist = sharkState.object ? pos.distanceTo(sharkState.object.position) : 0;
      if (dist < 150) {
        spawnMosaWave(pos, tmpForward);
        mosasaurState.phase = "jump";
        mosasaurState.jumpTimer = 0;
        mosasaurState.jumpVel
          .copy(tmpForward)
          .multiplyScalar(mosasaurState.speed * 1.2)
          .add(new THREE.Vector3(0, 45, 0));
        playMosaRoar(pos);
        sinkMosaWave();
      }
      break;
    }
    case "jump": {
      mosasaurState.jumpTimer += dt;
      mosasaurState.jumpVel.y += mosasaurState.jumpGravity * dt;
      pos.addScaledVector(mosasaurState.jumpVel, dt);
      if (pos.y <= waterHeight && mosasaurState.jumpTimer > 0.6) {
        mosasaurState.phase = "dive";
        mosasaurState.diveTimer = 0;
      }
      break;
    }
    case "dive": {
      mosasaurState.diveTimer += dt;
      pos.y = THREE.MathUtils.damp(pos.y, waterHeight - 16, 2.5, dt);
      if (mosasaurState.diveTimer >= 1.2) {
        resetMosasaur();
      }
      break;
    }
    default:
      break;
  }
}

function updateMothership(dt) {
  if (!mothershipState.object) return;
  const pos = mothershipState.object.position;
  const gInfo = getGroundInfo(pos.x, pos.z);
  const gWave = sampleGerstner(pos.x, pos.z, shaderTime);
  const targetY = groundBaseHeight + gInfo.height + gWave.height;
  mothershipState.smoothY = THREE.MathUtils.damp(
    mothershipState.smoothY || targetY,
    targetY,
    3,
    dt
  );
  pos.y = mothershipState.smoothY;
  mothershipState.object.rotation.y = mothershipState.yaw;
}

function updateSharkAlarm() {
  if (!alarmSound || !alarmSound.buffer) return;
  if (!alarmSound.isPlaying && alarmSound.buffer) {
    alarmSound.setLoop(true);
    alarmSound.play();
  }
  let volume = 0;
  if (vehicle.object && sharkState.object) {
    const dist = vehicle.object.position.distanceTo(sharkState.object.position);
    if (dist <= 200) {
      const t = THREE.MathUtils.clamp(1 - dist / 200, 0, 1);
      volume = 0.1 + 0.9 * t;
    } else if (dist <= 280) {
      volume = 0.05;
    }
  }
  alarmSound.setVolume(volume);
}

function randomEdgePosition() {
  const half = groundSize * 0.5;
  const side = Math.random() < 0.5 ? "x" : "z";
  if (side === "x") {
    const x = (Math.random() < 0.5 ? -half : half) * 0.95;
    const z = (Math.random() - 0.5) * groundSize;
    return new THREE.Vector3(x, groundBaseHeight, z);
  } else {
    const z = (Math.random() < 0.5 ? -half : half) * 0.95;
    const x = (Math.random() - 0.5) * groundSize;
    return new THREE.Vector3(x, groundBaseHeight, z);
  }
}

// foam removed

function updateStatusHaul(current, total) {
  if (!statusHaul) return;
  statusHaul.textContent = `Net: ${current.toFixed(1)} t | Total: ${total.toFixed(1)} t`;
}
