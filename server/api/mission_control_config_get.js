import { readMissionControlConfig } from "../lib/mission_control/config.js";

export function get(context) {
  return readMissionControlConfig(context);
}
