// ------------------------------------------------------------
// Plumbing: serves the chat page and streams your agent's
// answers to the browser. You won't need to change this file —
// your agent lives in agent.mjs.
// ------------------------------------------------------------
import { CHAT_HTML } from "./chat-page.mjs";
import { answerWith } from "./agent.mjs";

export const handler = awslambda.streamifyResponse(
  async (event, responseStream, context) => {
    // GET / → the chat page
    if (event.httpMethod === "GET") {
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
      responseStream.write(CHAT_HTML);
      responseStream.end();
      return;
    }

    // POST /chat → stream the agent's answer as NDJSON
    responseStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: { "Content-Type": "application/x-ndjson", "Transfer-Encoding": "chunked" },
    });
    const send = (obj) => responseStream.write(JSON.stringify(obj) + "\n");

    try {
      const { message, sessionId } = JSON.parse(event.body ?? "{}");
      for await (const chunk of answerWith(message ?? "Hello!", sessionId ?? "no-session")) {
        send(chunk);
      }
      send({ type: "done" });
    } catch (err) {
      // If anything breaks, tell the chat window instead of failing silently
      send({ type: "error", text: `${err.name}: ${err.message}` });
    }
    responseStream.end();
  }
);
