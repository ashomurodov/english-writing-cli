import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PKG_DIR } from "./paths.js";

export interface ErrorEntry {
  category: string;
  mistake: string;
  fix: string;
  explanation: string;
}

export interface SentenceReview {
  original: string;
  corrected: string;
  is_correct: boolean;
  errors: ErrorEntry[];
}

export interface ReviewSummary {
  total_sentences: number;
  correct_sentences: number;
  incorrect_sentences: number;
  accuracy_percent: number;
  top_error_categories: string[];
}

export interface ReviewResult {
  date: string;
  sentences: SentenceReview[];
  summary: ReviewSummary;
}

export async function reviewLog(
  content: string,
  date: string
): Promise<ReviewResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set.\n" +
        "Set it with: export ANTHROPIC_API_KEY=your-key-here"
    );
  }

  const systemPrompt = readFileSync(
    join(PKG_DIR, "prompts", "review.txt"),
    "utf-8"
  );

  const client = new Anthropic();

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Please review the following English writing log dated ${date}:\n\n${content}`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Strip markdown fences if Claude wraps them despite instructions
  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();

  let result: ReviewResult;
  try {
    result = JSON.parse(cleaned);
  } catch {
    throw new Error(
      `Failed to parse Claude API response as JSON.\nRaw response:\n${text}`
    );
  }

  // Ensure the date field matches
  result.date = date;

  return result;
}

export function buildCorrectedMarkdown(review: ReviewResult): string {
  const lines: string[] = [];
  lines.push(`# English Log — ${review.date} (Corrected)`);
  lines.push("");

  for (const sentence of review.sentences) {
    if (sentence.is_correct) {
      lines.push(`> ${sentence.original}`);
      lines.push("");
      lines.push("*No errors.*");
      lines.push("");
    } else {
      lines.push(`> **Original:** ${sentence.original}`);
      lines.push("");
      lines.push(`> **Corrected:** ${sentence.corrected}`);
      lines.push("");
      for (const err of sentence.errors) {
        lines.push(
          `- **[${err.category}]** "${err.mistake}" → "${err.fix}" — ${err.explanation}`
        );
      }
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  const s = review.summary;
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total sentences:** ${s.total_sentences}`);
  lines.push(`- **Correct:** ${s.correct_sentences}`);
  lines.push(`- **Incorrect:** ${s.incorrect_sentences}`);
  lines.push(`- **Accuracy:** ${s.accuracy_percent}%`);
  if (s.top_error_categories.length > 0) {
    lines.push(
      `- **Top error categories:** ${s.top_error_categories.join(", ")}`
    );
  }
  lines.push("");

  return lines.join("\n");
}
