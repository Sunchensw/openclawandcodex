import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";

const HOST = process.env.CODEX_SIDECAR_HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.CODEX_SIDECAR_PORT || "3790", 10);
const CWD = (process.env.CODEX_BRIDGE_CWD || "D:\\openclaw").trim();
const TIMEOUT_MS = Number.parseInt(process.env.CODEX_BRIDGE_TIMEOUT_MS || "600000", 10);
const CODEX_EXECUTABLE = (process.env.CODEX_BRIDGE_CODEX_EXE || "C:\\Users\\15842\\.codex\\.sandbox-bin\\codex.exe").trim();
const CODEX_HOME = (process.env.CODEX_BRIDGE_CODEX_HOME || "C:\\Users\\15842\\.codex").trim();
const SANDBOX_MODE = (process.env.CODEX_BRIDGE_SANDBOX || "workspace-write").trim();

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function buildExecutorInput(task) {
  const metadata = task.metadata && typeof task.metadata === "object" ? task.metadata : {};
  const sections = [
    "OpenClaw delegated this task to Codex.",
    "",
    `Session: ${task.sessionKey || "unknown"}`,
    `Channel: ${task.channelId || "unknown"}`,
    task.messageId ? `Message ID: ${task.messageId}` : "",
    "",
    "User task:",
    String(task.prompt || "").trim(),
    "",
    "Metadata:",
    JSON.stringify(metadata, null, 2),
    "",
    "Return only the final user-facing reply."
  ];
  return sections.filter(Boolean).join("\n");
}

async function runCodex(input, cwd, timeoutMs) {
  await mkdir(CODEX_HOME, { recursive: true });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-sidecar-"));
  const outputFile = path.join(tempDir, "last-message.txt");
  const args = [
    "exec",
    "-C",
    cwd,
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    SANDBOX_MODE,
    "--output-last-message",
    outputFile,
    "-"
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(CODEX_EXECUTABLE, args, {
      cwd: CODEX_HOME,
      env: {
        ...process.env,
        CODEX_HOME,
        CODEX_TASK_PROMPT: input
      },
      shell: false,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`executor timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      (async () => {
        let lastMessage = "";
        try {
          lastMessage = (await readFile(outputFile, "utf8")).trim();
        } catch {
          lastMessage = "";
        } finally {
          await rm(tempDir, { recursive: true, force: true });
        }

        const payload = {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          lastMessage,
          code
        };

        if (code !== 0) {
          reject(Object.assign(new Error(payload.stderr || payload.stdout || `executor exited with code ${code}`), { details: payload }));
          return;
        }
        resolve(payload);
      })().catch(reject);
    });

    if (child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      json(res, 200, {
        ok: true,
        adapter: "codex-exec",
        executable: CODEX_EXECUTABLE,
        codexHome: CODEX_HOME,
        cwd: CWD,
        sandbox: SANDBOX_MODE
      });
      return;
    }

    if (req.method === "POST" && req.url === "/run") {
      const task = await readJson(req);
      const input = buildExecutorInput(task);
      const result = await runCodex(input, CWD, TIMEOUT_MS);
      json(res, 200, {
        ok: true,
        reply: result.lastMessage || result.stdout || result.stderr || ""
      });
      return;
    }

    json(res, 404, {
      ok: false,
      error: "not found"
    });
  } catch (error) {
    const details = error && typeof error === "object" && "details" in error ? error.details : undefined;
    json(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      details
    });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`codex-sidecar listening on http://${HOST}:${PORT}\n`);
  process.stdout.write(`codex executable: ${CODEX_EXECUTABLE}\n`);
  process.stdout.write(`codex home: ${CODEX_HOME}\n`);
  process.stdout.write(`sandbox mode: ${SANDBOX_MODE}\n`);
});

