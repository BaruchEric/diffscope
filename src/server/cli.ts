// src/server/cli.ts
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { startHttpServer } from "./http";

function findRepoRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function pickPort(): Promise<number> {
  // Bun.serve with port: 0 → random free port; probe via a short-lived server
  const probe = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = probe.port;
  probe.stop(true);
  if (typeof port !== "number") {
    throw new Error("failed to acquire a free port");
  }
  return port;
}

function openBrowser(url: string): void {
  spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
}

function staticDirForMode(): string {
  return resolve(import.meta.dir, "..", "..", "dist", "web");
}

const HELP = `diffscope — a local, read-only, live git diff viewer

Usage:
  diffscope [path]        open the enclosing repo of [path] (or CWD if omitted)
  diffscope -h, --help    show this help
  diffscope -v, --version show version

Environment:
  DIFFSCOPE_DEV_PORT      pin a fixed backend port (otherwise random)

Once running, open the URL diffscope prints in your browser. If [path] is
not inside a git repo, diffscope opens its picker UI so you can navigate
to one.`;

export async function main(argv: readonly string[]): Promise<void> {
  const arg = argv[0];

  if (arg === "-h" || arg === "--help") {
    console.log(HELP);
    return;
  }
  if (arg === "-v" || arg === "--version") {
    const pkg = await import("../../package.json", { with: { type: "json" } });
    console.log(`diffscope ${(pkg as { default: { version: string } }).default.version}`);
    return;
  }

  let repoPath: string | null = null;

  if (arg) {
    const abs = isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
    if (!existsSync(abs)) {
      console.error(`diffscope: path does not exist: ${abs}`);
      process.exit(1);
    }
    const found = findRepoRoot(abs);
    repoPath = found; // null → picker UI loads
  } else {
    repoPath = findRepoRoot(process.cwd());
  }

  // DIFFSCOPE_DEV_PORT pins the backend port for the dev workflow so the
  // Vite dev server's proxy target stays stable across restarts.
  const envPort = process.env.DIFFSCOPE_DEV_PORT;
  const port = envPort ? parseInt(envPort, 10) : await pickPort();
  if (envPort && (Number.isNaN(port) || port < 1 || port > 65535)) {
    console.error(`diffscope: invalid DIFFSCOPE_DEV_PORT: ${envPort}`);
    process.exit(1);
  }
  const { stop } = await startHttpServer({
    repoPath,
    staticDir: staticDirForMode(),
    port,
  });

  const url = `http://localhost:${port}`;
  if (repoPath) {
    console.log(`diffscope: watching ${repoPath}`);
  } else {
    console.log(`diffscope: no repo at ${arg ?? process.cwd()} — opening picker`);
  }
  console.log(`diffscope: ${url}`);
  openBrowser(url);

  const shutdown = async () => {
    console.log("\ndiffscope: shutting down…");
    await stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((err) => {
    console.error("diffscope:", err);
    process.exit(1);
  });
}
