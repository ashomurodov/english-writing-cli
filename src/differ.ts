import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { DATA_DIR } from "./paths.js";

export function showDiff(date: string): void {
  const rawPath = join(DATA_DIR, "logs", "raw", `${date}.md`);
  const correctedPath = join(DATA_DIR, "logs", "corrected", `${date}.md`);

  if (!existsSync(rawPath)) {
    console.error(chalk.red(`No raw log found for ${date}`));
    process.exit(1);
  }
  if (!existsSync(correctedPath)) {
    console.error(chalk.red(`No corrected log found for ${date}`));
    process.exit(1);
  }

  const rawContent = readFileSync(rawPath, "utf-8");
  const correctedContent = readFileSync(correctedPath, "utf-8");

  // Extract original and corrected sentences from the corrected markdown
  // We'll parse the structured corrected file for a nice side-by-side view
  const rawLines = rawContent
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"));
  const correctedLines = correctedContent.split("\n");

  console.log(chalk.bold.underline(`\nDiff for ${date}\n`));
  console.log(chalk.dim("─".repeat(60)));

  // Parse corrected markdown to find Original/Corrected pairs
  let i = 0;
  while (i < correctedLines.length) {
    const line = correctedLines[i];

    // Look for "No errors" blocks (correct sentences)
    if (line.startsWith("> ") && !line.includes("**Original:**") && !line.includes("**Corrected:**")) {
      const sentence = line.replace(/^>\s*/, "");
      if (
        i + 2 < correctedLines.length &&
        correctedLines[i + 2].includes("No errors")
      ) {
        console.log(chalk.green(`  ${sentence}`));
        console.log(chalk.dim("─".repeat(60)));
      }
    }

    // Look for Original/Corrected pairs
    if (line.includes("**Original:**")) {
      const original = line.replace(/^>\s*\*\*Original:\*\*\s*/, "");
      // Next non-empty line should be corrected
      let j = i + 1;
      while (j < correctedLines.length && !correctedLines[j].includes("**Corrected:**")) j++;
      if (j < correctedLines.length) {
        const corrected = correctedLines[j].replace(
          /^>\s*\*\*Corrected:\*\*\s*/,
          ""
        );
        console.log(chalk.red(`- ${original}`));
        console.log(chalk.green(`+ ${corrected}`));

        // Print error details
        let k = j + 1;
        while (k < correctedLines.length && correctedLines[k].startsWith("- **[")) {
          console.log(chalk.yellow(`  ${correctedLines[k].replace(/^- /, "")}`));
          k++;
        }
        console.log(chalk.dim("─".repeat(60)));
      }
    }

    i++;
  }

  // Also show raw line-by-line diff
  console.log(chalk.bold("\nRaw file diff:\n"));

  const rawSet = rawLines.map((l) => l.trim());
  for (const line of rawSet) {
    if (!line) continue;
    console.log(chalk.red(`  - ${line}`));
  }

  console.log("");
}
