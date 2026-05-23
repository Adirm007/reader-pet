// Playwright 浏览器自动化 stub
// 实际依赖较大(~100MB), 用户需在设置中按钮触发 npm install playwright + npx playwright install chromium
// 目前提供接口与权限校验, 真正执行时如未安装会抛出明确错误
import { checkPlaywright } from '../permissions';

export interface BrowserGotoResult {
  url: string;
  title: string;
  text: string;
  ok: boolean;
}

let _playwright: any = null;
async function tryLoadPlaywright() {
  if (_playwright) return _playwright;
  try {
    _playwright = await import('playwright' as any);
    return _playwright;
  } catch {
    return null;
  }
}

export async function browserGoto(url: string): Promise<BrowserGotoResult> {
  const decision = checkPlaywright();
  if (!decision.ok) throw new Error(`PermissionDenied: ${decision.reason}`);
  const pw = await tryLoadPlaywright();
  if (!pw) {
    throw new Error('Playwright 尚未安装. 请在设置中点击"安装 Playwright"按钮.');
  }
  const browser = await pw.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    const title = await page.title();
    const text = (await page.locator('body').innerText({ timeout: 5000 })).slice(0, 8000);
    return { url, title, text, ok: !!resp?.ok() };
  } finally {
    await browser.close();
  }
}

export async function isPlaywrightInstalled(): Promise<boolean> {
  return (await tryLoadPlaywright()) !== null;
}
