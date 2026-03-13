import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import type { ReviewResult } from "./reviewer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

/**
 * Get the Monday-based ISO week string for a date, e.g. "2026-W11"
 */
function getWeekId(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Set to nearest Thursday (ISO week algorithm)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 +
      yearStart.getDay() +
      1 -
      4) /
      7
  );
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * Get Monday and Sunday of the current ISO week
 */
function getCurrentWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

function getPreviousWeekRange(): { start: Date; end: Date } {
  const { start } = getCurrentWeekRange();
  const prevMonday = new Date(start);
  prevMonday.setDate(start.getDate() - 7);
  const prevSunday = new Date(prevMonday);
  prevSunday.setDate(prevMonday.getDate() + 6);
  prevSunday.setHours(23, 59, 59, 999);
  return { start: prevMonday, end: prevSunday };
}

function loadReviewsInRange(
  start: Date,
  end: Date
): ReviewResult[] {
  const dailyDir = join(PROJECT_ROOT, "reports", "daily");
  if (!existsSync(dailyDir)) return [];

  const files = readdirSync(dailyDir).filter((f) => f.endsWith(".json"));
  const reviews: ReviewResult[] = [];

  for (const file of files) {
    const dateStr = file.replace(".json", "");
    const d = new Date(dateStr + "T00:00:00");
    if (d >= start && d <= end) {
      reviews.push(JSON.parse(readFileSync(join(dailyDir, file), "utf-8")));
    }
  }

  return reviews.sort((a, b) => a.date.localeCompare(b.date));
}

function generateTips(
  errorCounts: Record<string, number>
): string[] {
  const tips: Record<string, string> = {
    articles:
      'Practice the rule: use "a" for general/first mention, "the" for specific/known items. Read your sentences aloud — if it sounds like you\'re pointing at something specific, use "the".',
    prepositions:
      "Prepositions are idiomatic — they don't translate directly between languages. Keep a personal list of preposition + noun combinations you get wrong and review them.",
    "verb-tense":
      "Before writing, decide: is this about the past, present, or future? Stick to one tense per paragraph unless the time frame changes.",
    "verb-form":
      'Review gerund vs. infinitive rules. Tip: after "enjoy, avoid, mind, suggest" use -ing. After "want, need, decide, plan" use to + verb.',
    "word-choice":
      "When unsure about a word, think of 2-3 alternatives. The most common, simplest word is usually correct. Avoid direct translations from your native language.",
    "word-order":
      "English follows Subject-Verb-Object strictly. Adverbs of frequency go before the main verb but after \"be\". Time expressions usually go at the end.",
    "spelling-compound":
      'Learn the top confusing pairs: every day (adverb) vs. everyday (adjective), a lot (always two words), cannot (one word in formal writing). Make flashcards.',
    punctuation:
      "Read your text aloud. Where you naturally pause briefly, add a comma. Where you stop completely, use a period. Use commas before conjunctions (and, but, so) in compound sentences.",
    possessives:
      "Remember: it's = it is (contraction), its = belonging to it (possessive). For names, add 's. For plural nouns ending in s, add just an apostrophe.",
    pronouns:
      'Tip: remove the other person from the sentence to test. "Me and John went" → "Me went" (wrong) → "I went" (correct) → "John and I went".',
    "sentence-structure":
      "Every sentence needs a subject and a verb. If a sentence feels too long, split it into two. Read complex sentences aloud to catch awkward constructions.",
  };

  const sorted = Object.entries(errorCounts).sort(([, a], [, b]) => b - a);
  const result: string[] = [];

  for (const [cat] of sorted) {
    if (result.length >= 3) break;
    if (tips[cat]) {
      result.push(`**${cat}:** ${tips[cat]}`);
    }
  }

  return result;
}

export function generateWeeklyReport(): void {
  const currentWeek = getCurrentWeekRange();
  const prevWeek = getPreviousWeekRange();

  const currentReviews = loadReviewsInRange(currentWeek.start, currentWeek.end);
  const prevReviews = loadReviewsInRange(prevWeek.start, prevWeek.end);

  if (currentReviews.length === 0) {
    console.log(
      chalk.yellow("No logs found for this week. Write some logs first!")
    );
    return;
  }

  const weekId = getWeekId(new Date());

  // Current week stats
  const totalSentences = currentReviews.reduce(
    (s, r) => s + r.summary.total_sentences, 0
  );
  const totalCorrect = currentReviews.reduce(
    (s, r) => s + r.summary.correct_sentences, 0
  );
  const avgAccuracy =
    totalSentences > 0 ? Math.round((totalCorrect / totalSentences) * 100) : 0;

  // Error counts for this week
  const errorCounts: Record<string, number> = {};
  for (const review of currentReviews) {
    for (const s of review.sentences) {
      for (const e of s.errors) {
        errorCounts[e.category] = (errorCounts[e.category] || 0) + 1;
      }
    }
  }

  // Previous week stats
  let prevAvgAccuracy = 0;
  if (prevReviews.length > 0) {
    const prevTotal = prevReviews.reduce(
      (s, r) => s + r.summary.total_sentences, 0
    );
    const prevCorrect = prevReviews.reduce(
      (s, r) => s + r.summary.correct_sentences, 0
    );
    prevAvgAccuracy =
      prevTotal > 0 ? Math.round((prevCorrect / prevTotal) * 100) : 0;
  }

  // Sort errors
  const sortedErrors = Object.entries(errorCounts).sort(
    ([, a], [, b]) => b - a
  );

  // Generate tips
  const tips = generateTips(errorCounts);

  // Build markdown
  const lines: string[] = [];
  lines.push(`# Weekly Report — ${weekId}`);
  lines.push("");
  lines.push(
    `*Generated: ${new Date().toLocaleDateString()}*`
  );
  lines.push("");
  lines.push("## Overview");
  lines.push("");
  lines.push(`- **Logs this week:** ${currentReviews.length}`);
  lines.push(`- **Total sentences:** ${totalSentences}`);
  lines.push(`- **Average accuracy:** ${avgAccuracy}%`);
  lines.push("");

  if (prevReviews.length > 0) {
    lines.push("## Comparison to Previous Week");
    lines.push("");
    lines.push(`- Previous week logs: ${prevReviews.length}`);
    lines.push(`- Previous week accuracy: ${prevAvgAccuracy}%`);
    const diff = avgAccuracy - prevAvgAccuracy;
    if (diff > 0) {
      lines.push(`- **Improvement: +${diff}% points**`);
    } else if (diff < 0) {
      lines.push(`- **Decline: ${diff}% points**`);
    } else {
      lines.push("- No change in accuracy.");
    }
    lines.push("");
  }

  if (sortedErrors.length > 0) {
    lines.push("## Most Common Errors");
    lines.push("");
    for (const [cat, count] of sortedErrors) {
      lines.push(`- **${cat}**: ${count} occurrences`);
    }
    lines.push("");
  }

  if (tips.length > 0) {
    lines.push("## Personalized Tips");
    lines.push("");
    for (let i = 0; i < tips.length; i++) {
      lines.push(`${i + 1}. ${tips[i]}`);
    }
    lines.push("");
  }

  // Daily breakdown
  lines.push("## Daily Breakdown");
  lines.push("");
  lines.push("| Date | Sentences | Correct | Accuracy |");
  lines.push("|------|-----------|---------|----------|");
  for (const r of currentReviews) {
    lines.push(
      `| ${r.date} | ${r.summary.total_sentences} | ${r.summary.correct_sentences} | ${r.summary.accuracy_percent}% |`
    );
  }
  lines.push("");

  const reportContent = lines.join("\n");
  const reportPath = join(
    PROJECT_ROOT,
    "reports",
    "weekly",
    `${weekId}.md`
  );
  writeFileSync(reportPath, reportContent, "utf-8");

  console.log(chalk.green(`\nWeekly report saved to: reports/weekly/${weekId}.md\n`));
  console.log(reportContent);
}
