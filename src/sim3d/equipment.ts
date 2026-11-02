import * as THREE from "three";

const mat = (color: number, o: { r?: number; m?: number; a?: number; e?: number } = {}) =>
  new THREE.MeshStandardMaterial({
    color, roughness: o.r ?? 0.55, metalness: o.m ?? 0,
    transparent: o.a !== undefined && o.a < 1, opacity: o.a ?? 1,
    emissive: o.e ?? 0x000000,
  });

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}
/** Cylinder lying along the X axis. */
function cylX(rt: number, rb: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = new THREE.CylinderGeometry(rt, rb, len, 20);
  g.rotateZ(Math.PI / 2);
  return mesh(g, m, x, y, z);
}
const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => mesh(new THREE.BoxGeometry(w, h, d), m, x, y, z);
const group = (...c: THREE.Object3D[]) => { const g = new THREE.Group(); c.forEach((o) => g.add(o)); return g; };

const CLEAR = () => mat(0xdfeef5, { a: 0.55, r: 0.1 });
const STEEL = () => mat(0xc7ced4, { m: 0.85, r: 0.3 });
const WHITE = () => mat(0xf4f4f2);
const BLUE = () => mat(0x3b82c4);
const RED = () => mat(0xc0392b);
const YELLOW = () => mat(0xf1c40f);

function syringe(): THREE.Group {
  return group(cylX(0.011, 0.011, 0.1, CLEAR()), cylX(0.004, 0.004, 0.06, WHITE(), -0.08), box(0.004, 0.036, 0.02, WHITE(), -0.11),
    box(0.004, 0.034, 0.018, WHITE(), 0.045), cylX(0.0025, 0.0025, 0.04, STEEL(), 0.075), cylX(0.006, 0.006, 0.014, BLUE(), 0.056));
}
function glove(sterile: boolean): THREE.Group {
  const c = sterile ? 0xf1ece0 : 0x2f6fb5;
  const g = group(box(0.1, 0.012, 0.13, mat(c, { r: 0.4 }), 0, 0.006, 0.02));
  for (let i = 0; i < 4; i++) g.add(cylX(0.009, 0.007, 0.07, mat(c, { r: 0.4 }), 0, 0.01, -0.03 + i * 0.02).rotateY(Math.PI / 2));
  g.add(box(0.12, 0.016, 0.06, mat(sterile ? 0x7aa6d6 : 0xe8e8e8), 0, 0.008, 0.1));
  return g;
}
function bottle(color: number, h = 0.12, r = 0.032, cap = 0xffffff): THREE.Group {
  return group(mesh(new THREE.CylinderGeometry(r, r, h, 24), mat(color, { a: 0.9, r: 0.2 }), 0, h / 2, 0),
    mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, h * 0.18, 16), mat(cap), 0, h + h * 0.09, 0),
    mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, h * 0.35, 24), mat(0xffffff), 0, h * 0.5, 0));
}
function roll(color: number, r = 0.04): THREE.Group {
  const t = mesh(new THREE.TorusGeometry(r, 0.014, 12, 28), mat(color));
  t.rotation.x = Math.PI / 2;
  t.position.y = 0.016;
  return group(t);
}

const B: Record<string, () => THREE.Group> = {
  soap_dispenser: () => group(box(0.09, 0.16, 0.06, WHITE(), 0, 0.08, 0), box(0.02, 0.02, 0.05, mat(0x7aa6d6), 0, 0.12, 0.05)),
  hand_rub: () => bottle(0x9fd3e8, 0.16, 0.03, 0x1b6ca8),
  gloves_clean: () => glove(false),
  gloves_sterile: () => {
    const inner = glove(true);
    inner.position.y = 0.015;
    inner.scale.setScalar(0.8);
    return group(box(0.12, 0.014, 0.16, mat(0xe9edf2), 0, 0.007, 0), inner);
  },
  stethoscope: () => {
    const torus = mesh(new THREE.TorusGeometry(0.07, 0.006, 8, 36, Math.PI * 1.7), mat(0x222222), 0, 0.075, 0);
    torus.rotation.x = Math.PI / 2;
    return group(torus, mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 24), STEEL(), 0, 0.006, 0.08), cylX(0.004, 0.004, 0.1, mat(0x222222), 0, 0.01, 0.04));
  },
  bp_cuff: () => {
    const gauge = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.015, 24), mat(0xf4f4f2), 0.1, 0.02, 0);
    const bulb = mesh(new THREE.SphereGeometry(0.03, 16, 12), mat(0x222222), -0.1, 0.025, 0.04);
    bulb.scale.set(1.3, 0.9, 0.9);
    return group(box(0.17, 0.02, 0.07, mat(0x4a5d73), 0, 0.012, 0), gauge, bulb);
  },
  alcohol_swab: () => group(box(0.05, 0.004, 0.05, mat(0xdfe9f2), 0, 0.003, 0), box(0.035, 0.005, 0.035, WHITE(), 0, 0.006, 0)),
  syringe,
  needle: () => group(cylX(0.0025, 0.0025, 0.04, STEEL(), 0, 0.006, 0), cylX(0.008, 0.008, 0.012, mat(0x2e9e62), -0.026, 0.006, 0), box(0.07, 0.01, 0.025, mat(0xdfeef5, { a: 0.5 }), 0, 0.005, 0)),
  ampoule: () => {
    const g = group(cylX(0.011, 0.011, 0.06, CLEAR(), 0, 0.011, 0), mesh(new THREE.SphereGeometry(0.011, 12, 8), CLEAR(), 0.03, 0.011, 0), cylX(0.005, 0.005, 0.02, CLEAR(), -0.04, 0.011, 0));
    g.add(cylX(0.0112, 0.0112, 0.022, mat(0xf3d36b, { a: 0.8 }), 0, 0.011, 0));
    return g;
  },
  sharps_box: () => group(box(0.12, 0.13, 0.1, YELLOW(), 0, 0.065, 0), box(0.125, 0.02, 0.105, RED(), 0, 0.14, 0), box(0.06, 0.004, 0.012, mat(0x111111), 0, 0.151, 0)),
  kidney_dish: () => {
    const m = mesh(new THREE.SphereGeometry(0.06, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(0xc7ced4, { m: 0.85, r: 0.3 }), 0, 0.03, 0);
    m.scale.set(1.5, 0.5, 0.8);
    (m.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    return group(m);
  },
  dressing_pack: () => group(box(0.13, 0.025, 0.1, mat(0x4aa3d8), 0, 0.012, 0), box(0.1, 0.002, 0.07, WHITE(), 0, 0.026, 0)),
  saline: () => bottle(0xbfe3f2, 0.14, 0.03, 0x2b79b8),
  tape: () => roll(0xefe7d4),
  waste_bag: () => {
    const m = mesh(new THREE.SphereGeometry(0.07, 16, 12), mat(0xf1c40f, { r: 0.8 }), 0, 0.06, 0);
    m.scale.set(1, 0.9, 0.9);
    return group(m, mesh(new THREE.CylinderGeometry(0.01, 0.02, 0.05, 10), mat(0xf1c40f), 0, 0.14, 0));
  },
  catheter_set: () => {
    const tube = mesh(new THREE.TorusGeometry(0.05, 0.004, 8, 28), mat(0xe9d58a), 0, 0.045, 0);
    tube.rotation.x = Math.PI / 2;
    return group(box(0.16, 0.035, 0.11, mat(0xdfe9f2), 0, 0.018, 0), box(0.06, 0.05, 0.01, mat(0xf1c40f), 0.05, 0.06, 0.03), tube);
  },
  antiseptic: () => bottle(0x8a4b17, 0.13, 0.03, 0xe0e0e0),
  lubricant: () => group(cylX(0.014, 0.014, 0.1, mat(0x7bb8e0), 0, 0.014, 0), cylX(0.006, 0.006, 0.014, WHITE(), 0.056, 0.014, 0)),
  drape: () => group(box(0.18, 0.004, 0.14, mat(0x2e9e8a), 0, 0.003, 0), box(0.03, 0.005, 0.03, mat(0x1d6f62), 0, 0.007, 0)),
  pinard: () => {
    const horn = mesh(new THREE.CylinderGeometry(0.012, 0.045, 0.16, 24, 1, true), mat(0xb8b8b0, { m: 0.2 }), 0, 0.045, 0);
    (horn.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    horn.rotation.z = Math.PI / 2;
    return group(horn);
  },
  tape_measure: () => group(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 24), YELLOW(), 0, 0.012, 0), box(0.14, 0.002, 0.014, YELLOW(), 0.1, 0.003, 0)),
  oxytocin: () => B.ampoule!(),
  cord_clamp: () => group(box(0.06, 0.012, 0.02, WHITE(), 0, 0.006, 0), box(0.02, 0.02, 0.02, mat(0xcfd8dc), 0.02, 0.014, 0)),
  scissors: () => {
    const a = box(0.1, 0.004, 0.012, STEEL(), 0.02, 0.006, -0.004);
    const b = box(0.1, 0.004, 0.012, STEEL(), 0.02, 0.01, 0.004);
    a.rotation.y = 0.12; b.rotation.y = -0.12;
    return group(a, b, mesh(new THREE.TorusGeometry(0.012, 0.003, 6, 16), STEEL(), -0.04, 0.008, -0.01), mesh(new THREE.TorusGeometry(0.012, 0.003, 6, 16), STEEL(), -0.04, 0.012, 0.012));
  },
  thermometer: () => group(cylX(0.005, 0.005, 0.12, mat(0xe9eef2), 0, 0.006, 0), box(0.025, 0.006, 0.014, mat(0x223344), -0.03, 0.013, 0)),
  pulse_oximeter: () => group(box(0.06, 0.03, 0.035, mat(0x2b3a4a), 0, 0.016, 0), box(0.02, 0.004, 0.012, mat(0x3be37f, { e: 0x0b4d28 }), 0, 0.034, 0)),
  iv_cannula: () => group(cylX(0.004, 0.004, 0.05, mat(0x2e9e62), 0.02, 0.006, 0), box(0.02, 0.006, 0.03, mat(0xfafafa), -0.012, 0.004, 0), box(0.02, 0.01, 0.012, mat(0x2e9e62), -0.02, 0.01, 0)),
  towel: () => group(box(0.1, 0.03, 0.08, WHITE(), 0, 0.015, 0), box(0.102, 0.002, 0.082, mat(0xe6e6e6), 0, 0.02, 0)),
  clean_cloth: () => group(box(0.08, 0.012, 0.08, WHITE(), 0, 0.006, 0), box(0.08, 0.012, 0.08, mat(0xfbfbfb), 0.004, 0.018, 0.004)),
};

export function buildEquipment(key: string): THREE.Group {
  const f = B[key];
  if (f) {
    const g = f();
    g.scale.multiplyScalar(1.5);
    return g;
  }
  // unknown key: neutral labelled block so an unrecognised item still works
  const g = group(box(0.08, 0.04, 0.08, mat(0xb0b8c0), 0, 0.02, 0));
  g.scale.multiplyScalar(1.5);
  return g;
}
