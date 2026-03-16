import type { ToolResult } from "./types";

export function textResult(text: string): ToolResult {
  return {
    content: [{ type: "text", text }],
  };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/**
 * Formats columns and rows as a markdown table.
 * Empty rows produce a "No data" message.
 */
export function formatTable(
  columns: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
): string {
  if (rows.length === 0) {
    return "No data found.";
  }

  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${row.map((cell) => String(cell ?? "")).join(" | ")} |`)
    .join("\n");

  return `${header}\n${separator}\n${body}`;
}

/**
 * Formats a number with thousands separators.
 * 1234567 becomes "1,234,567"
 */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Formats a decimal as a percentage string.
 * 0.456 becomes "45.6%"
 */
export function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
