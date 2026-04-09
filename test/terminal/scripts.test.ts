import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempRepo, type TempRepo } from "../helpers/temp-repo";
import { resolveScripts } from "../../src/server/terminal/scripts";

describe("terminal scripts resolver", () => {
  let temp: TempRepo;
  beforeEach(() => {
    temp = createTempRepo();
  });
  afterEach(() => {
    temp.cleanup();
  });

  test("returns only built-ins when no package.json and no user config", async () => {
    const entries = await resolveScripts(temp.root);
    expect(entries.every((e) => e.group === "builtin")).toBe(true);
    expect(entries.find((e) => e.name === "git status")).toBeTruthy();
  });

  test("adds package.json scripts as `bun run <name>`", async () => {
    writeFileSync(
      join(temp.root, "package.json"),
      JSON.stringify({ scripts: { dev: "vite", test: "bun test" } }),
    );
    const entries = await resolveScripts(temp.root);
    const pkg = entries.filter((e) => e.group === "package");
    expect(pkg.find((e) => e.name === "dev")?.command).toBe("bun run dev");
    expect(pkg.find((e) => e.name === "test")?.command).toBe("bun run test");
  });

  test("user scripts override package scripts on name collision", async () => {
    writeFileSync(
      join(temp.root, "package.json"),
      JSON.stringify({ scripts: { test: "bun test" } }),
    );
    mkdirSync(join(temp.root, ".diffscope"));
    writeFileSync(
      join(temp.root, ".diffscope/scripts.json"),
      JSON.stringify({
        scripts: [{ name: "test", command: "bun test --coverage" }],
      }),
    );
    const entries = await resolveScripts(temp.root);
    const tests = entries.filter((e) => e.name === "test");
    expect(tests).toHaveLength(1);
    expect(tests[0]?.group).toBe("user");
    expect(tests[0]?.command).toBe("bun test --coverage");
  });

  test("user scripts override built-ins on name collision", async () => {
    mkdirSync(join(temp.root, ".diffscope"));
    writeFileSync(
      join(temp.root, ".diffscope/scripts.json"),
      JSON.stringify({
        scripts: [{ name: "git status", command: "git status -sb" }],
      }),
    );
    const entries = await resolveScripts(temp.root);
    const gs = entries.filter((e) => e.name === "git status");
    expect(gs).toHaveLength(1);
    expect(gs[0]?.group).toBe("user");
    expect(gs[0]?.command).toBe("git status -sb");
  });

  test("malformed package.json logs a warning and still returns other groups", async () => {
    writeFileSync(join(temp.root, "package.json"), "{ this is not json");
    const { entries, warning } = await resolveScripts(temp.root, {
      withWarning: true,
    });
    expect(entries.some((e) => e.group === "builtin")).toBe(true);
    expect(entries.some((e) => e.group === "package")).toBe(false);
    expect(warning).toMatch(/package\.json/);
  });

  test("malformed user config surfaces a warning but keeps package + builtin", async () => {
    writeFileSync(
      join(temp.root, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
    );
    mkdirSync(join(temp.root, ".diffscope"));
    writeFileSync(join(temp.root, ".diffscope/scripts.json"), "{broken");
    const { entries, warning } = await resolveScripts(temp.root, {
      withWarning: true,
    });
    expect(entries.find((e) => e.name === "dev")?.group).toBe("package");
    expect(entries.some((e) => e.group === "user")).toBe(false);
    expect(warning).toMatch(/scripts\.json/);
  });

  test("empty name or empty command entries are dropped", async () => {
    mkdirSync(join(temp.root, ".diffscope"));
    writeFileSync(
      join(temp.root, ".diffscope/scripts.json"),
      JSON.stringify({
        scripts: [
          { name: "", command: "echo no name" },
          { name: "no command", command: "" },
          { name: "good", command: "echo yes" },
        ],
      }),
    );
    const entries = await resolveScripts(temp.root);
    const user = entries.filter((e) => e.group === "user");
    expect(user).toHaveLength(1);
    expect(user[0]?.name).toBe("good");
  });
});
