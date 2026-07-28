import {
  cp,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";
import { CliError } from "./errors.js";

export interface SkillPlanItem {
  action:
    | "create_main"
    | "update_main"
    | "create_symlink"
    | "update_symlink"
    | "skip_missing_parent"
    | "skip_existing_entity";
  path: string;
  willWrite: boolean;
  note: string;
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}

async function resolveSkillSource(): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.AGENT_OBS_CLI_PACKAGE_DIR
      ? path.join(
          process.env.AGENT_OBS_CLI_PACKAGE_DIR,
          "skills",
          "agent-obs-cli",
        )
      : "",
    path.resolve(moduleDirectory, "..", "skills", "agent-obs-cli"),
    path.resolve(process.cwd(), "skills", "agent-obs-cli"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, "SKILL.md"))) {
      return candidate;
    }
  }
  throw new CliError(
    "SKILL_SOURCE_NOT_FOUND",
    "找不到内置 skill 目录 skills/agent-obs-cli",
  );
}

export async function buildSkillInstallPlan(
  home = os.homedir(),
): Promise<{ source: string; target: string; items: SkillPlanItem[] }> {
  const source = await resolveSkillSource();
  const target = path.join(home, ".agents", "skills", "agent-obs-cli");
  const items: SkillPlanItem[] = [
    {
      action: (await exists(target)) ? "update_main" : "create_main",
      path: target,
      willWrite: true,
      note: `复制内置 skill: ${source}`,
    },
  ];

  const parents = [
    path.join(home, ".codex", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(home, ".config", "agents", "skills"),
    path.join(home, ".config", "opencode", "skills"),
    path.join(home, ".cursor", "skills"),
    path.join(home, ".gemini", "skills"),
  ];

  for (const parent of parents) {
    const link = path.join(parent, "agent-obs-cli");
    if (!(await exists(parent))) {
      items.push({
        action: "skip_missing_parent",
        path: link,
        willWrite: false,
        note: "父目录不存在",
      });
      continue;
    }
    try {
      const metadata = await lstat(link);
      if (metadata.isSymbolicLink()) {
        items.push({
          action: "update_symlink",
          path: link,
          willWrite: true,
          note: `更新软链接到 ${target}`,
        });
      } else {
        items.push({
          action: "skip_existing_entity",
          path: link,
          willWrite: false,
          note: "目标已存在且不是软链接，不覆盖",
        });
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        items.push({
          action: "create_symlink",
          path: link,
          willWrite: true,
          note: `创建软链接到 ${target}`,
        });
      } else {
        throw error;
      }
    }
  }
  return { source, target, items };
}

async function confirm(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new CliError(
      "CONFIRMATION_REQUIRED",
      "非交互环境安装 skill 时必须添加 --yes",
    );
  }
  const terminal = createInterface({ input, output });
  try {
    const answer = await terminal.question(
      "确认执行以上 skill 安装计划？输入 yes 继续: ",
    );
    return answer.trim() === "yes";
  } finally {
    terminal.close();
  }
}

export async function installSkill(input: {
  dryRun: boolean;
  yes: boolean;
}): Promise<Record<string, unknown>> {
  const plan = await buildSkillInstallPlan();
  if (input.dryRun) {
    return { dryRun: true, target: plan.target, items: plan.items };
  }
  if (!input.yes && !(await confirm())) {
    return { cancelled: true, target: plan.target, items: plan.items };
  }

  const targetParent = path.dirname(plan.target);
  await mkdir(targetParent, { recursive: true });
  const temporary = path.join(
    targetParent,
    `.agent-obs-cli.${process.pid}.tmp`,
  );
  await rm(temporary, { recursive: true, force: true });
  await cp(plan.source, temporary, { recursive: true });

  try {
    const metadata = await lstat(plan.target);
    if (metadata.isSymbolicLink()) {
      throw new CliError(
        "INVALID_SKILL_TARGET",
        `主 skill 安装目录不能是软链接: ${plan.target}`,
      );
    }
    await rm(plan.target, { recursive: true });
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
    ) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }
  await rename(temporary, plan.target);

  for (const item of plan.items) {
    if (
      item.action !== "create_symlink" &&
      item.action !== "update_symlink"
    ) {
      continue;
    }
    if (item.action === "update_symlink") {
      await rm(item.path, { force: true });
    }
    await symlink(
      plan.target,
      item.path,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  return {
    installed: true,
    skill: path.join(plan.target, "SKILL.md"),
    items: plan.items,
  };
}

export async function readBundledSkill(): Promise<string> {
  const source = await resolveSkillSource();
  return readFile(path.join(source, "SKILL.md"), "utf8");
}
