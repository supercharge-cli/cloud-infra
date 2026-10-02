import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
for await (const line of input) {
  if (!line.trim()) continue;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    continue;
  }
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
    continue;
  }
  if (request.id === undefined) continue;
  const { id, method, params } = request;
  let result;
  if (method === "initialize") {
    result = {
      protocolVersion: params?.protocolVersion ?? "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "vectra-echo", version: "1.0.0" },
    };
  } else if (method === "ping") result = {};
  else if (method === "tools/list") {
    result = {
      tools: [{
        name: "echo",
        description: "Echo a short string without filesystem or network effects.",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string", maxLength: 4096 } },
          required: ["text"],
          additionalProperties: false,
        },
      }],
    };
  } else if (method === "tools/call" && params?.name === "echo") {
    const text = params.arguments?.text;
    result = typeof text === "string" && text.length <= 4096
      ? { content: [{ type: "text", text }] }
      : { content: [{ type: "text", text: "Expected text with at most 4096 characters" }], isError: true };
  } else {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method or tool not found" } });
    continue;
  }
  send({ jsonrpc: "2.0", id, result });
}
