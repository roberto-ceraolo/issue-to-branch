#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("i2b")
  .description("Turn a GitHub issue into a merged PR via an AI agent")
  .version("0.1.0");

program
  .command("run <issue-url>")
  .description("Fetch a GitHub issue, spawn an agent, and merge the result")
  .option("-r, --repo <repo>", "target repo (owner/name), inferred from issue URL if omitted")
  .action(async (issueUrl: string) => {
    console.log(`Running on issue: ${issueUrl}`);
    // TODO: wire up modules
  });

program.parse();
