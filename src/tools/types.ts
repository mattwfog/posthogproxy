import type { PostHogClient } from "../posthog/client";

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: object;
}

export interface ToolResult {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  readonly isError?: boolean;
}

export interface ToolHandler {
  readonly definition: ToolDefinition;
  readonly execute: (
    args: Record<string, unknown>,
    client: PostHogClient,
  ) => Promise<ToolResult>;
}
