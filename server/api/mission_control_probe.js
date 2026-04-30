import { probeMissionControlUrl } from "../lib/mission_control/service.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

export async function post(context) {
  return probeMissionControlUrl(readPayload(context));
}
