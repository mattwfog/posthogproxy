import type { ToolDefinition, ToolResult } from "./types";
import type { PostHogClient } from "../posthog/client";
import type { WordPressClient } from "../wordpress/client";
import type { TokenData } from "../types";

export interface CrossToolHandler {
  readonly definition: ToolDefinition;
  readonly execute: (
    args: Record<string, unknown>,
    posthog: PostHogClient,
    wordpress: WordPressClient,
    tokenData: TokenData,
  ) => Promise<ToolResult>;
}
