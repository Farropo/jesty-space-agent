import { writeMissionControlConfig } from "../lib/mission_control/config.js";
import { runTrackedMutation } from "../runtime/request_mutations.js";

function readPayload(context) {
  return context.body && typeof context.body === "object" && !Buffer.isBuffer(context.body)
    ? context.body
    : {};
}

export async function post(context) {
  const payload = readPayload(context);
  const config = payload.config && typeof payload.config === "object" ? payload.config : payload;

  return runTrackedMutation(context, async () => writeMissionControlConfig(context, config));
}
