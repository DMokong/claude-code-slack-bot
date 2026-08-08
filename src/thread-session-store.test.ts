import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ThreadSessionStore } from "./thread-session-store";

describe("ThreadSessionStore", () => {
  it("assigns UUIDs and persists across instances", () => {
    const file = join(mkdtempSync(join(tmpdir(), "tss-")), "map.json");
    const a = new ThreadSessionStore(file);
    const uuid = a.assign("C1::1.0");
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.get("C1::1.0")).toBe(uuid);

    const b = new ThreadSessionStore(file);
    expect(b.get("C1::1.0")).toBe(uuid);
  });

  it("assign overwrites (resume-failed fallback path)", () => {
    const file = join(mkdtempSync(join(tmpdir(), "tss-")), "map.json");
    const s = new ThreadSessionStore(file);
    const first = s.assign("C1::1.0");
    const second = s.assign("C1::1.0");
    expect(second).not.toBe(first);
    expect(new ThreadSessionStore(file).get("C1::1.0")).toBe(second);
  });

  it("tolerates a corrupt file", () => {
    const file = join(mkdtempSync(join(tmpdir(), "tss-")), "map.json");
    writeFileSync(file, "{not json");
    const s = new ThreadSessionStore(file);
    expect(s.get("x")).toBeUndefined();
    s.assign("x");
    expect(JSON.parse(readFileSync(file, "utf-8")).x).toBeDefined();
  });

  it("delete removes and persists", () => {
    const file = join(mkdtempSync(join(tmpdir(), "tss-")), "map.json");
    const s = new ThreadSessionStore(file);
    s.assign("gone");
    s.delete("gone");
    expect(new ThreadSessionStore(file).has("gone")).toBe(false);
  });
});
