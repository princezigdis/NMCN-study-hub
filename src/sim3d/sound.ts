let ctx: AudioContext | null = null;

/** Short feedback tones. Silent unless the learner switches sound on. */
export function tone(kind: "ok" | "bad" | "tick", enabled: boolean): void {
  if (!enabled) return;
  try {
    ctx ??= new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const [f, d] = kind === "ok" ? [880, 0.12] : kind === "bad" ? [180, 0.25] : [520, 0.05];
    o.frequency.value = f;
    o.type = kind === "bad" ? "sawtooth" : "sine";
    g.gain.value = 0.06;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + d);
  } catch { /* audio unavailable */ }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch { return false; }
}

export function autoQuality(): "low" | "medium" | "high" {
  try {
    const saved = localStorage.getItem("sim3d.quality");
    if (saved === "low" || saved === "medium" || saved === "high") return saved;
  } catch { /* storage unavailable */ }
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.deviceMemory ?? 8) <= 2 || (navigator.hardwareConcurrency ?? 8) <= 4) return "low";
  return window.innerWidth <= 820 ? "medium" : "high";
}
