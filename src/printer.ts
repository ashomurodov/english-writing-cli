import chalk from "chalk";
import type { ReviewResult } from "./reviewer.js";

const SEP = chalk.dim("─".repeat(58));

export function colorAccuracy(pct: number): string {
  if (pct >= 80) return chalk.green(`${pct}%`);
  if (pct >= 50) return chalk.yellow(`${pct}%`);
  return chalk.red(`${pct}%`);
}

export function printReview(review: ReviewResult): void {
  console.log("");
  console.log(chalk.bold.underline(` Review — ${review.date}`));
  console.log(SEP);

  review.sentences.forEach((sentence, i) => {
    const num = String(i + 1).padStart(2, " ");

    if (sentence.is_correct) {
      // Correct sentence: single green line with checkmark
      console.log(chalk.green(`  ${num}.  ${sentence.original}  ✓`));
    } else {
      // Incorrect sentence: original, corrected, then each error
      console.log("");
      console.log(chalk.white(`  ${num}.  ${sentence.original}`));
      console.log("");
      console.log(chalk.green(`      → ${sentence.corrected}`));
      console.log("");

      for (const err of sentence.errors) {
        console.log(
          `      ${chalk.red(`[${err.category}]`)} ${chalk.red(`"${err.mistake}"`)} → ${chalk.green(`"${err.fix}"`)}`
        );
        console.log(chalk.yellow(`        ${err.explanation}`));
      }
    }

    console.log(SEP);
  });

  // Compact summary line
  const s = review.summary;
  const parts = [
    `${chalk.cyan(s.total_sentences)} sentences`,
    `${chalk.green(s.correct_sentences)} correct`,
    `${chalk.red(s.incorrect_sentences)} mistakes`,
    colorAccuracy(s.accuracy_percent) + " accuracy",
  ];
  console.log("");
  console.log(` ${parts.join(chalk.dim(" · "))}`);

  if (s.top_error_categories.length > 0) {
    console.log(
      ` Top errors: ${chalk.yellow(s.top_error_categories.join(", "))}`
    );
  }

  console.log("");
}
