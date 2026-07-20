const { v4: uuidv4 } = require("uuid");
const agentService = require("../services/deepseek.service");
const sessionsRepo = require("../db/sessionsRepo");

async function postMessage(req, res, next) {
  try {
    const { message } = req.body;
    let { sessionId } = req.body;
    const business = req.business; // set by resolveBusiness middleware

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "`message` (string) is required." });
    }

    if (!sessionId) sessionId = uuidv4();

    const history = sessionsRepo.getHistory(sessionId, business.id);
    const { history: updatedHistory, reply, cartActions } = await agentService.chat(business, history, message);
    sessionsRepo.saveHistory(sessionId, business.id, updatedHistory);

    res.json({ sessionId, reply, cartActions: cartActions || [] });
  } catch (err) {
    next(err);
  }
}

module.exports = { postMessage };
