import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// ---------- Scene setup ----------

const container = document.getElementById('viewport');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1d22);

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envMap;

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.01, 1000);
camera.position.set(2, 1.5, 3);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(3, 5, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
scene.add(sun.target);

const grid = new THREE.GridHelper(10, 20, 0x555a66, 0x33363e);
scene.add(grid);

// ---------- Loaders ----------

const draco = new DRACOLoader().setDecoderPath(
  'https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/libs/draco/gltf/'
);

function makeGLTFLoader(manager) {
  return new GLTFLoader(manager).setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
}

const defaultMaterial = () =>
  new THREE.MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.5, metalness: 0.1 });

// ---------- State ----------

let current = null;       // root Object3D of the loaded model
let mixer = null;         // AnimationMixer
let clips = [];
let activeAction = null;
let blobUrls = [];        // object URLs to revoke on next load

const clock = new THREE.Clock();

// ---------- UI refs ----------

const $ = (id) => document.getElementById(id);
const infoEl = $('info');
const statusEl = $('status');
const animSection = $('anim-section');
const animSelect = $('anim-select');

function setStatus(msg, isError = false, timeout = 0) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
  statusEl.classList.toggle('show', !!msg);
  if (timeout) setTimeout(() => statusEl.textContent === msg && setStatus(''), timeout);
}

// ---------- Loading ----------

function clearModel() {
  if (mixer) mixer.stopAllAction();
  mixer = null;
  clips = [];
  activeAction = null;
  if (current) {
    scene.remove(current);
    current.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
        m.dispose();
      }
    });
  }
  current = null;
  blobUrls.forEach(URL.revokeObjectURL);
  blobUrls = [];
}

function extOf(name) {
  return name.split('?')[0].split('.').pop().toLowerCase();
}

/** Load a model from a URL (used for bundled samples). */
async function loadFromURL(url) {
  const name = url.split('/').pop();
  setStatus(`Loading ${name}…`);
  try {
    const manager = new THREE.LoadingManager();
    const obj = await loadByExtension(extOf(name), url, manager);
    showModel(obj, name);
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus(`Failed to load ${name}: ${err.message || err}`, true);
  }
}

/**
 * Load from user-provided File objects. Supports multi-file sets
 * (e.g. .gltf + .bin + textures, or .obj + .mtl + textures) by
 * redirecting the loader's relative URLs to in-memory blob URLs.
 */
async function loadFromFiles(fileList) {
  const files = [...fileList];
  const mainExts = ['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply'];
  const main = files.find((f) => mainExts.includes(extOf(f.name)));
  if (!main) {
    setStatus('No supported model file found (glb, gltf, obj, fbx, stl, ply).', true, 4000);
    return;
  }

  // Kept separate from `blobUrls` until the load succeeds, because
  // showModel() -> clearModel() revokes the *previous* model's URLs.
  const newUrls = [];
  const fileMap = new Map();
  for (const f of files) {
    const url = URL.createObjectURL(f);
    newUrls.push(url);
    fileMap.set(f.name.toLowerCase(), url);
  }

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    // Match on basename so "textures/foo.png" finds a dropped "foo.png".
    const base = decodeURIComponent(url.split(/[\\/]/).pop()).toLowerCase();
    return fileMap.get(base) ?? url;
  });

  setStatus(`Loading ${main.name}…`);
  try {
    const ext = extOf(main.name);
    const mainUrl = fileMap.get(main.name.toLowerCase());

    // OBJ: pick up a matching .mtl if one was dropped
    let mtl = null;
    if (ext === 'obj') {
      const mtlFile = files.find((f) => extOf(f.name) === 'mtl');
      if (mtlFile) {
        mtl = await new MTLLoader(manager).loadAsync(fileMap.get(mtlFile.name.toLowerCase()));
        mtl.preload();
      }
    }

    const obj = await loadByExtension(ext, mainUrl, manager, mtl);
    showModel(obj, main.name);
    blobUrls = newUrls; // OBJ/MTL textures may still be loading lazily
    setStatus('');
  } catch (err) {
    newUrls.forEach(URL.revokeObjectURL);
    console.error(err);
    setStatus(`Failed to load ${main.name}: ${err.message || err}`, true);
  }
}

/** Returns { object, animations }. */
async function loadByExtension(ext, url, manager, mtl = null) {
  switch (ext) {
    case 'glb':
    case 'gltf': {
      const gltf = await makeGLTFLoader(manager).loadAsync(url);
      return { object: gltf.scene, animations: gltf.animations };
    }
    case 'fbx': {
      const obj = await new FBXLoader(manager).loadAsync(url);
      return { object: obj, animations: obj.animations };
    }
    case 'obj': {
      const loader = new OBJLoader(manager);
      if (mtl) loader.setMaterials(mtl);
      const obj = await loader.loadAsync(url);
      if (!mtl) obj.traverse((o) => o.isMesh && (o.material = defaultMaterial()));
      return { object: obj, animations: [] };
    }
    case 'stl': {
      const geo = await new STLLoader(manager).loadAsync(url);
      geo.computeVertexNormals();
      const mat = geo.hasColors
        ? new THREE.MeshStandardMaterial({ vertexColors: true })
        : defaultMaterial();
      return { object: new THREE.Mesh(geo, mat), animations: [] };
    }
    case 'ply': {
      const geo = await new PLYLoader(manager).loadAsync(url);
      const hasColor = !!geo.attributes.color;
      if (!geo.index) {
        // PLYLoader only sets an index when the file has faces → this is a point cloud
        const pts = new THREE.Points(
          geo,
          new THREE.PointsMaterial({ size: 0.005, vertexColors: hasColor })
        );
        return { object: pts, animations: [] };
      }
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const mat = hasColor
        ? new THREE.MeshStandardMaterial({ vertexColors: true })
        : defaultMaterial();
      return { object: new THREE.Mesh(geo, mat), animations: [] };
    }
    default:
      throw new Error(`Unsupported format: .${ext}`);
  }
}

function showModel({ object, animations }, name) {
  clearModel();
  current = object;

  object.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  scene.add(object);

  // Animations
  clips = animations || [];
  animSelect.innerHTML = '';
  if (clips.length) {
    mixer = new THREE.AnimationMixer(object);
    clips.forEach((c, i) => animSelect.add(new Option(c.name || `Clip ${i}`, i)));
    animSelect.add(new Option('(none)', -1));
    playClip(0);
  }
  animSection.hidden = clips.length === 0;

  applyWireframe();
  frameObject();
  updateInfo(name);
}

function playClip(index) {
  if (!mixer) return;
  const next = index >= 0 ? mixer.clipAction(clips[index]) : null;
  if (activeAction && activeAction !== next) activeAction.fadeOut(0.25);
  if (next) next.reset().fadeIn(0.25).play();
  activeAction = next;
}

// ---------- Framing ----------

function frameObject() {
  if (!current) return;
  const box = new THREE.Box3().setFromObject(current);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = size.length() / 2 || 1;

  // Sit the model on the grid, centered
  current.position.x -= center.x;
  current.position.z -= center.z;
  current.position.y -= box.min.y;

  const target = new THREE.Vector3(0, size.y / 2, 0);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = radius / Math.sin(fov / 2) * 1.1;

  const dir = new THREE.Vector3(1, 0.6, 1.4).normalize();
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.near = dist / 1000;
  camera.far = dist * 100;
  camera.updateProjectionMatrix();

  controls.target.copy(target);
  controls.update();

  // Scale grid and shadow camera to the model
  const gridSize = Math.pow(10, Math.ceil(Math.log10(Math.max(size.x, size.z) * 2 || 1)));
  grid.scale.setScalar(gridSize / 10);

  sun.position.set(radius * 2, radius * 4, radius * 1.5);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -radius * 1.5;
  sc.right = sc.top = radius * 1.5;
  sc.near = 0.01;
  sc.far = radius * 10;
  sc.updateProjectionMatrix();
}

// ---------- Info ----------

function updateInfo(name) {
  let meshes = 0, verts = 0, tris = 0, bones = 0;
  const mats = new Set();
  current.traverse((o) => {
    if (o.isBone) bones++;
    if (o.isMesh || o.isPoints) {
      meshes++;
      const g = o.geometry;
      const vc = g.attributes.position.count;
      verts += vc;
      if (o.isMesh) tris += g.index ? g.index.count / 3 : vc / 3;
      [].concat(o.material).forEach((m) => mats.add(m));
    }
  });
  const size = new THREE.Box3().setFromObject(current).getSize(new THREE.Vector3());
  infoEl.textContent = [
    `File:      ${name}`,
    `Meshes:    ${meshes}`,
    `Vertices:  ${verts.toLocaleString()}`,
    `Triangles: ${Math.round(tris).toLocaleString()}`,
    `Materials: ${mats.size}`,
    `Bones:     ${bones}`,
    `Clips:     ${clips.length}`,
    `Size:      ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`,
  ].join('\n');
}

// ---------- Options ----------

function applyWireframe() {
  const on = $('opt-wire').checked;
  current?.traverse((o) => {
    if (o.isMesh) [].concat(o.material).forEach((m) => (m.wireframe = on));
  });
}

$('opt-wire').addEventListener('change', applyWireframe);
$('opt-grid').addEventListener('change', (e) => (grid.visible = e.target.checked));
$('opt-env').addEventListener('change', (e) => (scene.environment = e.target.checked ? envMap : null));
$('opt-rotate').addEventListener('change', (e) => (controls.autoRotate = e.target.checked));
$('btn-frame').addEventListener('click', frameObject);
animSelect.addEventListener('change', (e) => playClip(Number(e.target.value)));

document.querySelectorAll('#samples button').forEach((b) =>
  b.addEventListener('click', () => loadFromURL(b.dataset.url))
);

$('file-input').addEventListener('change', (e) => {
  if (e.target.files.length) loadFromFiles(e.target.files);
  e.target.value = '';
});

// ---------- Drag & drop ----------

let dragDepth = 0;
addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (++dragDepth === 1) document.body.classList.add('dragging');
});
addEventListener('dragleave', () => {
  if (--dragDepth === 0) document.body.classList.remove('dragging');
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  if (e.dataTransfer.files.length) loadFromFiles(e.dataTransfer.files);
});

// ---------- Loop ----------

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  mixer?.update(dt);
  controls.update();
  renderer.render(scene, camera);
});

loadFromURL('models/Fox.glb');
