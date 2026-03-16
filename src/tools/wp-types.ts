import type { ToolDefinition, ToolResult } from "./types";
import type { WordPressClient } from "../wordpress/client";

export interface WPToolHandler {
  readonly definition: ToolDefinition;
  readonly execute: (
    args: Record<string, unknown>,
    client: WordPressClient,
  ) => Promise<ToolResult>;
}
