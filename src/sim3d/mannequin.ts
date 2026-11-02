import * as THREE from "three";
import type { SceneZone, PickInfo } from "./types";

interface Target { flip: number; torso: number; hip: number; abd: number; knee: number }
const POSES: Record<string, Target> = {
  supine: { flip: 0, torso: 0, hip: 0, abd: 0.06, knee: 0 },
  prone: { flip: Math.PI, torso: 0, hip: 0, abd: 0.06, knee: 0 },
  lateral: { flip: -Math.PI / 2, torso: 0, hip: 0.5, abd: 0.05, knee: 0.7 },
  sitting: { flip: 0, torso: 1.35, hip: 0, abd: 0.06, knee: 0.08 },
  fowlers: { flip: 0, torso: 0.8, hip: 0, abd: 0.06, knee: 0.05 },
  dorsal_recumbent: { flip: 0, torso: 0, hip: 0.85, abd: 0.14, knee: 1.4 },
  lithotomy: { flip: 0, torso: 0, hip: 1.35, abd: 0.5, knee: 1.1 },
};

type Parent = "root" | "torso" | "thighR" | "thighL" | "shinR" | "shinL";
/** Positions are local to the parent group, in the supine frame (head toward -Z, front toward +Y, patient's right toward -X). */
const ANCHORS: Record<string, [Parent, number, number, number]> = {
  upper_arm_right: ["torso", -0.26, 0.07, -0.36], upper_arm_left: ["torso", 0.26, 0.07, -0.36],
  forearm_right: ["torso", -0.26, 0.06, -0.12], forearm_left: ["torso", 0.26, 0.06, -0.12],
  deltoid_right: ["torso", -0.27, 0.06, -0.5], deltoid_left: ["torso", 0.27, 0.06, -0.5],
  abdomen: ["torso", 0, 0.12, -0.1], abdomen_upper: ["torso", 0, 0.12, -0.3], epigastrium: ["torso", 0, 0.12, -0.3],
  uterus_fundus: ["torso", 0, 0.13, -0.16],
  ventrogluteal_right: ["root", -0.18, 0.02, 0], ventrogluteal_left: ["root", 0.18, 0.02, 0],
  dorsogluteal_right: ["root", -0.09, -0.1, 0.04], dorsogluteal_left: ["root", 0.09, -0.1, 0.04],
  meatus: ["root", 0, 0.03, 0.115], vaginal_opening: ["root", 0, -0.02, 0.13],
  suprapubic: ["root", 0, 0.19, -0.02], pelvic_brim: ["root", 0, 0.155, 0.04],
  fundus: ["root", 0, 0.18, -0.3], lateral_right: ["root", -0.185, 0.1, -0.15], lateral_left: ["root", 0.185, 0.1, -0.15],
  thigh_right: ["thighR", -0.075, 0.02, 0.2], thigh_left: ["thighL", 0.075, 0.02, 0.2],
  vastus_right: ["thighR", -0.075, 0.02, 0.25], vastus_left: ["thighL", 0.075, 0.02, 0.25],
  wound: ["shinL", 0, 0.055, 0.18], leg_right: ["shinR", 0, 0.055, 0.18], leg_left: ["shinL", 0, 0.055, 0.18],
};

const skin = () => new THREE.MeshStandardMaterial({ color: 0xe0c9b3, roughness: 0.55, metalness: 0.02 });
const SKIN = skin();
const JOINT = new THREE.MeshStandardMaterial({ color: 0xb9a590, roughness: 0.5 });

function part(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}
function capsuleZ(r: number, len: number, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1): THREE.Mesh {
  const g = new THREE.CapsuleGeometry(r, len, 8, 20);
  g.rotateX(Math.PI / 2);
  const me = part(g, m, x, y, z);
  me.scale.set(sx, sy, 1);
  return me;
}

export class Mannequin {
  readonly root = new THREE.Group();
  readonly zoneMeshes = new Map<string, THREE.Mesh>();
  readonly body: THREE.Group;
  private torso = new THREE.Group();
  private thighR = new THREE.Group();
  private thighL = new THREE.Group();
  private shinR = new THREE.Group();
  private shinL = new THREE.Group();
  private bump: THREE.Mesh;
  private wound: THREE.Mesh;
  private dressing: THREE.Mesh;
  private cur: Target = { ...POSES.supine! };
  private tgt: Target = { ...POSES.supine! };
  private markers: THREE.Object3D[] = [];

  constructor() {
    const r = this.root;
    this.body = new THREE.Group();
    this.body.userData.pick = { kind: "object", key: "patient", label: "Patient (training manikin)" } satisfies PickInfo;
    r.add(this.body);

    this.body.add(part(new THREE.SphereGeometry(1, 24, 16), SKIN, 0, 0, 0.0));
    const pelvis = this.body.children[0] as THREE.Mesh;
    pelvis.scale.set(0.17, 0.11, 0.13);

    this.torso.position.set(0, 0, -0.05);
    this.body.add(this.torso);
    this.torso.add(
      capsuleZ(0.12, 0.2, SKIN, 0, 0, -0.15, 1.3, 0.85),
      capsuleZ(0.14, 0.18, SKIN, 0, 0.005, -0.4, 1.35, 0.85),
      part(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 16).rotateX(Math.PI / 2), SKIN, 0, 0, -0.63),
      part(new THREE.SphereGeometry(0.105, 28, 20), SKIN, 0, 0.0, -0.78),
    );
    const head = this.torso.children[3] as THREE.Mesh;
    head.scale.set(0.9, 1, 1.12);
    const nose = part(new THREE.ConeGeometry(0.018, 0.04, 12), SKIN, 0, 0.1, -0.78);
    this.torso.add(nose);
    for (const s of [-1, 1]) {
      this.torso.add(part(new THREE.SphereGeometry(0.02, 10, 8), SKIN, s * 0.1, 0, -0.78));
      this.torso.add(part(new THREE.SphereGeometry(0.075, 16, 12), JOINT, s * 0.2, 0, -0.5));
      this.torso.add(capsuleZ(0.045, 0.16, SKIN, s * 0.26, 0, -0.34));
      this.torso.add(capsuleZ(0.04, 0.15, SKIN, s * 0.26, 0, -0.1));
      const hand = part(new THREE.SphereGeometry(0.045, 12, 10), SKIN, s * 0.26, 0, 0.04);
      hand.scale.set(0.85, 0.5, 1.3);
      this.torso.add(hand);
    }

    this.pregnantBump();
    this.bump = this.body.children[this.body.children.length - 1] as THREE.Mesh;

    for (const [g, x] of [[this.thighR, -0.1], [this.thighL, 0.1]] as const) {
      g.position.set(x, 0, 0.02);
      g.rotation.order = "YXZ";
      g.add(capsuleZ(0.07, 0.28, SKIN, 0, 0, 0.21));
      g.add(part(new THREE.SphereGeometry(0.06, 14, 10), JOINT, 0, 0, 0.42));
      this.body.add(g);
    }
    for (const [sh, th] of [[this.shinR, this.thighR], [this.shinL, this.thighL]] as const) {
      sh.position.set(0, 0, 0.42);
      sh.add(capsuleZ(0.05, 0.3, SKIN, 0, 0, 0.2));
      const foot = part(new THREE.BoxGeometry(0.09, 0.05, 0.16), SKIN, 0, -0.01, 0.46);
      sh.add(foot);
      th.add(sh);
    }

    this.wound = part(new THREE.CylinderGeometry(0.035, 0.035, 0.006, 20), new THREE.MeshStandardMaterial({ color: 0x9b1c1c, roughness: 0.3 }), 0, 0.052, 0.18);
    this.wound.visible = false;
    this.shinL.add(this.wound);
    this.dressing = part(new THREE.BoxGeometry(0.11, 0.012, 0.13), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), 0, 0.058, 0.18);
    this.dressing.visible = false;
    this.shinL.add(this.dressing);

    this.apply();
  }

  private pregnantBump() {
    const m = part(new THREE.SphereGeometry(1, 28, 20), SKIN, 0, 0.07, -0.15);
    m.scale.set(0.19, 0.15, 0.22);
    m.visible = false;
    this.body.add(m);
  }

  private parentOf(p: Parent): THREE.Object3D {
    switch (p) {
      case "torso": return this.torso;
      case "thighR": return this.thighR;
      case "thighL": return this.thighL;
      case "shinR": return this.shinR;
      case "shinL": return this.shinL;
      default: return this.body;
    }
  }

  configure(opts: { pregnant: boolean; wound: boolean; zones: SceneZone[] }) {
    this.bump.visible = opts.pregnant;
    this.wound.visible = opts.wound;
    this.dressing.visible = false;
    this.clearMarkers();
    this.zoneMeshes.forEach((m) => { m.parent?.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); });
    this.zoneMeshes.clear();
    opts.zones.forEach((z, i) => {
      const a = ANCHORS[z.key];
      const parent = a ? this.parentOf(a[0]) : this.torso;
      const pos = a ? new THREE.Vector3(a[1], a[2], a[3]) : new THREE.Vector3(((i % 5) - 2) * 0.08, 0.13, -0.1 - Math.floor(i / 5) * 0.1);
      const mat = new THREE.MeshStandardMaterial({ color: 0x14b8a6, emissive: 0x0d9488, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, roughness: 0.3, depthWrite: false });
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.034, 16, 12), mat);
      m.position.copy(pos);
      m.userData.pick = { kind: "zone", key: z.key, label: z.label } satisfies PickInfo;
      m.renderOrder = 5;
      parent.add(m);
      this.zoneMeshes.set(z.key, m);
    });
  }

  setZonesVisible(v: boolean) { this.zoneMeshes.forEach((m) => { m.visible = v; }); }

  zoneWorld(key: string): THREE.Vector3 | null {
    const m = this.zoneMeshes.get(key);
    if (!m) return null;
    return m.getWorldPosition(new THREE.Vector3());
  }

  setDressing(on: boolean) { this.dressing.visible = on; }

  addMarker(zoneKey: string, kind: "cuff" | "needle" | "hands" | "device"): void {
    const z = this.zoneMeshes.get(zoneKey);
    if (!z) return;
    let o: THREE.Object3D;
    if (kind === "cuff") {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.11, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x3b6ea5, roughness: 0.7, side: THREE.DoubleSide }));
      c.rotation.x = Math.PI / 2;
      o = c;
    } else if (kind === "needle") {
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0xc7ced4, metalness: 0.8, roughness: 0.3 }));
      n.position.y = 0.06;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0xdfeef5, transparent: true, opacity: 0.7 }));
      barrel.position.y = 0.17;
      o = new THREE.Group();
      o.add(n, barrel);
    } else {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), new THREE.MeshStandardMaterial({ color: 0x2f6fb5, roughness: 0.4 }));
      h.scale.set(1.2, 0.5, 1.6);
      o = h;
    }
    o.position.copy(z.position);
    z.parent?.add(o);
    this.markers.push(o);
  }

  clearMarkers() {
    this.markers.forEach((m) => {
      m.parent?.remove(m);
      m.traverse((c) => {
        const me = c as THREE.Mesh;
        if (me.geometry) me.geometry.dispose();
        if (me.material) (me.material as THREE.Material).dispose();
      });
    });
    this.markers = [];
  }

  setPose(name: string, immediate = false) {
    const t = POSES[name] ?? POSES.supine!;
    this.tgt = { ...t };
    if (immediate) { this.cur = { ...t }; this.apply(); }
  }

  /** @returns true while still moving. */
  update(dt: number): boolean {
    const k = Math.min(1, dt * 5);
    let moving = false;
    (Object.keys(this.tgt) as Array<keyof Target>).forEach((key) => {
      const d = this.tgt[key] - this.cur[key];
      if (Math.abs(d) > 0.002) { this.cur[key] += d * k; moving = true; } else this.cur[key] = this.tgt[key];
    });
    this.apply();
    return moving;
  }

  private apply() {
    const c = this.cur;
    this.body.rotation.z = c.flip;
    this.torso.rotation.x = c.torso;
    this.thighR.rotation.set(-c.hip, -c.abd, 0);
    this.thighL.rotation.set(-c.hip, c.abd, 0);
    this.shinR.rotation.x = c.knee;
    this.shinL.rotation.x = c.knee;
  }

  dispose() {
    this.clearMarkers();
    this.root.traverse((o) => {
      const me = o as THREE.Mesh;
      if (me.geometry) me.geometry.dispose();
    });
    this.zoneMeshes.forEach((m) => (m.material as THREE.Material).dispose());
  }
}
