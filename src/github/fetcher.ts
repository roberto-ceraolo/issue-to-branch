import { Octokit } from "@octokit/rest";
import { execa } from "execa";

export interface IssueData {
  number: number;
  title: string;
  body: string;
  labels: string[];
  author: string;
  repoOwner: string;
  repoName: string;
  url: string;
}

const URL_PATTERN =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)$/;

const SHORTHAND_PATTERN = /^([^/]+)\/([^#]+)#(\d+)$/;

interface ParsedRef {
  owner: string;
  repo: string;
  number: number;
}

function parseIssueRef(ref: string): ParsedRef {
  const trimmed = ref.trim();

  let match = URL_PATTERN.exec(trimmed);
  if (match) {
    return { owner: match[1], repo: match[2], number: Number(match[3]) };
  }

  match = SHORTHAND_PATTERN.exec(trimmed);
  if (match) {
    return { owner: match[1], repo: match[2], number: Number(match[3]) };
  }

  throw new Error(
    `Invalid issue reference: "${ref}". Expected a URL like https://github.com/owner/repo/issues/42 or a shorthand like owner/repo#42.`,
  );
}

async function getToken(): Promise<string> {
  const envToken = process.env["GITHUB_TOKEN"];
  if (envToken) return envToken;

  try {
    const { stdout } = await execa("gh", ["auth", "token"]);
    const token = stdout.trim();
    if (token) return token;
  } catch {
    // gh CLI not available or not authenticated
  }

  throw new Error(
    "No GitHub token found. Set GITHUB_TOKEN or authenticate with `gh auth login`.",
  );
}

export async function fetchIssue(issueRef: string): Promise<IssueData> {
  const { owner, repo, number: issueNumber } = parseIssueRef(issueRef);
  const token = await getToken();
  const octokit = new Octokit({ auth: token });

  const { data } = await octokit.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  if ("pull_request" in data && data.pull_request) {
    throw new Error(
      `#${issueNumber} in ${owner}/${repo} is a pull request, not an issue.`,
    );
  }

  return {
    number: data.number,
    title: data.title,
    body: data.body ?? "",
    labels: data.labels.map((label) =>
      typeof label === "string" ? label : label.name ?? "",
    ),
    author: data.user?.login ?? "unknown",
    repoOwner: owner,
    repoName: repo,
    url: data.html_url,
  };
}
