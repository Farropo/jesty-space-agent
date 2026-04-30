import { restartMissionControlApp } from "../lib/mission_control/service.js";
import { runTrackedMutation } from "../runtime/request_mutations.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

export async function post(context) {
  return runTrackedMutation(context, async () => ({
    operation: await restartMissionControlApp(context, readPayload(context))
  }));
}
