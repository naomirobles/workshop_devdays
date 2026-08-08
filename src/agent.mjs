import { Agent, BedrockModel, tool } from "@strands-agents/sdk";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const model = new BedrockModel({
  modelId: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
});

// ---------- Memory: same load/save as Module 2 ----------

async function loadHistory(sessionId) {
  const resp = await ddb.send(new GetCommand({
    TableName: process.env.SESSIONS_TABLE,
    Key: { sessionId },
  }));
  return resp.Item ? JSON.parse(resp.Item.messages) : [];
}

async function saveHistory(sessionId, messages) {
  await ddb.send(new PutCommand({
    TableName: process.env.SESSIONS_TABLE,
    Item: {
      sessionId,
      messages: JSON.stringify(messages),
      expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    },
  }));
}

// ---------- Tools: things your agent can DECIDE to do ----------

const lookUpProduct = tool({
  name: "look_up_product",
  description:
    "Look up a product in the store catalog by name. The catalog is stored " +
    "in English, so always translate the product name to English before " +
    "searching (e.g. 'micrófono' -> 'microphone').",
  inputSchema: z.object({
    product_name: z.string().describe("The product to search for, in English, e.g. 'guitar'"),
  }),
  callback: async ({ product_name }) => {
    const resp = await ddb.send(new ScanCommand({ TableName: process.env.PRODUCTS_TABLE }));
    const matches = resp.Items.filter((item) =>
      item.name.toLowerCase().includes(product_name.toLowerCase())
    );
    if (matches.length === 0) return `No products found matching '${product_name}'.`;
    return JSON.stringify(matches);
  },
});

const checkStock = tool({
  name: "check_stock",
  description:
    "Check whether a product is in stock by name. The catalog is stored " +
    "in English, so always translate the product name to English before " +
    "searching (e.g. 'micrófono' -> 'microphone').",
  inputSchema: z.object({
    product_name: z.string().describe("The product to check stock for, in English, e.g. 'guitar'"),
  }),
  callback: async ({ product_name }) => {
    const resp = await ddb.send(new ScanCommand({ TableName: process.env.PRODUCTS_TABLE }));
    const matches = resp.Items.filter((item) =>
      item.name.toLowerCase().includes(product_name.toLowerCase())
    );
    if (matches.length === 0) return `No products found matching '${product_name}'.`;
    return JSON.stringify(
      matches.map((item) => ({
        name: item.name,
        in_stock: item.stock !== undefined ? item.stock > 0 : item.in_stock ?? true,
        stock: item.stock,
      }))
    );
  },
});

const checkShipping = tool({
  name: "check_shipping",
  description: "Check shipping time to a country.",
  inputSchema: z.object({
    country: z.string().describe("Destination country, e.g. 'Brazil'"),
  }),
  callback: ({ country }) => {
    const days = { brazil: 3, mexico: 2, colombia: 4, argentina: 5, chile: 4, peru: 4, "united states": 2 };
    const d = days[country.trim().toLowerCase()];
    if (d === undefined) return `Sorry, we don't ship to ${country} yet.`;
    return `Shipping to ${country} takes about ${d} business days.`;
  },
});

const checkFutureStock = tool({
  name: "check_future_stock",
  description:
    "Check whether a product will be available in the future catalog by name. " +
    "The catalog is stored in English, so always translate the product name to " +
    "English before searching (e.g. 'maracas' -> 'maracas').",
  inputSchema: z.object({
    product_name: z.string().describe("The product to check future stock for, in English, e.g. 'maracas'"),
  }),
  callback: async ({ product_name }) => {
    const resp = await ddb.send(new ScanCommand({ TableName: process.env.FUTURE_PRODUCTS_TABLE }));
    const matches = resp.Items.filter((item) =>
      item.name.toLowerCase().includes(product_name.toLowerCase())
    );
    if (matches.length === 0) return `No future products found matching '${product_name}'.`;
    return JSON.stringify(
      matches.map((item) => ({
        name: item.name,
        description: item.description,
        price: item.price,
        in_stock: item.stock !== undefined ? item.stock > 0 : item.in_stock ?? true,
        stock: item.stock,
      }))
    );
  },
});

const SYSTEM_PROMPT =
  "You are a shop assistant for 'Nube', an online store, and a die-hard rock music fan. " +
  "Use your tools to answer questions about products and shipping. " +
  "Speak with the energy and passion of a rock fan: reference bands, albums, guitar riffs, " +
  "stage energy, and rock culture naturally in your replies. Use rock slang and analogies " +
  "(e.g. compare fast shipping to a Metallica drum solo, describe a product like it's a legendary guitar). " +
  "Keep answers helpful and concise but always with that rock attitude — loud, enthusiastic, no-nonsense.";

export async function* answerWith(message, sessionId) {
  const history = await loadHistory(sessionId);
  const agent = new Agent({
    model,
    systemPrompt: SYSTEM_PROMPT,
    messages: history,
    tools: [lookUpProduct, checkShipping, checkStock, checkFutureStock],
    printer: false,
  });

  for await (const ev of agent.stream(message)) {
    if (ev.type === "modelStreamUpdateEvent" &&
        ev.event.type === "modelContentBlockDeltaEvent" &&
        ev.event.delta?.type === "textDelta") {
      yield { type: "token", text: ev.event.delta.text };
    } else if (ev.type === "beforeToolCallEvent") {
      yield { type: "tool", name: ev.toolUse?.name ?? "tool" };
    }
  }

  await saveHistory(sessionId, agent.messages);
}