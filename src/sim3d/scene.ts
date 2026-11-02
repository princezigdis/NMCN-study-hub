import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Mannequin } from "./mannequin";
import { buildEquipment } from "./equipment";
import type { CameraPreset, EquipInfo, PickInfo, Quality, SceneData } from "./types";

type V3 = [number, number, number];
const PRESETS: Record<CameraPreset, { p: V3; t: V3 }> = {
  overview: { p: [3.6, 2.7, 4.0], t: [0, 0.85, 0.1] },
  patient: { p: [2.1, 2.0, 2.5], t: [0, 0.9, 0.15] },
  head: { p: [0.2, 1.7, -2.3], t: [0, 0.95, -0.1] },
  foot: { p: [0.3, 2.2, 3.2], t: [0, 0.9, 0.2] },
  top: { p: [0.01, 4.2, 0.3], t: [0, 0.9, 0.25] },
  sink: { p: [-0.6, 1.7, 2.0], t: [-2.9, 1.0, 0.8] },
  trolley: { p: [3.0, 1.9, 1.6], t: [1.55, 0.9, -0.1] },
};
const DPR: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };
const SHADOW: Record<Quality, number> = { low: 0, medium: 1024, high: 2048 };

const std = (color: number, o: { r?: number; m?: number; a?: number; e?: number; side?: THREE.Side } = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.6, metalness: o.m ?? 0, transparent: o.a !== undefined && o.a < 1, opacity: o.a ?? 1, emissive: o.e ?? 0, side: o.side ?? THREE.FrontSide });
function bx(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true;
  return me;
}
function cy(rt: number, rb: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 20): THREE.Mesh {
  const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true;
  return me;
}
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

export interface SceneOptions {
  quality: Quality;
  onPick: (p: PickInfo | null) => void;
  onHover?: (p: PickInfo | null, x: number, y: number) => void;
  onProgress?: (label: string, pct: number) => void;
  onContextLost?: () => void;
}

export class ClinicalScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private envTex: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator;
  private mannequin = new Mannequin();
  private pickables: THREE.Object3D[] = [];
  private roomObjects = new Map<string, THREE.Object3D>();
  private equipGroups = new Map<string, THREE.Group>();
  private selected = new Set<string>();
  private trolleyTop = new THREE.Group();
  private curtains: THREE.Mesh[] = [];
  private blanket!: THREE.Mesh;
  private water!: THREE.Mesh;
  private outline: THREE.Box3Helper | null = null;
  private hiKey: { kind: string; key: string } | null = null;
  private tweens: Array<{ t0: number; dur: number; fn: (p: number) => void; done?: () => void }> = [];
  private raf = 0;
  private last = 0;
  private pulseUntil = 0;
  private disposed = false;
  private quality: Quality;
  private reduceMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  private ro: ResizeObserver;
  private raycaster = new THREE.Raycaster();
  private down: { x: number; y: number; t: number } | null = null;
  private hoverQueued = false;
  private handlers: Array<[string, EventListener]> = [];

  private constructor(private canvas: HTMLCanvasElement, private opts: SceneOptions) {
    this.quality = opts.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.quality !== "low", powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 40);
    const o = PRESETS.overview;
    this.camera.position.set(...o.p);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(...o.t);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.7;
    this.controls.maxDistance = 7;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.screenSpacePanning = false;
    this.controls.listenToKeyEvents(canvas);
    this.controls.addEventListener("change", () => this.invalidate());
    this.sun = new THREE.DirectionalLight(0xfff4e6, 2.0);
    this.ro = new ResizeObserver(() => this.resize());
  }

  static async create(canvas: HTMLCanvasElement, opts: SceneOptions): Promise<ClinicalScene> {
    const s = new ClinicalScene(canvas, opts);
    await s.build();
    return s;
  }

  // ------------------------------------------------------------ build
  private progress(label: string, pct: number) { this.opts.onProgress?.(label, pct); }

  private async build() {
    const sc = this.scene;
    sc.background = new THREE.Color(0xdfe8ee);
    this.progress("Setting up lighting", 5);
    sc.add(new THREE.HemisphereLight(0xffffff, 0x9fb0bd, 0.55));
    this.sun.position.set(2.5, 5, 2.5);
    this.sun.shadow.camera.left = -4; this.sun.shadow.camera.right = 4;
    this.sun.shadow.camera.top = 4; this.sun.shadow.camera.bottom = -4;
    this.sun.shadow.camera.near = 0.5; this.sun.shadow.camera.far = 12;
    this.sun.shadow.bias = -0.0004;
    sc.add(this.sun);
    await nextFrame();

    this.progress("Building the ward", 20);
    this.buildRoom();
    await nextFrame();
    this.progress("Placing the bed and fittings", 40);
    this.buildBed();
    this.buildSink();
    this.buildLocker();
    this.buildBins();
    this.buildCurtains();
    await nextFrame();
    this.progress("Preparing the patient", 65);
    this.mannequin.root.scale.setScalar(0.9);
    this.mannequin.root.position.set(0, 0.96, 0.12);
    sc.add(this.mannequin.root);
    this.pickables.push(this.mannequin.body);
    this.blanket = bx(1.0, 0.05, 1.05, std(0x9ccfb8, { r: 0.9 }), 0, 1.13, 0.62);
    this.blanket.visible = false;
    sc.add(this.blanket);
    await nextFrame();
    this.progress("Setting up the trolley", 85);
    this.buildTrolley();
    await nextFrame();

    this.applyQuality(this.quality);
    this.ro.observe(this.canvas.parentElement ?? this.canvas);
    this.bindPointer();
    this.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.opts.onContextLost?.(); });
    this.resize();
    this.progress("Ready", 100);
    this.invalidate();
  }

  private buildRoom() {
    const sc = this.scene;
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    if (g) {
      g.fillStyle = "#bfcad0"; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = "#a3b1b9"; g.lineWidth = 3;
      for (let i = 0; i <= 256; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(7, 7);
    tex.anisotropy = 4;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.05 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 0.3); floor.receiveShadow = true;
    sc.add(floor);
    const wallM = () => new THREE.MeshStandardMaterial({ color: 0xdde8ec, roughness: 0.9 });
    const mk = (w: number, h: number, x: number, y: number, z: number, ry: number, rx = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallM());
      m.position.set(x, y, z); m.rotation.y = ry; m.rotation.x = rx; m.receiveShadow = true; sc.add(m);
    };
    mk(6.4, 3.1, 0, 1.55, -2.9, 0);
    mk(6.4, 3.1, -3.2, 1.55, 0.3, Math.PI / 2);
    mk(6.4, 3.1, 3.2, 1.55, 0.3, -Math.PI / 2);
    mk(6.4, 3.1, 0, 1.55, 3.5, Math.PI);
    mk(6.4, 6.4, 0, 3.1, 0.3, 0, Math.PI / 2);
    // skirting + coloured band
    sc.add(bx(6.4, 0.1, 0.03, std(0x9fb2bd), 0, 0.05, -2.88));
    sc.add(bx(0.03, 0.1, 6.4, std(0x9fb2bd), -3.18, 0.05, 0.3));
    sc.add(bx(6.4, 0.12, 0.02, std(0x2a8f8f), 0, 1.3, -2.89));
    // window (emissive daylight)
    sc.add(bx(1.6, 1.1, 0.04, std(0xbfe3ff, { e: 0x7fb8e6 }), -1.2, 1.7, -2.88));
    sc.add(bx(1.7, 0.05, 0.06, std(0xffffff), -1.2, 1.25, -2.86));
    // ceiling lamps
    for (const x of [-0.6, 0.6]) sc.add(bx(0.9, 0.04, 0.35, std(0xffffff, { e: 0xfff6e0 }), x, 3.06, 0.3));
    // sign
    const sg = document.createElement("canvas");
    sg.width = 512; sg.height = 192;
    const sx = sg.getContext("2d");
    if (sx) {
      sx.fillStyle = "#1c6f73"; sx.fillRect(0, 0, 512, 192);
      sx.fillStyle = "#fff"; sx.font = "bold 46px sans-serif"; sx.textAlign = "center";
      sx.fillText("Wash your hands", 256, 84); sx.font = "30px sans-serif"; sx.fillText("before and after every patient", 256, 136);
    }
    const st = new THREE.CanvasTexture(sg);
    st.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.375), new THREE.MeshStandardMaterial({ map: st, roughness: 0.8 }));
    sign.position.set(-3.17, 1.9, 1.9); sign.rotation.y = Math.PI / 2;
    sc.add(sign);
  }

  private reg(key: string, label: string, obj: THREE.Object3D) {
    obj.userData.pick = { kind: "object", key, label } satisfies PickInfo;
    this.roomObjects.set(key, obj);
    this.pickables.push(obj);
    this.scene.add(obj);
  }

  private buildBed() {
    const b = new THREE.Group();
    const frame = std(0xaab4bb, { m: 0.5, r: 0.4 });
    b.add(bx(0.95, 0.1, 2.1, frame, 0, 0.55, 0));
    b.add(bx(0.9, 0.14, 2.0, std(0x5b8fb9, { r: 0.8 }), 0, 0.78, 0));
    b.add(bx(0.95, 0.55, 0.05, std(0xd8c3a5, { r: 0.7 }), 0, 0.95, -1.07));
    b.add(bx(0.95, 0.4, 0.05, std(0xd8c3a5, { r: 0.7 }), 0, 0.85, 1.07));
    b.add(bx(0.55, 0.1, 0.34, std(0xfafafa, { r: 0.9 }), 0, 0.9, -0.74));
    for (const s of [-1, 1]) {
      b.add(bx(0.03, 0.03, 1.1, frame, s * 0.49, 1.02, -0.2));
      b.add(bx(0.03, 0.2, 0.03, frame, s * 0.49, 0.93, -0.7));
      b.add(bx(0.03, 0.2, 0.03, frame, s * 0.49, 0.93, 0.3));
      for (const z of [-0.95, 0.95]) {
        b.add(cy(0.06, 0.06, 0.04, std(0x222222), s * 0.4, 0.1, z));
        b.add(cy(0.015, 0.015, 0.4, frame, s * 0.4, 0.3, z));
      }
    }
    this.reg("bed", "Hospital bed", b);
    // IV stand
    const iv = new THREE.Group();
    iv.add(cy(0.012, 0.012, 1.9, std(0xc7ced4, { m: 0.8, r: 0.3 }), 0, 0.95, 0));
    iv.add(cy(0.2, 0.2, 0.03, std(0x888f95, { m: 0.6 }), 0, 0.02, 0));
    iv.add(bx(0.5, 0.02, 0.02, std(0xc7ced4, { m: 0.8 }), 0, 1.9, 0));
    iv.add(cy(0.05, 0.05, 0.2, std(0xdfeef5, { a: 0.6 }), 0.2, 1.75, 0));
    iv.position.set(-0.85, 0, -0.78);
    this.reg("iv_stand", "IV stand", iv);
  }

  private buildSink() {
    const g = new THREE.Group();
    g.add(bx(0.5, 0.8, 0.75, std(0xf4f4f2), 0.25, 0.4, 0));
    g.add(bx(0.56, 0.05, 0.8, std(0xffffff, { r: 0.2 }), 0.27, 0.825, 0));
    g.add(bx(0.4, 0.02, 0.5, std(0xb7c3cb, { r: 0.2, m: 0.3 }), 0.3, 0.855, 0));
    g.add(cy(0.012, 0.012, 0.2, std(0xc7ced4, { m: 0.9, r: 0.2 }), 0.08, 0.95, 0));
    const spout = cy(0.01, 0.01, 0.16, std(0xc7ced4, { m: 0.9, r: 0.2 }), 0.15, 1.05, 0);
    spout.rotation.z = Math.PI / 2;
    g.add(spout);
    this.water = cy(0.008, 0.008, 0.17, std(0x7ec8ff, { a: 0.6 }), 0.22, 0.96, 0, 8);
    this.water.visible = false;
    g.add(this.water);
    g.add(bx(0.07, 0.18, 0.1, std(0xffffff), 0.04, 1.35, -0.22));
    g.add(bx(0.03, 0.03, 0.05, std(0x7aa6d6), 0.1, 1.42, -0.22));
    g.add(bx(0.1, 0.28, 0.26, std(0xb7c3cb), 0.05, 1.25, 0.27));
    g.position.set(-3.18, 0, 0.8);
    this.reg("sink", "Hand-washing sink", g);
  }

  private buildLocker() {
    const g = new THREE.Group();
    g.add(bx(0.5, 0.8, 0.45, std(0xe8e2d6), 0, 0.4, 0));
    g.add(bx(0.48, 0.003, 0.002, std(0x888888), 0, 0.6, 0.226));
    g.add(bx(0.1, 0.02, 0.02, std(0x888888), 0, 0.7, 0.23));
    g.add(bx(0.1, 0.02, 0.02, std(0x888888), 0, 0.45, 0.23));
    g.position.set(-1.25, 0, -0.5);
    this.reg("locker", "Bedside locker", g);
  }

  private buildBins() {
    const g = new THREE.Group();
    const y = cy(0.17, 0.15, 0.55, std(0xf1c40f), 0, 0.275, 0);
    const yl = cy(0.18, 0.18, 0.03, std(0xc0392b), 0, 0.57, 0);
    const k = cy(0.17, 0.15, 0.55, std(0x2b2f33), 0.45, 0.275, 0);
    const kl = cy(0.18, 0.18, 0.03, std(0x111111), 0.45, 0.57, 0);
    g.add(y, yl, k, kl);
    g.position.set(-2.7, 0, 2.5);
    this.reg("bins", "Waste bins (clinical waste and general)", g);
  }

  private buildCurtains() {
    const mk = (w: number, x: number, z: number, ry: number) => {
      const geo = new THREE.PlaneGeometry(w, 1.95);
      geo.translate(w / 2, 0, 0);
      const m = new THREE.Mesh(geo, std(0x6fa8c7, { a: 0.5, r: 0.9, side: THREE.DoubleSide }));
      m.position.set(x, 1.4, z); m.rotation.y = ry; m.scale.x = 0.06;
      this.scene.add(m);
      this.curtains.push(m);
    };
    mk(3.2, -1.6, 1.75, 0);
    mk(3.05, -1.6, -1.3, -Math.PI / 2);
    mk(3.05, 1.6, -1.3, -Math.PI / 2);
    const rail = std(0xc7ced4, { m: 0.8 });
    this.scene.add(bx(3.2, 0.03, 0.03, rail, 0, 2.42, 1.75), bx(0.03, 0.03, 3.05, rail, -1.6, 2.42, 0.22), bx(0.03, 0.03, 3.05, rail, 1.6, 2.42, 0.22));
  }

  private buildTrolley() {
    const t = new THREE.Group();
    const steel = std(0xc7ced4, { m: 0.8, r: 0.3 });
    t.add(bx(0.95, 0.03, 0.62, steel, 0, 0.85, 0));
    t.add(bx(0.95, 0.03, 0.62, steel, 0, 0.35, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      t.add(cy(0.015, 0.015, 0.85, steel, sx * 0.45, 0.43, sz * 0.28));
      t.add(cy(0.04, 0.04, 0.03, std(0x222222), sx * 0.45, 0.04, sz * 0.28));
    }
    t.position.set(1.55, 0, -0.1);
    this.reg("trolley", "Procedure trolley", t);
    this.trolleyTop.position.set(0, 0.87, 0);
    t.add(this.trolleyTop);
  }

  // ------------------------------------------------------------ procedure content
  load(data: SceneData) {
    this.mannequin.setPose(data.pose, true);
    this.pickables = this.pickables.filter((p) => (p.userData.pick as PickInfo | undefined)?.kind !== "zone");
    this.mannequin.configure({ pregnant: data.pregnant, wound: data.wound, zones: data.zones });
    this.mannequin.zoneMeshes.forEach((m) => this.pickables.push(m));
    this.setEquipment(data.equipment);
    this.setCurtain(false, true);
    this.blanket.visible = false;
    this.selected.clear();
    this.highlight(null);
    this.focus(data.view === "sink" ? "sink" : "patient", true);
    this.invalidate();
  }

  setEquipment(list: EquipInfo[]) {
    this.equipGroups.forEach((g) => {
      this.trolleyTop.remove(g);
      this.pickables = this.pickables.filter((p) => p !== g);
      g.traverse((o) => {
        const me = o as THREE.Mesh;
        me.geometry?.dispose();
        if (me.material) (me.material as THREE.Material).dispose();
      });
    });
    this.equipGroups.clear();
    const cols = 4;
    list.forEach((e, i) => {
      const g = buildEquipment(e.key);
      const col = i % cols, row = Math.floor(i / cols);
      g.position.set(-0.33 + col * 0.22, 0, -0.2 + row * 0.2);
      g.userData.pick = { kind: "equipment", key: e.key, label: e.name } satisfies PickInfo;
      g.userData.home = g.position.clone();
      this.trolleyTop.add(g);
      this.pickables.push(g);
      this.equipGroups.set(e.key, g);
    });
  }

  setSelected(keys: string[]) {
    this.selected = new Set(keys);
    this.equipGroups.forEach((g, k) => {
      const on = this.selected.has(k);
      g.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && "emissive" in m) { m.emissive.setHex(on ? 0x16a34a : 0x000000); m.emissiveIntensity = on ? 0.55 : 1; }
      });
      const home = g.userData.home as THREE.Vector3 | undefined;
      if (home) g.position.y = on ? home.y + 0.05 : home.y;
    });
    this.invalidate();
  }

  setPose(name: string) { this.mannequin.setPose(name, this.reduceMotion); this.invalidate(); }
  setZonesVisible(v: boolean) { this.mannequin.setZonesVisible(v); this.invalidate(); }
  setDressing(on: boolean) { this.mannequin.setDressing(on); this.invalidate(); }
  setCovered(on: boolean) { this.blanket.visible = on; this.invalidate(); }
  addMarker(zoneKey: string, kind: "cuff" | "needle" | "hands" | "device") { this.mannequin.addMarker(zoneKey, kind); this.invalidate(); }
  clearMarkers() { this.mannequin.clearMarkers(); this.invalidate(); }

  setCurtain(closed: boolean, immediate = false) {
    const to = closed ? 1 : 0.06;
    const from = this.curtains.map((c) => c.scale.x);
    if (immediate || this.reduceMotion) { this.curtains.forEach((c) => { c.scale.x = to; }); this.invalidate(); return; }
    this.addTween(900, (p) => this.curtains.forEach((c, i) => { c.scale.x = from[i]! + (to - from[i]!) * p; }));
  }

  playWater(ms = 2200) {
    this.water.visible = true;
    this.invalidate();
    window.setTimeout(() => { if (!this.disposed) { this.water.visible = false; this.invalidate(); } }, ms);
  }

  // ------------------------------------------------------------ camera
  focus(preset: CameraPreset, immediate = false) {
    const p = PRESETS[preset];
    const fromP = this.camera.position.clone(), fromT = this.controls.target.clone();
    const toP = new THREE.Vector3(...p.p), toT = new THREE.Vector3(...p.t);
    if (immediate || this.reduceMotion) { this.camera.position.copy(toP); this.controls.target.copy(toT); this.controls.update(); this.invalidate(); return; }
    this.addTween(800, (k) => {
      const e = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(fromP, toP, e);
      this.controls.target.lerpVectors(fromT, toT, e);
    });
  }

  focusZone(key: string) {
    const w = this.mannequin.zoneWorld(key);
    if (!w) return;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const toT = w.clone();
    const toP = w.clone().add(dir.multiplyScalar(1.3));
    toP.y = Math.max(toP.y, 1.3);
    const fromP = this.camera.position.clone(), fromT = this.controls.target.clone();
    if (this.reduceMotion) { this.camera.position.copy(toP); this.controls.target.copy(toT); this.invalidate(); return; }
    this.addTween(700, (k) => {
      const e = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(fromP, toP, e);
      this.controls.target.lerpVectors(fromT, toT, e);
    });
  }

  // ------------------------------------------------------------ highlight + picking
  highlight(info: { kind: string; key: string } | null) {
    this.hiKey = info;
    if (this.outline) { this.scene.remove(this.outline); this.outline.geometry.dispose(); (this.outline.material as THREE.Material).dispose(); this.outline = null; }
    this.mannequin.zoneMeshes.forEach((m) => {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.color.setHex(0x14b8a6); mat.emissive.setHex(0x0d9488); m.scale.setScalar(1);
    });
    if (!info) { this.invalidate(); return; }
    let obj: THREE.Object3D | undefined;
    if (info.kind === "equipment") obj = this.equipGroups.get(info.key);
    else if (info.kind === "zone") obj = this.mannequin.zoneMeshes.get(info.key);
    else obj = this.roomObjects.get(info.key) ?? (info.key === "patient" ? this.mannequin.body : undefined);
    if (!obj) { this.invalidate(); return; }
    if (info.kind === "zone") {
      const m = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial;
      m.color.setHex(0xfacc15); m.emissive.setHex(0xca8a04); obj.scale.setScalar(1.5);
    }
    const box = new THREE.Box3().setFromObject(obj);
    this.outline = new THREE.Box3Helper(box, new THREE.Color(0xfacc15));
    this.scene.add(this.outline);
    this.pulseUntil = performance.now() + 2500;
    this.invalidate();
  }

  private pickAt(clientX: number, clientY: number): PickInfo | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables.filter((p) => p.visible), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.pick) return o.userData.pick as PickInfo;
        o = o.parent;
      }
    }
    return null;
  }

  private bindPointer() {
    const on = (name: string, fn: (e: PointerEvent) => void) => {
      const h = fn as unknown as EventListener;
      this.canvas.addEventListener(name, h);
      this.handlers.push([name, h]);
    };
    on("pointerdown", (e) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    on("pointerup", (e) => {
      const d = this.down; this.down = null;
      if (!d) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 && performance.now() - d.t < 600) this.opts.onPick(this.pickAt(e.clientX, e.clientY));
    });
    on("pointermove", (e) => {
      if (e.buttons || !this.opts.onHover || this.hoverQueued) return;
      this.hoverQueued = true;
      const { clientX, clientY } = e;
      requestAnimationFrame(() => {
        this.hoverQueued = false;
        if (!this.disposed) this.opts.onHover?.(this.pickAt(clientX, clientY), clientX, clientY);
      });
    });
    on("pointerleave", () => this.opts.onHover?.(null, 0, 0));
  }

  // ------------------------------------------------------------ quality + loop
  applyQuality(q: Quality) {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR[q]));
    const size = SHADOW[q];
    this.renderer.shadowMap.enabled = size > 0;
    this.sun.castShadow = size > 0;
    if (size > 0) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(size, size);
    }
    if (q === "high") {
      if (!this.envTex) this.envTex = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = this.envTex;
    } else this.scene.environment = null;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  private resize() {
    const p = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(160, p.clientWidth), h = Math.max(160, p.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private addTween(dur: number, fn: (p: number) => void, done?: () => void) {
    this.tweens.push({ t0: performance.now(), dur, fn, done });
    this.invalidate();
  }

  invalidate() {
    if (this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    let busy = false;
    this.tweens = this.tweens.filter((t) => {
      const p = Math.min(1, (now - t.t0) / t.dur);
      t.fn(p);
      if (p >= 1) { t.done?.(); return false; }
      return true;
    });
    if (this.tweens.length) busy = true;
    if (this.mannequin.update(dt)) busy = true;
    if (this.controls.update()) busy = true;
    if (now < this.pulseUntil) {
      busy = true;
      if (this.hiKey?.kind === "zone") {
        const z = this.mannequin.zoneMeshes.get(this.hiKey.key);
        if (z) z.scale.setScalar(1.35 + Math.sin(now / 160) * 0.2);
      }
      if (this.outline && this.hiKey) {
        const obj = this.hiKey.kind === "equipment" ? this.equipGroups.get(this.hiKey.key) : this.hiKey.kind === "zone" ? this.mannequin.zoneMeshes.get(this.hiKey.key) : this.roomObjects.get(this.hiKey.key);
        if (obj) this.outline.box.setFromObject(obj);
      }
    }
    this.renderer.render(this.scene, this.camera);
    if (busy) this.invalidate(); else this.last = 0;
  };

  dispose() {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.handlers.forEach(([n, h]) => this.canvas.removeEventListener(n, h));
    this.controls.dispose();
    this.mannequin.dispose();
    this.scene.traverse((o) => {
      const me = o as THREE.Mesh;
      me.geometry?.dispose();
      const m = me.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else if (m) {
        const tm = m as THREE.MeshStandardMaterial;
        tm.map?.dispose();
        m.dispose();
      }
    });
    this.envTex?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
