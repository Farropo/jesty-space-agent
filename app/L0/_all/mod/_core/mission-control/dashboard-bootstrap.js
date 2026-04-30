import { ensureMissionControlSpace } from "/mod/_core/mission-control/space-template.js";

async function installMissionControlSpaceForDashboard() {
  try {
    const result = await ensureMissionControlSpace({
      open: false
    });

    window.dispatchEvent(new CustomEvent("space:spaces-changed", {
      detail: {
        reason: "mission-control-bootstrap",
        spaceId: result?.id || "mission-control"
      }
    }));
  } catch (error) {
    console.error("[mission-control] dashboard space bootstrap failed", error);
  }
}

void installMissionControlSpaceForDashboard();
