#!/usr/bin/env node
import { Command } from "commander";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { simpleGit } from "simple-git";
import { reviewLog, buildCorrectedMarkdown } from "./reviewer.js";
import { showDiff } from "./differ.js";
import { updateStats, printStats } from "./stats.js";
import { generateWeeklyReport } from "./reporter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const git = simpleGit(PROJECT_ROOT);

function getToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function ensureDirs(): void {
  const dirs = [
    join(PROJECT_ROOT, "logs", "raw"),
    join(PROJECT_ROOT, "logs", "corrected"),
    join(PROJECT_ROOT, "reports", "daily"),
    join(PROJECT_ROOT, "reports", "weekly"),
    join(PROJECT_ROOT, "stats"),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

async function ensureGit(): Promise<void> {
  const gitDir = join(PROJECT_ROOT, ".git");
  if (!existsSync(gitDir)) {
    console.log(chalk.dim("Initializing git repository..."));
    await git.init();
    // Create initial commit
    await git.add(".");
    await git.commit("init: english tracker project");
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
    const rawPath = join(PROJECT_ROOT, "logs", "raw", `${date}.md`);
    const correctedPath = join(
      PROJECT_ROOT,
      "logs",
      "corrected",
      `${date}.md`
    );
    const reportPath = join(
      PROJECT_ROOT,
      "reports",
      "daily",
      `${date}.json`
    );

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
        // Append mode: open editor with existing content
        const editor = process.env.EDITOR || "nano";
        console.log(chalk.dim(`Opening ${editor} to append to log...`));
        spawnSync(editor, [rawPath], { stdio: "inherit" });
      } else {
        // Overwrite: open with template
        writeFileSync(
          rawPath,
          `# English Log — ${date}\n\n`,
          "utf-8"
        );
        const editor = process.env.EDITOR || "nano";
        console.log(chalk.dim(`Opening ${editor}...`));
        spawnSync(editor, [rawPath], { stdio: "inherit" });
      }
    } else {
      // New log
      writeFileSync(
        rawPath,
        `# English Log — ${date}\n\n`,
        "utf-8"
      );
      const editor = process.env.EDITOR || "nano";
      console.log(chalk.dim(`Opening ${editor}...`));
      spawnSync(editor, [rawPath], { stdio: "inherit" });
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
      await git.add([rawPath, correctedPath, reportPath, join(PROJECT_ROOT, "stats", "weakness-profile.json")]);
      await git.commit(`log: ${date}`);
      console.log(chalk.dim(`\nCommitted to git: log: ${date}`));
    } catch {
      console.log(chalk.dim("\nGit commit skipped (no changes or git error)."));
    }

    // Print summary
    const s = review.summary;
    console.log(chalk.bold.underline(`\nReview Summary — ${date}\n`));
    console.log(`  Total sentences:  ${chalk.cyan(s.total_sentences)}`);
    console.log(`  Correct:          ${chalk.green(s.correct_sentences)}`);
    console.log(`  Mistakes:         ${chalk.red(s.incorrect_sentences)}`);

    const pct = s.accuracy_percent;
    const pctColor = pct >= 80 ? chalk.green : pct >= 50 ? chalk.yellow : chalk.red;
    console.log(`  Accuracy:         ${pctColor(`${pct}%`)}`);

    if (s.top_error_categories.length > 0) {
      console.log(
        `  Top errors:       ${chalk.yellow(s.top_error_categories.join(", "))}`
      );
    }

    console.log(
      chalk.dim(`\nCorrected version saved to: logs/corrected/${date}.md`)
    );
    console.log(
      chalk.dim(`Full analysis saved to: reports/daily/${date}.json\n`)
    );
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
