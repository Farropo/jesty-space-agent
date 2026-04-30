export const MISSION_CONTROL_SPACE_ID = "mission-control";
export const MISSION_CONTROL_TEMPLATE_VERSION = "mission-control-static-v1";

const TEMPLATE_ROOT = "/mod/_core/mission-control/space-template";
const TEMPLATE_VERSION_PATH = "data/template-version.txt";
const TEMPLATE_FILES = [
  "space.yaml",
  "widgets/system.yaml",
  "widgets/localhost.yaml",
  "widgets/lm-studio.yaml",
  "widgets/codex.yaml",
  "widgets/ports.yaml",
  "widgets/sqlite.yaml"
];

async function pathExists(path) {
  try {
    await globalThis.space.api.fileInfo(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(path) {
  try {
    const result = await globalThis.space.api.fileRead(path);
    return String(result?.content || "");
  } catch {
    return "";
  }
}

async function readTemplateFile(relativePath) {
  const response = await fetch(`${TEMPLATE_ROOT}/${relativePath}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Unable to read Mission Control Space template ${relativePath}: HTTP ${response.status}`);
  }

  return response.text();
}

async function buildTemplateWrites(rootPath) {
  const files = await Promise.all(
    TEMPLATE_FILES.map(async (relativePath) => ({
      content: await readTemplateFile(relativePath),
      path: `${rootPath}${relativePath}`
    }))
  );

  files.push({
    content: `${MISSION_CONTROL_TEMPLATE_VERSION}\n`,
    path: `${rootPath}${TEMPLATE_VERSION_PATH}`
  });

  return files;
}

export async function ensureMissionControlSpace(options = {}) {
  if (!globalThis.space?.api?.fileWrite) {
    throw new Error("space.api.fileWrite is not available.");
  }

  const rootPath = `~/spaces/${MISSION_CONTROL_SPACE_ID}/`;
  const manifestPath = `${rootPath}space.yaml`;
  const templateVersion = (await readTextFile(`${rootPath}${TEMPLATE_VERSION_PATH}`)).trim();
  const shouldWrite =
    options.reset === true ||
    !(await pathExists(manifestPath)) ||
    templateVersion !== MISSION_CONTROL_TEMPLATE_VERSION;

  if (shouldWrite) {
    await globalThis.space.api.fileWrite({
      files: await buildTemplateWrites(rootPath)
    });
  }

  if (options.open === false) {
    return {
      id: MISSION_CONTROL_SPACE_ID,
      installed: shouldWrite,
      path: rootPath
    };
  }

  await import("/mod/_core/spaces/store.js");

  if (!globalThis.space?.spaces?.openSpace) {
    throw new Error("space.spaces.openSpace is not available.");
  }

  return globalThis.space.spaces.openSpace(MISSION_CONTROL_SPACE_ID, {
    replace: options.replace === true
  });
}
