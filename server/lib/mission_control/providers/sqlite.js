import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { execFileAsync, providerResult } from "./common.js";

const SQLITE_DISCOVERY_LIMIT = 80;
const SQLITE_INSPECT_LIMIT = 10;

async function findSqliteFiles() {
  const roots = [];
  const repositoriesDir = path.resolve(os.homedir(), "..", "..", "repositories");

  roots.push(process.cwd());
  roots.push(path.join(os.homedir(), "Documents"));
  roots.push(repositoriesDir);

  const seenRoots = [...new Set(roots)];
  const sqliteFiles = [];
  const extensions = new Set([".db", ".sqlite", ".sqlite3"]);

  async function walk(dir, depth) {
    if (sqliteFiles.length >= SQLITE_DISCOVERY_LIMIT || depth > 5) {
      return;
    }

    let entries;

    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (sqliteFiles.length >= SQLITE_DISCOVERY_LIMIT) {
        return;
      }

      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__") {
        continue;
      }

      const absolutePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath, depth + 1);
        continue;
      }

      if (!entry.isFile() || !extensions.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      try {
        const stat = await fs.stat(absolutePath);
        sqliteFiles.push({
          modifiedAt: stat.mtime.toISOString(),
          path: absolutePath,
          sizeBytes: stat.size
        });
      } catch {
        // Ignore disappearing files.
      }
    }
  }

  for (const root of seenRoots) {
    await walk(root, 0);
  }

  return sqliteFiles;
}

async function inspectSqliteFile(filePath) {
  const script = [
    "import json, sqlite3, sys",
    "p = sys.argv[1]",
    "out = {'tables': [], 'ok': False, 'error': ''}",
    "try:",
    "  con = sqlite3.connect('file:' + p + '?mode=ro', uri=True, timeout=1)",
    "  cur = con.execute(\"select name, type from sqlite_master where type in ('table','view') and name not like 'sqlite_%' order by name limit 50\")",
    "  for name, typ in cur.fetchall():",
    "    cols = []",
    "    try:",
    "      cols = [r[1] for r in con.execute('pragma table_info(' + json.dumps(name) + ')').fetchall()]",
    "    except Exception:",
    "      cols = []",
    "    out['tables'].append({'name': name, 'type': typ, 'columns': cols[:24]})",
    "  out['ok'] = True",
    "  con.close()",
    "except Exception as e:",
    "  out['error'] = str(e)",
    "print(json.dumps(out))"
  ].join("\n");

  for (const executable of ["python", "py"]) {
    try {
      const result = await execFileAsync(executable, ["-c", script, filePath], {
        maxBuffer: 512 * 1024,
        timeout: 1500,
        windowsHide: true
      });
      return JSON.parse(String(result.stdout || "{}"));
    } catch {
      // Try next Python launcher.
    }
  }

  return {
    error: "Python sqlite3 inspector is not available.",
    ok: false,
    tables: []
  };
}

export async function collectSqlite() {
  try {
    const files = await findSqliteFiles();
    const inspected = [];

    for (const file of files.slice(0, SQLITE_INSPECT_LIMIT)) {
      inspected.push({
        ...file,
        inspection: await inspectSqliteFile(file.path)
      });
    }

    return providerResult("sqlite", "available", {
      files,
      inspected
    });
  } catch (error) {
    return providerResult("sqlite", "degraded", {
      files: [],
      inspected: []
    }, error.message);
  }
}
