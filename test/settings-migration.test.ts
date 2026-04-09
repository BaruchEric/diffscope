import { describe, expect, test } from "bun:test";
import {
  migrateLegacyTheme,
  resolveThemeId,
  type ThemeId,
} from "../src/web/settings";

describe("migrateLegacyTheme", () => {
  test("maps legacy 'dark' to 'midnight'", () => {
    expect(migrateLegacyTheme("dark")).toBe("midnight");
  });

  test("maps legacy 'light' to 'paper'", () => {
    expect(migrateLegacyTheme("light")).toBe("paper");
  });

  test("maps legacy 'system' to 'auto'", () => {
    expect(migrateLegacyTheme("system")).toBe("auto");
  });

  test("passes through valid new ThemeIds unchanged", () => {
    const ids: ThemeId[] = ["auto", "midnight", "paper", "aperture"];
    for (const id of ids) {
      expect(migrateLegacyTheme(id)).toBe(id);
    }
  });

  test("falls back to 'auto' for unknown values", () => {
    expect(migrateLegacyTheme("nonsense" as string)).toBe("auto");
    expect(migrateLegacyTheme(undefined)).toBe("auto");
    expect(migrateLegacyTheme(null as unknown as string)).toBe("auto");
  });
});

describe("resolveThemeId", () => {
  test("passes concrete themes through unchanged", () => {
    expect(resolveThemeId("midnight", false)).toBe("midnight");
    expect(resolveThemeId("midnight", true)).toBe("midnight");
    expect(resolveThemeId("paper", true)).toBe("paper");
    expect(resolveThemeId("aperture", false)).toBe("aperture");
  });

  test("resolves auto to midnight when prefersDark is true", () => {
    expect(resolveThemeId("auto", true)).toBe("midnight");
  });

  test("resolves auto to paper when prefersDark is false", () => {
    expect(resolveThemeId("auto", false)).toBe("paper");
  });
});
