const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const CONTEXT_FILE = path.join(__dirname, "cache", "pi_context.json");
let contextStore = {};
if (fs.existsSync(CONTEXT_FILE)) {
  contextStore = fs.readJsonSync(CONTEXT_FILE);
}
function saveContext() {
  fs.writeJsonSync(CONTEXT_FILE, contextStore);
}
function getContext(threadID, userID) {
  const key = `${threadID}_${userID}`;
  return contextStore[key] || [];
}
function updateContext(threadID, userID, userMsg, botMsg) {
  const key = `${threadID}_${userID}`;
  if (!contextStore[key]) contextStore[key] = [];
  contextStore[key].push({ user: userMsg, bot: botMsg });
  contextStore[key] = contextStore[key].slice(-5);
  saveContext();
}
function detectLanguage(text) {
  const langCode = franc(text, { minLength: 3 });
  if (langCode === "und") return "en";
  try {
    const lang = langs.where("3", langCode);
    return lang["1"];
  } catch {
    return "en";
  }
}

module.exports.config = {
  name: "pi",
  version: "2.0.0",
  hasPermssion: 0,
  credits: "mahimvia, Mahim Islam",
  description: "🌸 — mahim bot ୨୧ | Chat with AI (Together.xyz, memory, language, persona, emoji)",
  commandCategory: "AI Chat",
  usages: "[your question]",
  cooldowns: 5
};

const customPrompt = `
Your boss is Mahim Islam. Your name is 🌸 — mahim bot ୨୧.
You are a friendly, helpful AI assistant for Messenger. Always try to remember the user's name and previous conversation details.
You answer questions, solve problems, and make conversation warm and cheerful. Greet people, sometimes use emojis.
If the user specifies a language, reply in that language. Always react to user messages with a cherry emoji.
`;

module.exports.run = async function({ api, event, args, Users }) {
  let userMsg = args.join(" ").trim();
  const threadID = event.threadID;
  const userID = event.senderID;
  const userInfo = await Users.getData(userID) || {};
  const userName = userInfo.name || "User";

  // If replying to bot message, treat replied message as input
  if (event.type === "message_reply" && event.messageReply?.senderID === api.getCurrentUserID()) {
    userMsg = event.body.trim();
  }

  if (!userMsg) {
    return api.sendMessage("❌ Please provide a message to chat with AI.", threadID, event.messageID);
  }

  // React to user's message with cherry emoji
  api.setMessageReaction("🍒", event.messageID, () => {}, true);

  // Build context prompt
  const oldContext = getContext(threadID, userID);

  // Detect language for reply
  const langIso = detectLanguage(userMsg);
  const replyLang = langs.where("1", langIso)?.name || "English";
  let systemPrompt = customPrompt + `\nThe user's name is ${userName}. If possible, reply in ${replyLang}.`;

  // Together.xyz API call
  api.sendMessage("⏳ Thinking...", threadID, event.messageID);

  try {
    const response = await axios.post(
      "https://api.together.xyz/v1/chat/completions",
      {
        model: "togethercomputer/llama-2-7b-chat",
        messages: [
          { role: "system", content: systemPrompt },
          ...oldContext.flatMap(e => [
            { role: "user", content: e.user },
            { role: "assistant", content: e.bot }
          ]),
          { role: "user", content: userMsg }
        ]
      },
      {
        headers: {
          "Authorization": "Bearer tgp_v1_gSGr4xOlJGKdPASnQjLm6LHLx0sr6qmCnROOQFT_aCk",
          "Content-Type": "application/json"
        }
      }
    );
    const answer = response.data.choices?.[0]?.message?.content || "⚠️ No response from AI.";

    // Store exchange for future context
    updateContext(threadID, userID, userMsg, answer);

    api.sendMessage(answer, threadID, event.messageID);
  } catch (err) {
    api.sendMessage("❌ Error: Could not get response from AI.\n" + (err.response?.data?.error || err.message), threadID, event.messageID);
  }
};

// Prefixless reply support
module.exports.handleEvent = async function({ api, event, args, Users }) {
  if (
    event.type === "message_reply" &&
    event.messageReply?.senderID === api.getCurrentUserID()
  ) {
    module.exports.run({ api, event, args: [event.body], Users });
  }
};