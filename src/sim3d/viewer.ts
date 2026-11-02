import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildEquipment } from "./equipment";

/** Small rotating viewer for one equipment item (equipment library). */
export class ItemViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.01, 10);
  private controls: OrbitControls;
  private raf = 0;
  private disposed = false;
  private ro: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement, key: string) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.4));
    const d = new THREE.DirectionalLight(0xffffff, 2.2);
    d.position.set(1, 2, 1.5);
    this.scene.add(d);
    const item = buildEquipment(key);
    const box = new THREE.Box3().setFromObject(item);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    item.position.sub(center);
    const holder = new THREE.Group();
    holder.add(item);
    const s = 0.28 / Math.max(size.x, size.y, size.z, 0.01);
    holder.scale.setScalar(s);
    this.scene.add(holder);
    this.camera.position.set(0.3, 0.25, 0.4);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 2.2;
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 1.2;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();
    const loop = () => {
      if (this.disposed) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  private resize() {
    const p = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(120, p.clientWidth), h = Math.max(120, p.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const me = o as THREE.Mesh;
      me.geometry?.dispose();
      if (me.material) (me.material as THREE.Material).dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
