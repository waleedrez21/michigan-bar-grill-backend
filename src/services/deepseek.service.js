const OpenAI = require("openai");
const calendarService = require("./googleCalendar.service");
const bookingsRepo = require("../db/bookingsRepo");
const businessesRepo = require("../db/businessesRepo");

// DeepSeek's API is OpenAI-compatible, so we just point the OpenAI SDK
// at DeepSeek's base URL instead of openai.com.
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

function buildSystemPrompt(business) {
  const info = businessesRepo.parsedInfo(business);

  const today = new Date();
  const todayLabel = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const todayISO = today.toISOString().slice(0, 10); // YYYY-MM-DD

  return `You are the reservations & information assistant for ${business.name}.

TODAY'S DATE: ${todayLabel} (${todayISO}). Always use this as the actual current date — never guess or infer it from anything else. When a customer says "tomorrow," "this Friday," "next week," etc., calculate the exact date from THIS date, not from any date you might otherwise assume.

RESTAURANT FACTS (always accurate — never contradict these):
- Address: ${info.address}
- Phone: ${info.phone}
- Hours: ${info.hours}
- About: ${info.about}

POPULAR MENU ITEMS:
${info.popularMenuItems.map((i) => `- ${i.name} — $${i.price} (${i.desc})`).join("\n")}

CURRENT SPECIALS:
${info.specials.map((i) => `- ${i.name} — $${i.price} (${i.desc})`).join("\n")}

BANQUET HALL:
${info.banquetHall.description}
${info.banquetHall.bookingPolicy}

YOUR JOB:
1. Answer general questions about the restaurant, menu, hours, and banquet hall using only the facts above. If you don't know something, say so and suggest calling ${info.phone}.
2. Help customers book the banquet hall. To do this:
   a. Collect: preferred date, preferred start time, approximate duration (or end time), estimated guest count, and the customer's name, email, and phone number.
   b. Use the check_availability tool to see real open windows on the calendar for the date they want. NEVER invent availability — always call the tool, don't guess.
   c. The tool returns each slot with a human-readable "label" (e.g. "6:00 PM") and machine "start"/"end" timestamps. Trust the "label" for talking to the customer — don't try to re-derive or second-guess the time from the timestamps, and don't reason out loud about timezones. When you later call create_booking, pass back the exact "start"/"end" timestamp strings the tool gave you for the slot the customer picked, unmodified.
   d. Offer the customer 2-3 concrete free time options based on what the tool returns.
   e. Once the customer confirms a specific date/time and you have their name and at least a phone or email, use the create_booking tool to book it.
   f. After booking, confirm the details back to them and mention a staff member may follow up about catering/deposit.
3. Be warm, concise, and conversational — this is a phone/chat-style interaction, not a document. Avoid long bulleted lists in replies to the customer; talk naturally.
4. Never narrate your internal reasoning, uncertainty, or tool-checking process to the customer (e.g. don't say things like "let me check," "let me recalculate," or think out loud about dates/timezones in your reply). Do that reasoning silently, then give the customer a clean, confident answer.
5. Never fabricate a booking confirmation without actually calling create_booking successfully.`;
}

// OpenAI-compatible "function" tool schema (DeepSeek uses this same shape).
const tools = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "Check the banquet hall's real availability for a specific date. Returns open business hours and which 1-hour windows are free or busy. Always call this before offering times to a customer.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date to check, formatted YYYY-MM-DD" },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking",
      description:
        "Create a confirmed banquet hall booking on the calendar. Only call this after the customer has confirmed a specific date and time that was verified as free via check_availability, and you have their name plus phone or email.",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string" },
          customerEmail: { type: "string" },
          customerPhone: { type: "string" },
          partySize: { type: "integer" },
          startDateTime: { type: "string", description: "ISO 8601 local datetime, e.g. 2026-08-14T18:00:00" },
          endDateTime: { type: "string", description: "ISO 8601 local datetime, e.g. 2026-08-14T21:00:00" },
          notes: { type: "string", description: "Any extra details the customer shared" },
        },
        required: ["customerName", "startDateTime", "endDateTime"],
      },
    },
  },
];

async function runTool(name, input, business) {
  if (name === "check_availability") {
    return await calendarService.getAvailabilityForDate(input.date, business);
  }

  if (name === "create_booking") {
    if (!calendarService.isWithinBusinessHours(input.startDateTime, input.endDateTime, business)) {
      return { success: false, error: "Requested time is outside business hours or on a closed day." };
    }
    const free = await calendarService.isSlotFree(input.startDateTime, input.endDateTime, business);
    if (!free) {
      return { success: false, error: "That time is no longer available. Please suggest checking availability again." };
    }

    const event = await calendarService.createBookingEvent({
      business,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      partySize: input.partySize,
      startISO: input.startDateTime,
      endISO: input.endDateTime,
      notes: input.notes,
    });

    // Mirrored into SQLite too — this is what the owner's app reads via
    // GET /api/bookings, scoped to this business by their API key.
    bookingsRepo.insertBooking({
      businessId: business.id,
      googleEventId: event.id,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      partySize: input.partySize,
      startTime: input.startDateTime,
      endTime: input.endDateTime,
      notes: input.notes,
      source: "agent",
    });

    return { success: true, eventId: event.id, htmlLink: event.htmlLink };
  }

  return { error: `Unknown tool: ${name}` };
}

/**
 * Run one turn of the agent for a specific business.
 * `history` is prior OpenAI-format messages (no system prompt included).
 */
async function chat(business, history, userMessage) {
  const messages = [
    { role: "system", content: buildSystemPrompt(business) },
    ...history,
    { role: "user", content: userMessage },
  ];

  for (let i = 0; i < 5; i++) {
    const response = await deepseek.chat.completions.create({
      model: MODEL,
      messages,
      tools,
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    const msg = choice.message;
    messages.push(msg);

    if (choice.finish_reason !== "tool_calls" || !msg.tool_calls?.length) {
      const historyToSave = messages.slice(1);
      return { history: historyToSave, reply: msg.content || "" };
    }

    for (const toolCall of msg.tool_calls) {
      const input = JSON.parse(toolCall.function.arguments || "{}");
      const result = await runTool(toolCall.function.name, input, business);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  const historyToSave = messages.slice(1);
  const info = businessesRepo.parsedInfo(business);
  return {
    history: historyToSave,
    reply: "Sorry, something went wrong processing that. Please call us at " + info.phone + ".",
  };
}

module.exports = { chat };
