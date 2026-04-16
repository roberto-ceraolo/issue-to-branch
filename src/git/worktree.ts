import { execa } from "execa";
import path from "node:path";

export interface IssueData {
  number: number;
  title: string;
}

export interface WorktreeInfo {
  worktree: string;
  head: string;
  branch?: string;
}

export function branchFromIssue(issue: IssueData): string {
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefix = `feat/${issue.number}-`;
  const maxSlug = 50 - prefix.length;
  const truncatedSlug = slug.substring(0, Math.max(0, maxSlug)).replace(/-+$/, "");
  return `${prefix}${truncatedSlug}`;
}

export async function createWorktree(
  repoRoot: string,
  branchName: string,
): Promise<string> {
  const worktreePath = path.join(
    path.dirname(repoRoot),
    ".worktrees",
    branchName,
  );
  await execa("git", ["worktree", "add", worktreePath, "-b", branchName], {
    cwd: repoRoot,
  });
  return worktreePath;
}

export async function removeWorktree(worktreePath: string): Promise<void> {
  await execa("git", ["worktree", "remove", "--force", worktreePath]);
}

export async function listWorktrees(
  repoRoot: string,
): Promise<WorktreeInfo[]> {
  const result = await execa("git", ["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
  });
  const entries: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of result.stdout.split("\n")) {
    if (line === "") {
      if (current.worktree) {
        entries.push(current as WorktreeInfo);
      }
      current = {};
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") current.worktree = value;
    else if (key === "HEAD") current.head = value;
    else if (key === "branch") current.branch = value;
  }

  if (current.worktree) {
    entries.push(current as WorktreeInfo);
  }

  return entries;
}
