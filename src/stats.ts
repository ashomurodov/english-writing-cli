import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import type { ReviewResult } from "./reviewer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const STATS_PATH = join(PROJECT_ROOT, "stats", "weakness-profile.json");

export interface CategoryStats {
  count: number;
  trend: "improving" | "stable" | "worsening";
  last_7_count: number;
  prev_7_count: number;
}

export interface WeaknessProfile {
  total_logs: number;
  total_sentences: number;
  total_errors: number;
  overall_accuracy: number;
  categories: Record<string, CategoryStats>;
  accuracy_over_time: Array<{ date: string; accuracy: number }>;
}

function loadProfile(): WeaknessProfile {
  if (existsSync(STATS_PATH)) {
    return JSON.parse(readFileSync(STATS_PATH, "utf-8"));
  }
  return {
    total_logs: 0,
    total_sentences: 0,
    total_errors: 0,
    overall_accuracy: 0,
    categories: {},
    accuracy_over_time: [],
  };
}

function saveProfile(profile: WeaknessProfile): void {
  writeFileSync(STATS_PATH, JSON.stringify(profile, null, 2), "utf-8");
}

export function updateStats(review: ReviewResult): void {
  const profile = rebuildProfile();
  saveProfile(profile);
}

/**
 * Rebuild the entire profile from all daily report JSON files.
 * This is more reliable than incremental updates.
 */
function rebuildProfile(): WeaknessProfile {
  const dailyDir = join(PROJECT_ROOT, "reports", "daily");
  if (!existsSync(dailyDir)) {
    return loadProfile();
  }

  const files = readdirSync(dailyDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const profile: WeaknessProfile = {
    total_logs: 0,
    total_sentences: 0,
    total_errors: 0,
    overall_accuracy: 0,
    categories: {},
    accuracy_over_time: [],
  };

  const allReviews: ReviewResult[] = [];

  for (const file of files) {
    const review: ReviewResult = JSON.parse(
      readFileSync(join(dailyDir, file), "utf-8")
    );
    allReviews.push(review);
    profile.total_logs++;
    profile.total_sentences += review.summary.total_sentences;

    // Count all errors
    for (const sentence of review.sentences) {
      for (const err of sentence.errors) {
        profile.total_errors++;
        if (!profile.categories[err.category]) {
          profile.categories[err.category] = {
            count: 0,
            trend: "stable",
            last_7_count: 0,
            prev_7_count: 0,
          };
        }
        profile.categories[err.category].count++;
      }
    }

    profile.accuracy_over_time.push({
      date: review.date,
      accuracy: review.summary.accuracy_percent,
    });
  }

  // Calculate overall accuracy
  if (profile.total_sentences > 0) {
    const totalCorrect = profile.total_sentences - allReviews.reduce(
      (sum, r) => sum + r.summary.incorrect_sentences, 0
    );
    profile.overall_accuracy = Math.round(
      (totalCorrect / profile.total_sentences) * 100
    );
  }

  // Calculate trends using last 7 vs previous 7 logs
  const last7 = allReviews.slice(-7);
  const prev7 = allReviews.slice(-14, -7);

  for (const cat of Object.keys(profile.categories)) {
    let last7Count = 0;
    let prev7Count = 0;

    for (const review of last7) {
      for (const s of review.sentences) {
        for (const e of s.errors) {
          if (e.category === cat) last7Count++;
        }
      }
    }

    for (const review of prev7) {
      for (const s of review.sentences) {
        for (const e of s.errors) {
          if (e.category === cat) prev7Count++;
        }
      }
    }

    profile.categories[cat].last_7_count = last7Count;
    profile.categories[cat].prev_7_count = prev7Count;

    if (prev7Count === 0 && last7Count === 0) {
      profile.categories[cat].trend = "stable";
    } else if (last7Count < prev7Count) {
      profile.categories[cat].trend = "improving";
    } else if (last7Count > prev7Count) {
      profile.categories[cat].trend = "worsening";
    } else {
      profile.categories[cat].trend = "stable";
    }
  }

  return profile;
}

export function printStats(): void {
  // Rebuild fresh every time we display
  const profile = rebuildProfile();
  saveProfile(profile);

  if (profile.total_logs === 0) {
    console.log(chalk.yellow("No logs found yet. Run `npm run log` to start!"));
    return;
  }

  console.log(chalk.bold.underline("\nEnglish Improvement Stats\n"));
  console.log(`  Total logs:      ${chalk.cyan(profile.total_logs)}`);
  console.log(`  Total sentences: ${chalk.cyan(profile.total_sentences)}`);
  console.log(`  Total errors:    ${chalk.cyan(profile.total_errors)}`);
  console.log(
    `  Overall accuracy: ${colorAccuracy(profile.overall_accuracy)}`
  );

  // Error breakdown by category
  console.log(chalk.bold("\n  Error Breakdown:\n"));

  const sorted = Object.entries(profile.categories).sort(
    ([, a], [, b]) => b.count - a.count
  );

  for (const [cat, stats] of sorted) {
    const trendIcon =
      stats.trend === "improving"
        ? chalk.green("↓")
        : stats.trend === "worsening"
          ? chalk.red("↑")
          : chalk.dim("→");
    const trendLabel =
      stats.trend === "improving"
        ? chalk.green(stats.trend)
        : stats.trend === "worsening"
          ? chalk.red(stats.trend)
          : chalk.dim(stats.trend);

    console.log(
      `    ${cat.padEnd(22)} ${String(stats.count).padStart(3)} total  ${trendIcon} ${trendLabel}  (last 7: ${stats.last_7_count}, prev 7: ${stats.prev_7_count})`
    );
  }

  // Top 3 weakest areas
  const top3 = sorted.slice(0, 3);
  if (top3.length > 0) {
    console.log(chalk.bold("\n  Top 3 Weakest Areas:\n"));
    top3.forEach(([cat, stats], i) => {
      console.log(
        `    ${i + 1}. ${chalk.red(cat)} — ${stats.count} errors`
      );
    });
  }

  // Trend comparison
  if (profile.accuracy_over_time.length >= 2) {
    const recent = profile.accuracy_over_time.slice(-7);
    const older = profile.accuracy_over_time.slice(-14, -7);

    if (older.length > 0) {
      const recentAvg = Math.round(
        recent.reduce((s, e) => s + e.accuracy, 0) / recent.length
      );
      const olderAvg = Math.round(
        older.reduce((s, e) => s + e.accuracy, 0) / older.length
      );
      const diff = recentAvg - olderAvg;

      console.log(chalk.bold("\n  Accuracy Trend:\n"));
      console.log(`    Last ${recent.length} logs avg:     ${colorAccuracy(recentAvg)}`);
      console.log(`    Previous ${older.length} logs avg:  ${colorAccuracy(olderAvg)}`);
      if (diff > 0) {
        console.log(chalk.green(`    Improving by ${diff}% points!`));
      } else if (diff < 0) {
        console.log(chalk.red(`    Declined by ${Math.abs(diff)}% points.`));
      } else {
        console.log(chalk.dim("    No change."));
      }
    }
  }

  console.log("");
}

function colorAccuracy(pct: number): string {
  if (pct >= 80) return chalk.green(`${pct}%`);
  if (pct >= 50) return chalk.yellow(`${pct}%`);
  return chalk.red(`${pct}%`);
}
