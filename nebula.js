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
const sharkState = {
  object: null,
  mixer: null,
  action: null,
  yaw: 0,
  modelYawOffset: -Math.PI / 2,
  speed: 8,
  wanderTimer: 0,
};

const groundBaseHeight = -0.01;
const groundSize = 1000;
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
const deepOcean = new THREE.Mesh(
  new THREE.PlaneGeometry(groundSize * 1.2, groundSize * 1.2),
  new THREE.MeshStandardMaterial({
    color: 0x0a1d44,
    roughness: 0.9,
    metalness: 0.02,
  })
);
deepOcean.rotation.x = -Math.PI / 2;
deepOcean.position.y = groundBaseHeight - 6;
deepOcean.receiveShadow = false;
scene.add(deepOcean);

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
const foam = {
  max: 1800,
  threshold: 0,
  positions: null,
  geometry: null,
  material: null,
  points: null,
  samples: null,
};
foam.threshold = Math.max(0.1, waveConfig.ampMax * 0.35);
foam.positions = new Float32Array(foam.max * 3);
foam.geometry = new THREE.BufferGeometry();
foam.geometry.setAttribute(
  "position",
  new THREE.BufferAttribute(foam.positions, 3).setUsage(THREE.DynamicDrawUsage)
);
foam.geometry.setDrawRange(0, 0);
foam.material = new THREE.PointsMaterial({
  color: 0xf4f7fb,
  size: 1.6,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  sizeAttenuation: true,
});
foam.points = new THREE.Points(foam.geometry, foam.material);
foam.points.renderOrder = 2;
scene.add(foam.points);
foam.samples = Array.from({ length: foam.max }, () => {
  const x = (Math.random() - 0.5) * groundSize;
  const z = (Math.random() - 0.5) * groundSize;
  return new THREE.Vector2(x, z);
});

if (isMobile) {
  setupTouchControls();
  statusHaul && (document.getElementById("status-hint").textContent = "Tap K for controls");
}

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
  updateGerstnerTime(shaderTime);
  updateShark(dt);
  mixers.forEach((m) => m.update(dt));
  updateWaterMask();
  updateFoam(dt, shaderTime);

  if (controlMode === controlModes.CAR) {
    updateCar(dt);
    updateFollowCamera(dt);
  } else {
    updateSpectator(dt);
  }

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
  let foamCount = 0;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const zWorld = -positions.getY(i);
    const h = sampleWave(x, zWorld).height;
    positions.setZ(i, h);
    if (h > foam.threshold && foamCount < foam.max) {
      const idx = foamCount * 3;
      foam.positions[idx] = x;
      foam.positions[idx + 1] = groundBaseHeight + h + 0.15;
      foam.positions[idx + 2] = zWorld;
      foamCount++;
    }
  }
  positions.needsUpdate = true;
  ground.geometry.computeVertexNormals();
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
  netState.targetPos.copy(anchorWorld);
  netState.targetPos.y = groundBaseHeight - 10;
  netState.progress = 0;
  netState.targetTons = 9 + Math.random() * 6;
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
  netState.currentTons = 0;
  netState.progress = 0;
  if (netState.mesh) netState.mesh.visible = false;
  if (netState.rope) netState.rope.visible = false;
  if (netBarTotal) netBarTotal.textContent = `(${totalTons.toFixed(1)} t total)`;
  setNetbarVisibility(false);
  updateStatusHaul(0, totalTons);
  if (!gameOver && totalTons >= 80) {
    triggerCapsize("overload");
  }
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

      void applyGerstner(vec3 pos, out vec3 displaced, out vec3 gNormal) {
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
      }
      `
    );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        `
      vec3 displacedPos;
      vec3 gNormal;
      applyGerstner(vec3(position), displacedPos, gNormal);
      vec3 objectNormal = gNormal;
      vWorldPos = (modelMatrix * vec4(displacedPos, 1.0)).xyz;
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
      varying vec3 vWorldPos;
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      `
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
  };
}

function updateGerstnerTime(time) {
  const g = groundMaterial.userData.gerstner;
  if (g && g.uniforms) {
    g.uniforms.uTime.value = time;
  }
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
  const chasing = netState.active && netState.phase !== "idle";
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
    sharkState.yaw = lerpAngle(sharkState.yaw, angleToBoat, dt * 2.0);
    const chaseFactor = netState.progress;
    const base = 8 + chaseFactor * 10;
    const dist = pos.distanceTo(vehicle.object.position);
    const sprint =
      netState.active && dist < 72
        ? THREE.MathUtils.lerp(3, 5, Math.random())
        : 1;
    sharkState.speed = base * sprint;
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
}

function updateFoam(dt, time) {
  if (!foam.geometry || !foam.positions || !foam.samples) return;
  let count = 0;
  for (let i = 0; i < foam.samples.length && count < foam.max; i++) {
    const sample = foam.samples[i];
    const g = sampleGerstner(sample.x, sample.y, time);
    if (Math.abs(g.height) < foam.threshold) continue;
    const idx = count * 3;
    foam.positions[idx] = sample.x;
    foam.positions[idx + 1] = groundBaseHeight + g.height + 0.05;
    foam.positions[idx + 2] = sample.y;
    count++;
  }
  foam.geometry.setDrawRange(0, count);
  foam.geometry.attributes.position.needsUpdate = true;
}

function updateStatusHaul(current, total) {
  if (!statusHaul) return;
  statusHaul.textContent = `Net: ${current.toFixed(1)} t | Total: ${total.toFixed(1)} t`;
}
