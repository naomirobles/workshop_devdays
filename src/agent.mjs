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

const COORDS = {
  "cedis amazon area metropolitana": { lat: 19.7128, lon: -99.2258 },
  "cedis cdmx":                      { lat: 19.7128, lon: -99.2258 },
  "cedis edomex":                    { lat: 19.7128, lon: -99.2258 },
  "cedis amazon nuevo leon":         { lat: 25.7785, lon: -100.1858 },
  "cedis monterrey":                 { lat: 25.7785, lon: -100.1858 },
};

function resolveCoords(text) {
  const key = text.trim().toLowerCase();
  for (const [k, v] of Object.entries(COORDS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

const getRoutes = tool({
  name: "get_routes",
  description:
    "Given an origin and a destination (both must be known CEDIS locations), " +
    "returns up to 3 driving route options with distance (km), estimated duration (hours), " +
    "and the route geometry coordinates. Use this when the user asks for routes between two points.",
  inputSchema: z.object({
    origin:      z.string().describe("Origin location, e.g. 'CEDIS Amazon área metropolitana'"),
    destination: z.string().describe("Destination location, e.g. 'CEDIS Amazon Nuevo León'"),
  }),
  callback: async ({ origin, destination }) => {
    const from = resolveCoords(origin);
    const to   = resolveCoords(destination);
    if (!from) return `No reconozco el origen "${origin}". Por favor aclara el punto de partida.`;
    if (!to)   return `No reconozco el destino "${destination}". Por favor aclara el punto de llegada.`;

    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${from.lon},${from.lat};${to.lon},${to.lat}` +
      `?alternatives=true&overview=full&geometries=geojson`;

    let res;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
    } catch (err) {
      return `Error al conectar con el servicio de rutas: ${err.message}`;
    }

    if (!res.ok) return `El servicio de rutas respondió con error ${res.status}.`;

    const data = await res.json();
    if (!data.routes || data.routes.length === 0) return "No se encontraron rutas entre esos puntos.";

    const routes = data.routes.slice(0, 3).map((r, i) => ({
      label:       `Ruta ${i + 1}`,
      distance_km: Math.round((r.distance / 1000) * 10) / 10,
      duration_hr: Math.round((r.duration / 3600) * 10) / 10,
      coordinates: r.geometry.coordinates,
    }));

    return JSON.stringify(routes);
  },
});

const SYSTEM_PROMPT =
  "Eres un asistente especializado en logística y geodatos para la tienda 'Nube'. " +
  "Hablas con la precisión y autoridad de un experto en cadena de suministro y análisis espacial: " +
  "usas términos técnicos como tiempo de tránsito, throughput, nodo de distribución, cobertura geográfica, " +
  "coordenadas, polígonos de cobertura y optimización de rutas de forma natural y fluida. " +
  "Eres directo, estructurado y orientado a datos — cuando das información, la acompañas de cifras y contexto operativo. " +
  "\n\n" +
  "Cuando el usuario pregunte por una ruta entre dos puntos (ej. 'quiero ir del CEDIS del área " +
  "metropolitana al de Nuevo León'), llama a la tool get_routes con esos dos puntos. " +
  "Responde en español listando cada opción así:\n" +
  "  Ruta 1 — Xkm · Yh de tránsito estimado\n" +
  "  Ruta 2 — ...\n" +
  "Comenta brevemente las diferencias operativas entre rutas (distancia, tiempo). " +
  "Al final de la respuesta de rutas, aclara siempre: " +
  "'En la siguiente iteración cruzaremos estas rutas con datos de incidentes para recomendarte la ruta de menor riesgo operativo.'";

export async function* answerWith(message, sessionId) {
  const history = await loadHistory(sessionId);
  const agent = new Agent({
    model,
    systemPrompt: SYSTEM_PROMPT,
    messages: history,
    tools: [lookUpProduct, checkShipping, checkStock, checkFutureStock, getRoutes],
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