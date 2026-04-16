import { spawn, type ChildProcess } from "node:child_process";
import { execa } from "execa";

export interface AgentSession {
  port: number;
  url: string;
  sessionId: string;
  process: ChildProcess;
}

interface AgentEvent {
  type?: string;
  role?: string;
  content?: string | ContentBlock[];
  text?: string;
  question?: string;
}

interface ContentBlock {
  type?: string;
  text?: string;
  content?: string;
}

export async function startAgent(
  worktreePath: string,
  port: number
): Promise<AgentSession> {
  const proc = spawn(
    "opencode",
    ["serve", "--port", String(port), "--dir", worktreePath],
    {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  let exitCode: number | null = null;
  proc.on("exit", (code) => {
    exitCode = code;
  });

  try {
    await waitForServer(port, () => exitCode);
  } catch (err) {
    proc.kill();
    throw new Error(
      `opencode server failed to start${
        exitCode != null ? ` (exit code ${exitCode})` : ""
      }`,
      { cause: err }
    );
  }

  const sessionId = await createSession(`http://localhost:${port}`);

  return {
    port,
    url: `http://localhost:${port}`,
    sessionId,
    process: proc,
  };
}

async function waitForServer(
  port: number,
  getExitCode: () => number | null,
  maxRetries = 30
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    if (getExitCode() !== null) {
      throw new Error(`Server exited with code ${getExitCode()}`);
    }
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise<void>((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server did not become healthy within ${maxRetries}s`);
}

async function createSession(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    throw new Error(
      `Session creation failed: ${res.status} ${await res.text()}`
    );
  }

  const body = (await res.json()) as { id: string };
  return body.id;
}

export async function sendMessage(
  session: AgentSession,
  message: string
): Promise<string> {
  const result = await execa("opencode", [
    "run",
    "--attach",
    session.url,
    "--session",
    session.sessionId,
    "--format",
    "json",
    message,
  ]);

  return parseAgentOutput(result.stdout);
}

function parseAgentOutput(raw: string): string {
  const lines = raw.split("\n").filter((l) => l.trim());

  if (lines.length === 1) {
    try {
      const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
      return extractText(parsed);
    } catch {
      return raw;
    }
  }

  const events: AgentEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as AgentEvent);
    } catch {
      // skip non-JSON lines
    }
  }

  const question = events.find(
    (e) => e.type === "clarifying_question" || e.type === "question"
  );
  if (question) {
    return String(
      question.content ?? question.text ?? question.question ?? JSON.stringify(question)
    );
  }

  const assistantMessages = events.filter(
    (e) =>
      e.role === "assistant" &&
      (e.type === "message" || e.type === "content" || e.type === "assistant")
  );

  if (assistantMessages.length > 0) {
    return extractText(assistantMessages[assistantMessages.length - 1] as Record<string, unknown>);
  }

  if (events.length > 0) {
    return extractText(events[events.length - 1] as Record<string, unknown>);
  }

  return raw;
}

function extractText(event: Record<string, unknown>): string {
  const content = event.content ?? event.text;
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is ContentBlock =>
          typeof block === "object" && block !== null
      )
      .map((block) => String(block.text ?? block.content ?? ""))
      .filter(Boolean)
      .join("\n");
  }

  return JSON.stringify(event);
}

export async function stopAgent(session: AgentSession): Promise<void> {
  try {
    session.process.kill("SIGTERM");
  } catch {
    // process may have already exited
  }
}
