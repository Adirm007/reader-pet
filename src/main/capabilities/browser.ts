import { browserMcpGoto, isPlaywrightMcpConfigured } from './playwright-mcp';

export interface BrowserGotoResult {
  url: string;
  title: string;
  text: string;
  ok: boolean;
}

export async function browserGoto(url: string): Promise<BrowserGotoResult> {
  return browserMcpGoto(url);
}

export async function isPlaywrightInstalled(): Promise<boolean> {
  return isPlaywrightMcpConfigured();
}
