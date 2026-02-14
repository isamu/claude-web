import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3456;
const CWD = process.argv[2] || process.cwd();

const html = readFileSync(join(__dirname, "index.html"), "utf-8");

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    handleChat(req, res);
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

function handleChat(req, res) {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const { message, continueSession } = JSON.parse(body);
    const args = buildClaudeArgs(message, continueSession);

    const BLOCKED_VARS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"];
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !BLOCKED_VARS.includes(k))
    );

    console.log("Spawning claude with args:", args);

    const proc = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      cwd: CWD,
      detached: false,
    });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    const send = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    let stdoutBuf = "";

    proc.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop();

      lines.filter((l) => l.trim()).forEach((line) => {
        const event = parseEvent(line);
        if (event) {
          send(event);
        }
      });
    });

    proc.stderr.on("data", (data) => {
      const text = data.toString();
      console.log("stderr:", text);
      send({ type: "stderr", text });
    });

    proc.on("error", (err) => {
      console.log("spawn error:", err.message);
      send({ type: "error", text: err.message });
      res.end();
    });

    proc.on("close", (code, signal) => {
      console.log("close:", { code, signal });
      send({ type: "done", code, signal });
      res.end();
    });
  });
}

function parseEvent(line) {
  try {
    const obj = JSON.parse(line);
    return formatEvent(obj);
  } catch {
    console.log("unparseable line:", line);
    return { type: "text", text: line };
  }
}

function formatEvent(obj) {
  if (obj.type === "system" && obj.subtype === "init") {
    return { type: "init", sessionId: obj.session_id, model: obj.model };
  }

  if (obj.type === "assistant") {
    const texts = (obj.message?.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text);
    const toolUses = (obj.message?.content ?? [])
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ name: b.name, input: b.input }));

    return {
      type: "assistant",
      text: texts.join("\n"),
      toolUses: toolUses.length > 0 ? toolUses : undefined,
    };
  }

  if (obj.type === "tool_result") {
    return { type: "tool_result", name: obj.tool_name, content: obj.content };
  }

  if (obj.type === "result") {
    return {
      type: "result",
      subtype: obj.subtype,
      text: obj.result ?? "",
      cost_usd: obj.total_cost_usd,
      duration_ms: obj.duration_ms,
      num_turns: obj.num_turns,
    };
  }

  return null;
}

function buildClaudeArgs(message, continueSession) {
  const args = [];
  if (continueSession) {
    args.push("-c");
  }
  args.push("-p", message);
  args.push("--output-format", "stream-json", "--verbose");
  return args;
}

server.listen(PORT, () => {
  console.log(`Claude Web running at http://localhost:${PORT}`);
  console.log(`Working directory: ${CWD}`);
});
