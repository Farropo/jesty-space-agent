import { startMissionControlLmStudio } from "../lib/mission_control/service.js";
import { runTrackedMutation } from "../runtime/request_mutations.js";

export async function post(context) {
  return runTrackedMutation(context, async () => ({
    operation: await startMissionControlLmStudio(context)
  }));
}
