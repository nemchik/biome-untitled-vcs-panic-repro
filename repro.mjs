// Reproduces https://github.com/biomejs/biome/issues/13257
//
// Starts `biome lsp-proxy` from this folder (so the daemon's working directory
// is this project, like an editor would), initializes the LSP with this folder
// as the workspace, then opens an untitled document. With `vcs.useIgnoreFile`
// enabled, the daemon panics with "path is expected to be under the root".
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const biomeBin = require.resolve("@biomejs/biome/bin/biome");
const projectDir = dirname(fileURLToPath(import.meta.url));
const projectUri = pathToFileURL(projectDir).href;

// The daemon is shared per Biome version. Stop any running one so a fresh
// daemon starts with this folder as its working directory.
spawnSync(process.execPath, [biomeBin, "stop"], { cwd: projectDir, stdio: "ignore" });

const proxy = spawn(process.execPath, [biomeBin, "lsp-proxy"], {
  cwd: projectDir,
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
proxy.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const send = (message) => {
  const json = JSON.stringify({ jsonrpc: "2.0", ...message });
  proxy.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
};

// Minimal LSP framing reader; answers server->client requests like an editor.
let buffer = Buffer.alloc(0);
proxy.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString())[1]);
    if (buffer.length < headerEnd + 4 + length) return;
    const message = JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString());
    buffer = buffer.subarray(headerEnd + 4 + length);
    if (message.id !== undefined && message.method) {
      const result =
        message.method === "workspace/configuration" ? message.params.items.map(() => ({})) : null;
      send({ id: message.id, result });
    }
  }
});

let exited = false;
proxy.on("exit", () => {
  exited = true;
});

send({
  id: 1,
  method: "initialize",
  params: {
    capabilities: {
      window: { workDoneProgress: true },
      workspace: { configuration: true, workspaceFolders: true },
    },
    processId: process.pid,
    rootUri: projectUri,
    workspaceFolders: [{ name: "repro", uri: projectUri }],
  },
});

setTimeout(() => {
  send({ method: "initialized", params: {} });
  // An unsaved editor tab: it has no file path.
  send({
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        languageId: "javascript",
        text: "const b = 2;\n",
        uri: "untitled:Untitled-1",
        version: 1,
      },
    },
  });
}, 500);

setTimeout(() => {
  if (exited) {
    console.log("REPRODUCED: the language server crashed.\n");
    console.log(stderr.trim());
    process.exit(1);
  }
  console.log("Not reproduced: the language server is still running.");
  send({ id: 2, method: "shutdown" });
  send({ method: "exit" });
  setTimeout(() => process.exit(0), 500);
}, 8000);
