#!/usr/bin/env node
import { Command } from "commander";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { simpleGit } from "simple-git";
import { DATA_DIR, getEditor } from "./paths.js";
import { reviewLog, buildCorrectedMarkdown } from "./reviewer.js";
import { showDiff } from "./differ.js";
import { updateStats, printStats } from "./stats.js";
import { generateWeeklyReport } from "./reporter.js";
import { printReview } from "./printer.js";

function getGit() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  return simpleGit(DATA_DIR);
}

function getToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ensureDirs(): void {
  const dirs = [
    join(DATA_DIR, "logs", "raw"),
    join(DATA_DIR, "logs", "corrected"),
    join(DATA_DIR, "reports", "daily"),
    join(DATA_DIR, "reports", "weekly"),
    join(DATA_DIR, "stats"),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

async function ensureGit(): Promise<void> {
  const gitDir = join(DATA_DIR, ".git");
  if (!existsSync(gitDir)) {
    const git = getGit();
    console.log(chalk.dim("Initializing git repository in " + DATA_DIR));
    await git.init();
    // Create .gitkeep files so the initial commit is non-empty
    const keepDirs = ["logs/raw", "logs/corrected", "reports/daily", "reports/weekly", "stats"];
    for (const d of keepDirs) {
      const keepPath = join(DATA_DIR, d, ".gitkeep");
      if (!existsSync(keepPath)) {
        writeFileSync(keepPath, "", "utf-8");
      }
    }
    await git.add(".");
    await git.commit("init: english tracker data");
  }
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

const program = new Command();

program
  .name("english-tracker")
  .description("Track your daily English writing practice")
  .version("1.0.0");

program
  .command("log")
  .description("Write and review a new English log entry")
  .action(async () => {
    ensureDirs();
    await ensureGit();

    const date = getToday();
    const rawPath = join(DATA_DIR, "logs", "raw", `${date}.md`);
    const correctedPath = join(DATA_DIR, "logs", "corrected", `${date}.md`);
    const reportPath = join(DATA_DIR, "reports", "daily", `${date}.json`);

    const editor = getEditor();

    // Check if log already exists
    if (existsSync(rawPath)) {
      const answer = await prompt(
        chalk.yellow(
          `A log for ${date} already exists. Overwrite or append? (o/a/cancel): `
        )
      );
      if (answer === "cancel" || answer === "c") {
        console.log("Cancelled.");
        return;
      }
      if (answer === "a" || answer === "append") {
        console.log(chalk.dim(`Opening ${editor} to append to log...`));
        spawnSync(editor, [rawPath], { stdio: "inherit", shell: true });
      } else {
        writeFileSync(rawPath, `# English Log — ${date}\n\n`, "utf-8");
        console.log(chalk.dim(`Opening ${editor}...`));
        spawnSync(editor, [rawPath], { stdio: "inherit", shell: true });
      }
    } else {
      // New log
      writeFileSync(rawPath, `# English Log — ${date}\n\n`, "utf-8");
      console.log(chalk.dim(`Opening ${editor}...`));
      spawnSync(editor, [rawPath], { stdio: "inherit", shell: true });
    }

    // Read the saved content
    const content = readFileSync(rawPath, "utf-8");
    const textOnly = content
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .join("\n")
      .trim();

    if (!textOnly) {
      console.log(chalk.yellow("Empty log — nothing to review."));
      return;
    }

    // Send to Claude API
    console.log(chalk.cyan("\nSending to Claude API for review..."));
    let review;
    try {
      review = await reviewLog(textOnly, date);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`\nReview failed: ${message}`));
      process.exit(1);
    }

    // Save corrected markdown
    const correctedMd = buildCorrectedMarkdown(review);
    writeFileSync(correctedPath, correctedMd, "utf-8");

    // Save daily report JSON
    writeFileSync(reportPath, JSON.stringify(review, null, 2), "utf-8");

    // Update weakness profile
    updateStats(review);

    // Git commit
    try {
      const git = getGit();
      await git.add([
        rawPath,
        correctedPath,
        reportPath,
        join(DATA_DIR, "stats", "weakness-profile.json"),
      ]);
      await git.commit(`log: ${date}`);
      console.log(chalk.dim(`\nCommitted to git: log: ${date}`));
    } catch {
      console.log(chalk.dim("\nGit commit skipped (no changes or git error)."));
    }

    // Print full sentence-by-sentence review
    printReview(review);
    console.log(chalk.dim(`Data directory: ${DATA_DIR}\n`));
  });

program
  .command("diff [date]")
  .description(
    "Show colorized diff between raw and corrected log for a given date"
  )
  .action((date?: string) => {
    const targetDate = date || getToday();
    showDiff(targetDate);
  });

program
  .command("stats")
  .description("Show all-time error breakdown and improvement trends")
  .action(() => {
    ensureDirs();
    printStats();
  });

program
  .command("report")
  .description("Generate a weekly summary report")
  .action(() => {
    ensureDirs();
    generateWeeklyReport();
  });

program.parse();
