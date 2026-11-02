const OpenAI = require("openai");
const calendarService = require("./googleCalendar.service");
const workerBookings = require("./workerBooking.service");
const bookingsRepo = require("../db/bookingsRepo");
const businessesRepo = require("../db/businessesRepo");
const menuRepo = require("../db/menuRepo");

// DeepSeek's API is OpenAI-compatible, so we just point the OpenAI SDK
// at DeepSeek's base URL instead of openai.com.
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

function buildSystemPrompt(business) {
  const info = businessesRepo.parsedInfo(business);
  const orderableMenu = menuRepo.getMenuItems(business);

  const today = new Date();
  const todayLabel = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const todayISO = today.toISOString().slice(0, 10); // YYYY-MM-DD

  const orderableMenuText = orderableMenu.length
    ? orderableMenu.map((i) => `- ${i.name} (id: ${i.id}) — $${i.price}`).join("\n")
    : "(No items are currently orderable online — direct customers to call in an order.)";

  if (workerBookings.staffBusiness(business)) {
    return `You are the appointment booking assistant for ${business.name}, a ${business.business_type}.
Today's date in America/Toronto is ${new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(today)}.
Business facts: address ${info.address}; phone ${info.phone}; hours ${info.hours}; about ${info.about}.
This business books appointments with individual workers, not a banquet hall. Do not offer food ordering.
Use list_workers to retrieve real workers; never invent staff names or IDs. Ask whether the customer wants a specific worker or has no preference.
When a worker is requested, pass workerName exactly as the customer requested to check_availability and create_booking; resolve the exact workerUid from list_workers too. If several workers share a name, ask for the full name. Never silently substitute another worker.
For no preference, omit workerUid and workerName and the server selects an available worker. Tell the customer which worker received the request from the successful tool result.
Collect the customer's name, email address for status updates, desired date, start time and duration/end time. Phone is optional. Ask what service they want and store it in notes; do not invent service lengths or prices.
Always call check_availability before offering a time. Its slots are one-hour windows; when booking a different duration, the server checks the entire requested interval again.
Use returned labels as local business times. Only call create_booking after the customer agrees to the appointment details and worker preference. A success=true result with status=pending_worker means a REQUEST, not a confirmed appointment. Tell the customer it awaits worker acceptance, mention the response deadline in business local time, and that they will receive email updates. Only status=confirmed is a confirmed appointment. Never claim a pending request is confirmed. If the requested worker is unavailable, offer another time or ask permission to choose another worker.
Be concise, friendly and use plain text. Do not expose internal tool IDs or narrate internal reasoning.`;
  }
  return `You are the reservations, ordering & information assistant for ${business.name}.

TODAY'S DATE: ${todayLabel} (${todayISO}). Always use this as the actual current date — never guess or infer it from anything else. When a customer says "tomorrow," "this Friday," "next week," etc., calculate the exact date from THIS date, not from any date you might otherwise assume.

RESTAURANT FACTS (always accurate — never contradict these):
- Address: ${info.address}
- Phone: ${info.phone}
- Hours: ${info.hours}
- About: ${info.about}

POPULAR MENU ITEMS (for describing the restaurant — not all of these are necessarily orderable online, check ORDERABLE MENU below for that):
${info.popularMenuItems.map((i) => `- ${i.name} — $${i.price} (${i.desc})`).join("\n")}

CURRENT SPECIALS:
${info.specials.map((i) => `- ${i.name} — $${i.price} (${i.desc})`).join("\n")}

ORDERABLE MENU (use the exact "id" values below when calling add_to_cart):
${orderableMenuText}

BANQUET HALL:
${info.banquetHall.description}
${info.banquetHall.bookingPolicy}

YOUR JOB:
1. Answer general questions about the restaurant, menu, hours, and banquet hall using only the facts above. If you don't know something, say so and suggest calling ${info.phone}.
2. Help customers order food to go:
   a. When a customer wants to order something, match it against the ORDERABLE MENU list above. If it's not on that list (e.g. they ask for a breakfast item that isn't orderable online), let them know it's not available for online ordering and suggest calling in, or offer a similar item that IS orderable.
   b. Use the add_to_cart tool to add items — pass the exact "id" from the ORDERABLE MENU list, and the quantity they want. You can call it multiple times for multiple different items in one turn.
   c. After adding items, confirm what's in their cart and ask if they'd like anything else, or if they're ready to check out.
   d. You do NOT process payment yourself — once they're ready, tell them to use the checkout button/cart panel to complete their order and pay securely. Never claim an order is placed or paid for; only the actual checkout process does that.
3. Help customers book the banquet hall. To do this:
   a. Collect: preferred date, preferred start time, approximate duration (or end time), estimated guest count, and the customer's name, email, and phone number.
   b. Use the check_availability tool to see real open windows on the calendar for the date they want. NEVER invent availability — always call the tool, don't guess.
   c. The tool returns each slot with a human-readable "label" (e.g. "6:00 PM") and machine "start"/"end" timestamps. Trust the "label" for talking to the customer — don't try to re-derive or second-guess the time from the timestamps, and don't reason out loud about timezones. When you later call create_booking, pass back the exact "start"/"end" timestamp strings the tool gave you for the slot the customer picked, unmodified.
   d. Offer the customer 2-3 concrete free time options based on what the tool returns.
   e. Once the customer confirms a specific date/time and you have their name and at least a phone or email, use the create_booking tool to book it.
   f. After booking, confirm the details back to them and mention a staff member may follow up about catering/deposit.
4. Be warm, concise, and conversational — this is a phone/chat-style interaction, not a document. Avoid long bulleted lists in replies to the customer; talk naturally.
5. Never narrate your internal reasoning, uncertainty, or tool-checking process to the customer (e.g. don't say things like "let me check," "let me recalculate," or think out loud about dates/timezones in your reply). Do that reasoning silently, then give the customer a clean, confident answer.
6. Write in plain text only — this reply is displayed as-is, with no formatting support. NEVER use Markdown: no **asterisks for bold**, no bullet points with "-" or "•", no headers, no numbered lists with periods. If you want to list a few things, write them as a normal sentence separated by commas or "and," the way you'd actually say it out loud on a phone call. Emojis are fine sparingly (one per message at most), but skip them for anything involving bookings, confirmations, or business-hours facts.
7. Never fabricate a booking confirmation without actually calling create_booking successfully, and never claim items were added to the cart without actually calling add_to_cart successfully.`;
}

// OpenAI-compatible "function" tool schema (DeepSeek uses this same shape).
const tools = [
  {type:'function',function:{name:'list_workers',description:'List workers who accept appointments at this business. Use these exact IDs and names.',parameters:{type:'object',properties:{}}}},
  {
    type: "function",
    function: {
      name: "check_availability",
      description:
        "Check real booking availability for a specific date. Returns open business hours and which 1-hour windows are free or busy. Always call this before offering times to a customer.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date to check, formatted YYYY-MM-DD" },
          workerUid: {type:'string',description:'Exact worker UID from list_workers, when requested.'},
          workerName: {type:'string',description:'Worker name the customer explicitly requested. Never substitute another name.'},
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
        "Create an appointment request awaiting worker acceptance, or a confirmed restaurant banquet booking. Only call this after the customer has confirmed a specific date and time that was verified as free via check_availability, and you have their name and contact information. Appointment businesses require email for status updates.",
      parameters: {
        type: "object",
        properties: {
          workerUid: {type:'string',description:'Exact worker UID from list_workers, if requested.'},
          workerName: {type:'string',description:'The name the customer explicitly requested, if any.'},
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
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description:
        "Add a food item to the customer's cart for online ordering. Use the exact item id from the ORDERABLE MENU list in your instructions. Call this once per distinct item (with the right quantity), not once per unit.",
      parameters: {
        type: "object",
        properties: {
          itemId: { type: "string", description: "The exact 'id' of the menu item, from the ORDERABLE MENU list." },
          quantity: { type: "integer", description: "How many of this item to add. Defaults to 1." },
        },
        required: ["itemId"],
      },
    },
  },
];

async function runTool(name, input, business) {
  if (name === 'list_workers') return workerBookings.workers(business.id);
  if (name === "check_availability") {
    if(workerBookings.staffBusiness(business)) {
      try { return await workerBookings.availability(input.date,business,input); }
      catch(error) { if(error.publicMessage) return {success:false,error:error.publicMessage};throw error; }
    }
    return await calendarService.getAvailabilityForDate(input.date, business);
  }

  if (name === "create_booking") {
    if(workerBookings.staffBusiness(business)) {
      try { return await workerBookings.create(business,input,'agent'); }
      catch(error) { if(error.publicMessage) return {success:false,error:error.publicMessage};throw error; }
    }
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

  if (name === "add_to_cart") {
    const menuItem = menuRepo.findMenuItem(business, input.itemId);
    if (workerBookings.staffBusiness(business)) return {success:false,error:'Food ordering is not available for this appointment business.'};
    if (!menuItem) {
      return { success: false, error: `No menu item with id "${input.itemId}" was found.` };
    }
    const quantity = Math.max(1, parseInt(input.quantity, 10) || 1);
    // Returned as a structured "cart action" — the calling code (chat())
    // collects these separately from the reply text so the frontend
    // widget can update the visible cart UI, not just show a sentence.
    return {
      success: true,
      cartAction: { id: menuItem.id, name: menuItem.name, price: menuItem.price, quantity },
    };
  }

  return { error: `Unknown tool: ${name}` };
}

/**
 * Run one turn of the agent for a specific business.
 * `history` is prior OpenAI-format messages (no system prompt included).
 * Returns { history, reply, cartActions } — cartActions is a list of
 * { id, name, price, quantity } for any successful add_to_cart calls this
 * turn, so the frontend can update the cart UI alongside the chat reply.
 */
async function chat(business, history, userMessage) {
  const messages = [
    { role: "system", content: buildSystemPrompt(business) },
    ...history,
    { role: "user", content: userMessage },
  ];
  const cartActions = [];

  for (let i = 0; i < 5; i++) {
    const response = await deepseek.chat.completions.create({
      model: MODEL,
      messages,
      tools: workerBookings.staffBusiness(business) ? tools.filter(tool=>tool.function.name !== 'add_to_cart') : tools.filter(tool=>tool.function.name !== 'list_workers'),
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    const msg = choice.message;
    messages.push(msg);

    if (choice.finish_reason !== "tool_calls" || !msg.tool_calls?.length) {
      const historyToSave = messages.slice(1);
      return { history: historyToSave, reply: msg.content || "", cartActions };
    }

    for (const toolCall of msg.tool_calls) {
      let result;
      try {
        const input = JSON.parse(toolCall.function.arguments || "{}");
        result = await runTool(toolCall.function.name, input, business);
        if (result?.success && result?.cartAction) {
          cartActions.push(result.cartAction);
        }
      } catch (err) {
        console.error(`[deepseek] Tool ${toolCall.function.name} failed:`, err);
        result = {
          success: false,
          error: "That action couldn't be completed due to a technical issue. Apologize to the customer and suggest calling the restaurant directly instead.",
        };
      }
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
    cartActions,
  };
}

module.exports = { chat, runTool };
