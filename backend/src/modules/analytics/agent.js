/**
 * Analytics agent — Groq tool-use loop (FR19–FR24, NFR13–NFR15).
 *
 * Architecture:
 *   - All four analytics read-tools are pure Prisma functions (no LLM dependency).
 *   - The agent loop + submitRecommendations are the only places that touch Groq.
 *   - This deliberate boundary means swapping Groq for any OpenAI-compatible provider
 *     only changes `callGroq()` — the tool logic, validation, and persistence are untouched.
 *
 * Loop invariants:
 *   - Max 6 iterations (NFR13). If `submitRecommendations` is never called, return an error.
 *   - `lookbackWeeks` is clamped to 8 before the first Groq call (EC15).
 *   - Max 5 recommendations per run (enforced in system prompt + validated on submit).
 *   - Each recommendation must have `evidence` + valid `suggestedAction` enum (NFR14).
 *   - REMOVE_FROM_BASE requires cross-referencing special-trip frequency (EC13).
 *
 * Groq tool-calling shape (OpenAI-compatible):
 *   response.choices[0].message.tool_calls[].function.name    → string
 *   response.choices[0].message.tool_calls[].function.arguments → JSON string (must JSON.parse)
 *   tool result role: "tool", with matching tool_call_id
 */

const Groq = require("groq-sdk");
const { getUtilizationByRouteTime } = require("./tools/utilization");
const { getContentionRate } = require("./tools/contention");
const { getCancellationPatterns } = require("./tools/cancellation");
const { getSpecialTripFrequency } = require("./tools/specialTrips");
const { persistRecommendations } = require("./recommendation.service");

const MAX_ITERATIONS = 6; // NFR13
const MAX_LOOKBACK_WEEKS = 8; // EC15
const MAX_RECOMMENDATIONS = 5;

// ─── Tool definitions (OpenAI-compatible schema) ──────────────────────────────

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "getUtilizationByRouteTime",
      description:
        "Returns seat utilization (bookedSeats / totalSeats) grouped by (origin, destination, departureTime, dayOfWeek). Use this to identify over- or under-subscribed slots.",
      parameters: {
        type: "object",
        properties: {
          lookbackWeeks: {
            type: "number",
            description: "How many weeks of history to include. Max 8.",
          },
        },
        required: ["lookbackWeeks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getContentionRate",
      description:
        "Returns the hold-failure rate (HOLD_FAILED / total hold attempts) per (origin, destination, departureTime, dayOfWeek). High contention = demand exceeds capacity.",
      parameters: {
        type: "object",
        properties: {
          lookbackWeeks: {
            type: "number",
            description: "How many weeks of history to include. Max 8.",
          },
        },
        required: ["lookbackWeeks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getCancellationPatterns",
      description:
        "Returns cancellation rate (CANCELLED / total bookings) per (origin, destination, departureTime, dayOfWeek). Filtered by createdAt, not cancelledAt.",
      parameters: {
        type: "object",
        properties: {
          lookbackWeeks: {
            type: "number",
            description: "How many weeks of history to include. Max 8.",
          },
        },
        required: ["lookbackWeeks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getSpecialTripFrequency",
      description:
        "Returns how many special (admin-created) trips exist per slot. High frequency means the base schedule is missing demand — use this before recommending REMOVE_FROM_BASE.",
      parameters: {
        type: "object",
        properties: {
          lookbackWeeks: {
            type: "number",
            description: "How many weeks of history to include. Max 8.",
          },
        },
        required: ["lookbackWeeks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "submitRecommendations",
      description:
        "Submit your final list of recommendations (max 5). Each recommendation MUST have `evidence` (non-empty string citing specific data) and `suggestedAction` from the allowed enum.",
      parameters: {
        type: "object",
        properties: {
          recommendations: {
            type: "array",
            description: "Array of recommendation objects.",
            items: {
              type: "object",
              properties: {
                origin: { type: "string" },
                destination: { type: "string" },
                departureTime: { type: "string", description: "HH:MM format" },
                dayOfWeek: { type: "number", description: "1=Mon … 7=Sun" },
                suggestedAction: {
                  type: "string",
                  enum: [
                    "ADD_TO_BASE",
                    "REMOVE_FROM_BASE",
                    "INCREASE_FREQUENCY",
                    "DECREASE_FREQUENCY",
                    "INVESTIGATE_CANCELLATIONS",
                  ],
                },
                evidence: {
                  type: "string",
                  description:
                    "Concrete data from the tools that supports this recommendation. Do not leave blank.",
                },
                tripType: {
                  type: "string",
                  enum: ["BASE", "SPECIAL"],
                  description: "Defaults to BASE if omitted.",
                },
              },
              required: ["origin", "destination", "departureTime", "suggestedAction", "evidence"],
            },
          },
        },
        required: ["recommendations"],
      },
    },
  },
];

// ─── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(lookbackWeeks) {
  return `You are an analytics agent for UniBus, a college bus seat-booking platform.
Your job is to analyse historical booking data and recommend schedule changes.

You have access to 4 read tools and 1 submit tool:
  • getUtilizationByRouteTime   — seat fill rate per route/time/day
  • getContentionRate           — hold failure rate (proxy for frustrated demand)
  • getCancellationPatterns     — cancellation rate per route/time/day
  • getSpecialTripFrequency     — admin-created trips (gap-filling signal)
  • submitRecommendations       — submit your final recommendations (call this ONCE when done)

Rules you MUST follow:
1. Call at least 2 read tools before submitting (cross-reference, EC12).
2. Before recommending REMOVE_FROM_BASE for any slot, you MUST call getSpecialTripFrequency
   for that lookback period. If special trip frequency is high for that slot, do NOT recommend
   REMOVE_FROM_BASE — recommend INVESTIGATE_CANCELLATIONS or leave it. (EC13)
3. Every recommendation MUST include a non-empty "evidence" string quoting specific numbers
   from the tool results (e.g. "utilization 0.12, contention 0.03 over ${lookbackWeeks} weeks"). (NFR14)
4. suggestedAction MUST be one of: ADD_TO_BASE, REMOVE_FROM_BASE, INCREASE_FREQUENCY,
   DECREASE_FREQUENCY, INVESTIGATE_CANCELLATIONS. No other values are accepted. (NFR14)
5. Submit at most ${MAX_RECOMMENDATIONS} recommendations total.
6. lookbackWeeks for all tool calls: use ${lookbackWeeks} (already validated server-side).

Think step by step. Use the data, then call submitRecommendations once with your final list.`;
}

// ─── Groq API call ────────────────────────────────────────────────────────────

let groqClient = null;

function getGroqClient() {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

async function callGroq(messages, tools) {
  const groq = getGroqClient();
  return groq.chat.completions.create({
    model: "qwen/qwen3.8-27b",
    messages,
    tools,
    tool_choice: "auto",
    max_tokens: 4096,
  });
}

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

const TOOL_MAP = {
  getUtilizationByRouteTime,
  getContentionRate,
  getCancellationPatterns,
  getSpecialTripFrequency,
};

async function dispatchTool(name, argsStr) {
  const args = typeof argsStr === "string" ? JSON.parse(argsStr) : argsStr;
  const fn = TOOL_MAP[name];
  if (!fn) throw new Error(`Unknown tool: ${name}`);
  return fn(args);
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

/**
 * Run a single analytics turn with the bounded Groq tool-use loop.
 *
 * @param {number} [lookbackWeeksInput=4]
 * @returns {{ recommendations?: Array, saved?: number, skipped?: number, error?: string }}
 */
async function runAnalyticsTurn(lookbackWeeksInput = 4) {
  // EC15: clamp lookback
  const lookbackWeeks = Math.min(Number(lookbackWeeksInput) || 4, MAX_LOOKBACK_WEEKS);

  const messages = [
    { role: "system", content: buildSystemPrompt(lookbackWeeks) },
    {
      role: "user",
      content: `Please analyse the last ${lookbackWeeks} weeks of data and submit your schedule recommendations.`,
    },
  ];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const response = await callGroq(messages, TOOL_DEFINITIONS);
    const choice = response.choices[0];
    const assistantMsg = choice.message;

    // Always push the assistant message into history
    messages.push(assistantMsg);

    const toolCalls = assistantMsg.tool_calls;

    // No tool calls → model is done (or confused); treat as incomplete
    if (!toolCalls || toolCalls.length === 0) {
      break;
    }

    // Process each tool call in this response
    let submitted = false;
    for (const tc of toolCalls) {
      const toolName = tc.function.name;
      const toolArgs = tc.function.arguments; // JSON string from Groq

      if (toolName === "submitRecommendations") {
        // Final action — validate + persist
        const args = typeof toolArgs === "string" ? JSON.parse(toolArgs) : toolArgs;
        const rawList = (args.recommendations || []).slice(0, MAX_RECOMMENDATIONS);
        const result = await persistRecommendations(rawList);

        // Push tool result so the conversation is formally closed
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ success: true, saved: result.saved }),
        });

        return result;
      }

      // Read tool — execute and push result back
      let toolResult;
      try {
        toolResult = await dispatchTool(toolName, toolArgs);
      } catch (err) {
        toolResult = { error: err.message };
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      });
    }

    if (submitted) break;
  }

  // EC14: iteration cap hit without submitRecommendations
  return {
    error: "Analysis incomplete: agent did not submit recommendations within the iteration limit.",
    recommendations: [],
    saved: 0,
    skipped: 0,
  };
}

module.exports = { runAnalyticsTurn };
