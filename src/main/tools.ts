import { invokeTool, listToolDefinitions, type ToolInvokeContext } from './capabilities/registry';

export const TOOL_DEFINITIONS = listToolDefinitions();

export async function callTool(
  name: string,
  argsJson: string,
  context: ToolInvokeContext = {}
): Promise<string> {
  return invokeTool(name, argsJson, context);
}
