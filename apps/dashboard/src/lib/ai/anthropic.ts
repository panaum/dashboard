import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic | null {
  if (!hasApiKey()) return null;
  if (!client) client = new Anthropic();
  return client;
}

export const QA_MODEL = "claude-opus-4-8";
