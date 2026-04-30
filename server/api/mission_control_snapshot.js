import { createMissionControlSnapshot } from "../lib/mission_control/service.js";

export async function get(context) {
  return createMissionControlSnapshot(context);
}

export async function post(context) {
  return createMissionControlSnapshot(context);
}
