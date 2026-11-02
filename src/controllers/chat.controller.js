const { randomUUID: uuidv4 } = require("node:crypto");
const agentService = require("../services/deepseek.service");
const sessionsRepo = require("../db/sessionsRepo");

async function postMessage(req, res, next) {
  try {
    if(req.body.aiConsent !== '2026-11-02') return res.status(428).json({error:'Before using AI chat, explicitly agree to share your messages with DeepSeek for answering questions and booking requests. Read /api/privacy. You can contact the business directly instead.',consentVersion:'2026-11-02',privacyUrl:'/api/privacy'});
    const { message } = req.body;
    let { sessionId } = req.body;
    const business = req.business; // set by resolveBusiness middleware

    if (!message || typeof message !== "string" || message.length > 4000) {
      return res.status(400).json({ error: "`message` (string) is required." });
    }

    if(sessionId && (typeof sessionId!=='string'||! /^[0-9a-f-]{36}$/i.test(sessionId)))return res.status(400).json({error:'Invalid conversation.'});
    if (!sessionId) sessionId = uuidv4();

    const history = sessionsRepo.getHistory(sessionId, business.id, req.user?.uid || null);
    const { history: updatedHistory, reply, cartActions } = await agentService.chat(business, history, message);
    sessionsRepo.saveHistory(sessionId, business.id, updatedHistory.slice(-60), req.user?.uid || null);

    res.json({ sessionId, reply, cartActions: cartActions || [] });
  } catch (err) {
    next(err);
  }
}

module.exports = { postMessage };
