import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSkillInstallPlan } from "../src/skill-install.js";

describe("skill installation plan", () => {
  it("links existing agent skill parents and preserves real directories", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agent-obs-skill-"));
    await mkdir(path.join(home, ".codex", "skills"), { recursive: true });
    const existing = path.join(
      home,
      ".codex",
      "skills",
      "agent-obs-cli",
    );
    await mkdir(existing);
    await writeFile(path.join(existing, "KEEP"), "keep");
    await mkdir(path.join(home, ".claude", "skills"), { recursive: true });

    const plan = await buildSkillInstallPlan(home);

    expect(
      plan.items.find((item) => item.path === existing),
    ).toMatchObject({
      action: "skip_existing_entity",
      willWrite: false,
    });
    expect(
      plan.items.find((item) =>
        item.path.includes(path.join(".claude", "skills")),
      ),
    ).toMatchObject({
      action: "create_symlink",
      willWrite: true,
    });
  });
});
