import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { DATA_DIR } from "./paths.js";
import { printReview } from "./printer.js";
import type { ReviewResult } from "./reviewer.js";

export function showDiff(date: string): void {
  const reportPath = join(DATA_DIR, "reports", "daily", `${date}.json`);

  if (!existsSync(reportPath)) {
    // Check if raw log exists to give a better error message
    const rawPath = join(DATA_DIR, "logs", "raw", `${date}.md`);
    if (existsSync(rawPath)) {
      console.error(
        chalk.yellow(
          `No review data found for ${date}. The log exists but hasn't been reviewed.\n` +
            `Run \`english-tracker log\` to review it.`
        )
      );
    } else {
      console.error(chalk.red(`No log found for ${date}.`));
    }
    process.exit(1);
  }

  const review: ReviewResult = JSON.parse(
    readFileSync(reportPath, "utf-8")
  );

  printReview(review);
}
