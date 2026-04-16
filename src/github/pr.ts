import { execa } from "execa";

export interface IssueData {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface PRData {
  number: number;
  url: string;
  branch: string;
}

export interface ReviewResult {
  approved: boolean;
  reason: string;
  diff?: string;
}

export async function createPR(
  worktreePath: string,
  issue: IssueData,
  branchName: string,
): Promise<PRData> {
  await execa("git", ["add", "-A"], { cwd: worktreePath });

  try {
    await execa(
      "git",
      ["commit", "-m", `feat: resolve #${issue.number} – ${issue.title}`],
      { cwd: worktreePath },
    );
  } catch {
    const status = await execa("git", ["status", "--porcelain"], {
      cwd: worktreePath,
    });
    if (status.stdout.trim() !== "") {
      throw new Error("Failed to commit staged changes");
    }
  }

  await execa("git", ["push", "-u", "origin", branchName], {
    cwd: worktreePath,
  });

  const title = `#${issue.number}: ${issue.title}`;
  const body =
    issue.body || `Closes #${issue.number}`;

  const result = await execa(
    "gh",
    ["pr", "create", "--title", title, "--body", body, "--head", branchName],
    { cwd: worktreePath },
  );

  const urlMatch = result.stdout.match(
    /https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/,
  );
  if (!urlMatch) {
    throw new Error(
      `Could not parse PR URL from gh output:\n${result.stdout}`,
    );
  }

  return {
    number: Number(urlMatch[1]),
    url: urlMatch[0],
    branch: branchName,
  };
}

export async function reviewPR(pr: PRData): Promise<ReviewResult> {
  let diff = "";
  try {
    const diffResult = await execa("gh", [
      "pr",
      "diff",
      String(pr.number),
    ]);
    diff = diffResult.stdout;
  } catch {
    return {
      approved: false,
      reason: "Failed to fetch PR diff",
    };
  }

  if (diff.trim() === "") {
    return {
      approved: false,
      reason: "Diff is empty — no changes to review",
      diff,
    };
  }

  let checksOutput = "";
  try {
    const checksResult = await execa("gh", [
      "pr",
      "checks",
      String(pr.number),
    ]);
    checksOutput = checksResult.stdout;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    const combined = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
    if (/no checks/i.test(combined) || /no status checks/i.test(combined)) {
      return {
        approved: true,
        reason: "No CI configured; diff is non-empty",
        diff,
      };
    }

    const failedLines = combined
      .split("\n")
      .filter((l: string) => /fail|error|x/i.test(l) && l.trim() !== "");
    return {
      approved: false,
      reason: failedLines.length
        ? `CI failed: ${failedLines.join("; ")}`
        : "CI checks failed",
      diff,
    };
  }

  const lines = checksOutput.split("\n").filter((l) => l.trim() !== "");
  const failed = lines.filter((l) => /fail|error|x/i.test(l));

  if (failed.length > 0) {
    return {
      approved: false,
      reason: `CI failed: ${failed.join("; ")}`,
      diff,
    };
  }

  return {
    approved: true,
    reason: "CI passed and diff is non-empty",
    diff,
  };
}

export async function mergePR(pr: PRData): Promise<void> {
  await execa("gh", [
    "pr",
    "merge",
    String(pr.number),
    "--squash",
    "--delete-branch",
  ]);
}
