import { describe, expect, test } from "bun:test";
import { fuzzyScore, fuzzyFilter } from "../src/web/lib/fuzzy";

describe("fuzzyScore", () => {
  test("empty query matches everything with score 0", () => {
    expect(fuzzyScore("hello world", "")).toBe(0);
  });
  test("exact substring scores higher than scattered match", () => {
    const a = fuzzyScore("hello world", "world");
    const b = fuzzyScore("wiserldrld", "world");
    expect(a).toBeGreaterThan(b);
  });
  test("acronym match scores positive", () => {
    expect(fuzzyScore("Toggle Blame View", "tbv")).toBeGreaterThan(0);
  });
  test("no match returns -Infinity", () => {
    expect(fuzzyScore("hello", "xyz")).toBe(-Infinity);
  });
  test("case insensitive", () => {
    expect(fuzzyScore("Hello World", "world")).toBeGreaterThan(0);
  });
});

describe("fuzzyFilter", () => {
  test("sorts results by score descending, ties stable", () => {
    const items = ["apple", "application", "banana", "pineapple"];
    const result = fuzzyFilter(items, "app", (x) => x);
    expect(result[0]).toBe("apple");
    expect(result).toContain("application");
    expect(result).toContain("pineapple");
    expect(result).not.toContain("banana");
  });
});
