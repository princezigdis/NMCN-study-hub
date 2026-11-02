import { rpc } from "./api";
import type { J } from "./lab";

export const sim3d = {
  list: () => rpc<J>("sim3d_list"),
  get: (id: string) => rpc<J>("sim3d_get", { p_id: id }),
  equipment: () => rpc<J[]>("sim3d_equipment_list"),
  start: (id: string, mode: "guided" | "practice" | "exam") => rpc<string>("sim3d_start", { p_id: id, p_mode: mode }),
  session: (attempt: string) => rpc<J>("sim3d_session", { p_attempt: attempt }),
  act: (attempt: string, action: Record<string, unknown>) => rpc<J>("sim3d_act", { p_attempt: attempt, p_action: action }),
  finish: (attempt: string) => rpc<J>("sim3d_finish", { p_attempt: attempt }),
  challenges: (id: string) => rpc<J[]>("sim3d_challenges", { p_id: id }),
  challengeCheck: (id: string, challenge: string, selected: string[]) => rpc<J>("sim3d_challenge_check", { p_id: id, p_challenge: challenge, p_selected: selected }),
  history: () => rpc<J>("sim3d_history"),
  admin: {
    list: () => rpc<J>("sim3d_admin_list"),
    save: (kind: "procedure" | "equipment", row: Record<string, unknown>) => rpc<string>("sim3d_admin_save", { p_kind: kind, p_row: row }),
    status: (kind: "procedure" | "equipment", id: string, status: string) => rpc<void>("sim3d_admin_status", { p_kind: kind, p_id: id, p_status: status }),
    analytics: () => rpc<J>("sim3d_analytics"),
  },
};
