// The chat page your agent serves at GET / — you don't need to edit this file.
// It talks to your agent by POSTing to /chat and reading the streamed response.

export const CHAT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nube — Agent Chat</title>
<style>
  :root { --bg:#0f1b2a; --panel:#16283e; --accent:#ff9900; --text:#eaf1f8; --dim:#8ba3bc; }
  * { box-sizing: border-box; margin: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
         height: 100vh; display: flex; flex-direction: column; }
  header { padding: 14px 20px; background: var(--panel); }
  header h1 { font-size: 16px; font-weight: 600; }
  #log { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  .msg { max-width: 75%; padding: 10px 14px; border-radius: 12px; line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
  .user { align-self: flex-end; background: var(--accent); color: #1a1a1a; border-bottom-right-radius: 3px; }
  .agent { align-self: flex-start; background: var(--panel); border-bottom-left-radius: 3px; }
  .tool { align-self: flex-start; font-size: 12px; color: var(--dim); background: #101d30;
          border: 1px solid #24405e; border-radius: 8px; padding: 5px 10px; }
  .error { align-self: flex-start; background: #4a1515; border: 1px solid #a33; color: #ffd7d7;
           font-family: ui-monospace, monospace; font-size: 13px; }
  .sys { align-self: center; font-size: 12px; color: var(--dim); }
  form { display: flex; gap: 10px; padding: 16px 20px; background: var(--panel); }
  input { flex: 1; padding: 12px 14px; border-radius: 10px; border: 1px solid #2c4a6e;
          background: var(--bg); color: var(--text); font-size: 15px; outline: none; }
  input:focus { border-color: var(--accent); }
  button { padding: 12px 22px; border: none; border-radius: 10px; background: var(--accent);
           color: #1a1a1a; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .4; cursor: default; }
</style>
</head>
<body>
<header><h1>🤖 Your Agent</h1></header>
<div id="log"><div class="sys">Say hello to your agent 👋</div></div>
<form id="f">
  <input id="box" placeholder="Ask your agent something…" autocomplete="off" autofocus>
  <button id="send">Send</button>
</form>
<script>
"use strict";
const log = document.getElementById("log"), box = document.getElementById("box"),
      send = document.getElementById("send");

// A random ID for this conversation, sent with every message. The browser
// holds only this ticket — where the conversation lives is up to your agent.
const sessionId = crypto.randomUUID();

function add(cls, text) {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

async function ask(message) {
  send.disabled = true;
  let current = null;
  try {
    const res = await fetch("chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (m.type === "token") {
          if (!current) current = add("agent", "");
          current.textContent += m.text;
          log.scrollTop = log.scrollHeight;
        } else if (m.type === "tool") {
          current = null;
          add("tool", "🔧 using tool: " + m.name);
        } else if (m.type === "error") {
          current = null;
          add("error", "⚠ " + m.text);
        }
      }
    }
  } catch (err) {
    add("error", "⚠ Request failed: " + err.message);
  }
  send.disabled = false;
  box.focus();
}

document.getElementById("f").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = box.value.trim();
  if (!text || send.disabled) return;
  add("user", text);
  box.value = "";
  ask(text);
});
</script>
</body>
</html>`;
