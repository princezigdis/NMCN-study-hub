export type Quality = "low" | "medium" | "high";

export interface SceneZone { key: string; label: string; explain: string }
export interface ScenePosition { key: string; label: string; why: string }
export interface SceneAction { key: string; label: string; group: string }
export interface EquipInfo {
  key: string; name: string; category?: string; description?: string; purpose?: string;
  how_to_use?: string; precautions?: string; infection_notes?: string; mistakes?: string;
}
export interface SceneData {
  pose: string; positions: ScenePosition[]; zones: SceneZone[]; actions: SceneAction[];
  equipment: EquipInfo[]; pregnant: boolean; wound: boolean; view: string;
}
export interface PickInfo { kind: "equipment" | "zone" | "object"; key: string; label: string }
export type CameraPreset = "overview" | "patient" | "head" | "foot" | "top" | "sink" | "trolley";
