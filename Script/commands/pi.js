const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

module.exports.config = {
  name: "pi",
  version: "4.0.2",
  hasPermssion: 0,
  credits: "mahimvia",
  description: "Advanced ChatGPT-like Q&A with multi-feature support",
  commandCategory: "AI",
  usages: ".pi <question> | .pi help | .pi model <name> | .pi lang <code> | .pi follow ... | .pi clearhistory",
  cooldowns: 10
};

const EMOJI = {
  loading: "⏳",
  success: "✅",
  error: "❌",
  info: "ℹ️",
  blocked: "🚫",
  timeout: "🕒",
  ai: "🤖",
  admin: "👑",
  spam: "🛑",
  rate: "⚡"
};

const OPENROUTER_API_KEY = "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"; // Replace!
/**
 * Default model set to the best currently available on OpenRouter:
 * anthropic/claude-3-opus (as of 2024, best for general chat and reasoning)
 * You can change this if a newer/better model is released.
 */
const DEFAULT_MODEL = "anthropic/claude-3-opus";
const ADVANCED_MODELS = [
  "openai/gpt-4-turbo",
  "anthropic/claude-3-opus",
  "google/gemini-pro"
];
const LOGDIR = path.join(__dirname, "cache");
const LOGFILE = path.join(LOGDIR, "pi_history.json");
const ERRFILE = path.join(LOGDIR, "pi_error.log");
const CONTEXTFILE = path.join(LOGDIR, "pi_context.json");
const COOLDOWN = 10; // Seconds

// Helper: set emoji reaction
function react(api, emoji, msgid, threadid) {
  api.setMessageReaction(emoji, msgid, () => {}, true);
}

// Helper: get admin status (customize as needed)
function isAdmin(senderID) {
  const adminList = ["100088769563815"]; // Add admin IDs here
  return adminList.includes(senderID + "");
}

// Helper: cooldown check
function checkCooldown(senderID, threadID) {
  if (!fs.existsSync(LOGDIR)) fs.mkdirSync(LOGDIR);
  let times = {};
  if (fs.existsSync(path.join(LOGDIR, "pi_cooldown.json"))) {
    times = JSON.parse(fs.readFileSync(path.join(LOGDIR, "pi_cooldown.json")));
  }
  const key = `${senderID}_${threadID}`;
  const now = Date.now();
  if (times[key] && now - times[key] < COOLDOWN * 1000) return false;
  times[key] = now;
  fs.writeFileSync(path.join(LOGDIR, "pi_cooldown.json"), JSON.stringify(times));
  return true;
}

// Helper: log error
function logError(...args) {
  const msg = `[${new Date().toISOString()}] ` + args.join(" | ") + "\n";
  fs.appendFileSync(ERRFILE, msg);
}

// Helper: log history
function logHistory(threadID, senderID, question, answer, opts={}) {
  let logs = [];
  if (fs.existsSync(LOGFILE)) {
    try { logs = JSON.parse(fs.readFileSync(LOGFILE)); } catch { logs = []; }
  }
  logs.push({
    threadID, senderID, question, answer,
    model: opts.model || DEFAULT_MODEL,
    lang: opts.lang || "en",
    timestamp: Date.now()
  });
  fs.writeFileSync(LOGFILE, JSON.stringify(logs, null, 2));
}

// Helper: manage context (memory per thread)
function getContext(threadID) {
  let ctx = {};
  if (fs.existsSync(CONTEXTFILE)) {
    try { ctx = JSON.parse(fs.readFileSync(CONTEXTFILE)); } catch { ctx = {}; }
  }
  return ctx[threadID] || [];
}
function setContext(threadID, history) {
  let ctx = {};
  if (fs.existsSync(CONTEXTFILE)) {
    try { ctx = JSON.parse(fs.readFileSync(CONTEXTFILE)); } catch { ctx = {}; }
  }
  ctx[threadID] = history;
  fs.writeFileSync(CONTEXTFILE, JSON.stringify(ctx, null, 2));
}

// Helper: language detection (expand as needed)
function getLangCode(str) {
  if (/[\u0980-\u09FF]/.test(str)) return "bn";
  if (/[\u0900-\u097F]/.test(str)) return "hi";
  if (/[\u0400-\u04FF]/.test(str)) return "ru";
  if (/[\u4e00-\u9fff]/.test(str)) return "zh";
  if (/[\u3040-\u30ff]/.test(str)) return "ja";
  return "en";
}

// Helper: translate answer (Google Translate API or similar)
async function translateText(text, targetLang) {
  // Dummy: returns same text. Implement your translation logic here!
  return text;
}

// Helper: get AI answer
async function getAIAnswer(question, apiKey, model = DEFAULT_MODEL, context = [], lang = "en") {
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const messages = [...context, { role: "user", content: question }];
  const payload = {
    model,
    messages,
    max_tokens: 1024,
    temperature: 0.7
  };
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  const response = await axios.post(url, payload, { headers });
  let answer = response.data.choices?.[0]?.message?.content || "No answer.";
  if (lang !== "en") answer = await translateText(answer, lang);
  return answer;
}

module.exports.run = async function({ api, event, args, Users }) {
  const { threadID, messageID, senderID, attachments } = event;
  let question = args.join(" ").trim();
  let model = DEFAULT_MODEL;
  let lang = "en";
  let context = getContext(threadID);

  // Cooldown/anti-spam
  if (!checkCooldown(senderID, threadID)) {
    api.sendMessage(`${EMOJI.spam} Please wait ${COOLDOWN}s before using .pi again.`, threadID, messageID);
    react(api, EMOJI.spam, messageID, threadID);
    return;
  }

  // Usage Help
  if (!question || question.toLowerCase() === "help") {
    api.sendMessage(
      `${EMOJI.info} Usage: .pi <your question>\nOptions:\n- .pi model <modelName> (admin)\n- .pi lang <code> (change response language)\n- .pi follow <your follow-up> (continue last chat)\n- .pi clearhistory (admin)\nExample: .pi What is the capital of Japan?\nBest default model: anthropic/claude-3-opus\n`,
      threadID, messageID
    );
    react(api, EMOJI.info, messageID, threadID);
    return;
  }

  // Admin: clear history
  if (question.toLowerCase() === "clearhistory" && isAdmin(senderID)) {
    if (fs.existsSync(LOGFILE)) fs.unlinkSync(LOGFILE);
    if (fs.existsSync(CONTEXTFILE)) fs.unlinkSync(CONTEXTFILE);
    api.sendMessage(`${EMOJI.admin} History cleared!`, threadID, messageID);
    react(api, EMOJI.admin, messageID, threadID);
    return;
  }

  // Model selection
  if (question.toLowerCase().startsWith("model ")) {
    let reqModel = question.split(" ")[1];
    if (ADVANCED_MODELS.includes(reqModel) && !isAdmin(senderID)) {
      api.sendMessage(`${EMOJI.blocked} Only admins can use advanced models!`, threadID, messageID);
      react(api, EMOJI.blocked, messageID, threadID);
      return;
    }
    model = reqModel || DEFAULT_MODEL;
    api.sendMessage(`${EMOJI.ai} Model set to ${model}`, threadID, messageID);
    react(api, EMOJI.ai, messageID, threadID);
    return;
  }

  // Language selection
  if (question.toLowerCase().startsWith("lang ")) {
    lang = question.split(" ")[1] || "en";
    api.sendMessage(`${EMOJI.info} Response language set to ${lang}`, threadID, messageID);
    react(api, EMOJI.info, messageID, threadID);
    return;
  }

  // Follow-up
  if (question.toLowerCase().startsWith("follow ")) {
    question = question.replace(/^follow\s+/i, "");
    // Context already loaded
  }

  // Start loading reaction
  react(api, EMOJI.loading, messageID, threadID);

  // Handle attachment
  let attachmentPath = null;
  let attachmentType = null;
  let attachmentCaption = "";
  if (attachments && attachments.length > 0) {
    const att = attachments[0];
    attachmentType = att.type;
    const attUrl = att.url;
    const ext = att.type === "photo" ? ".jpg"
              : att.type === "video" ? ".mp4"
              : att.type === "audio" ? ".mp3"
              : att.type === "file" ? path.extname(att.name) || ".dat"
              : ".dat";
    attachmentPath = path.join(LOGDIR, `pi_${senderID}_${Date.now()}${ext}`);
    try {
      const res = await axios.get(attUrl, { responseType: "arraybuffer" });
      fs.writeFileSync(attachmentPath, Buffer.from(res.data, "binary"));
      attachmentCaption = att.name ? `Attachment: ${att.name}` : `Attachment of type ${attachmentType}`;
    } catch (err) {
      api.sendMessage(`${EMOJI.error} Error downloading your file. Try again.`, threadID, messageID);
      react(api, EMOJI.error, messageID, threadID);
      logError("Attachment download", err.message || err.toString());
      return;
    }
  }

  // Get user name
  let userName = "User";
  if (Users && typeof Users.getName === "function") {
    try { userName = await Users.getName(senderID); } catch {}
  }

  // Language auto-detection
  if (lang === "auto") lang = getLangCode(question);

  // AI prompt
  let fullQuestion = `[${userName}] asks: ${question}`;
  if (attachmentType) fullQuestion += `\n[${attachmentCaption}]`;

  try {
    const aiReply = await getAIAnswer(fullQuestion, OPENROUTER_API_KEY, model, context, lang);

    // Limit answer length
    let finalReply = aiReply;
    if (finalReply.length > 4000) finalReply = finalReply.slice(0, 3997) + "...";

    let msgObj = { body: `${EMOJI.success} ${finalReply}` };
    if (attachmentPath && fs.existsSync(attachmentPath)) {
      msgObj.attachment = fs.createReadStream(attachmentPath);
    }
    api.sendMessage(msgObj, threadID, (err, info) => {
      if (!err && info) react(api, EMOJI.success, info.messageID, threadID);
      logHistory(threadID, senderID, question, finalReply, { model, lang });
      // Save new context
      setContext(threadID, [...context, { role: "user", content: question }, { role: "assistant", content: finalReply }]);
    });

  } catch (err) {
    let errMsg = (err.response?.data?.error?.message) || err.message || "Unknown";
    let emoji = EMOJI.error;
    if (/rate/i.test(errMsg)) emoji = EMOJI.rate;
    api.sendMessage(`${emoji} Error communicating with AI: ${errMsg}`, threadID, messageID);
    react(api, emoji, messageID, threadID);
    logError("AI error", errMsg);
  }
};