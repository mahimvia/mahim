const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const franc = require("franc");

module.exports.config = {
  name: "pi",
  version: "9.2.0",
  hasPermssion: 0,
  credits: "mahimvia",
  description: "Together.ai chat. Stores user info, heart react only, custom bot prompt.",
  commandCategory: "AI",
  usages: ".pi <question> (new topic); reply with normal message to continue.",
  cooldowns: 10
};

const botPrompt = `Your name is 🌸 — mahim bot ୨୧, and your owner is Mahim Islam. You're a friendly chat bot, never share your company’s confidential or technical details. You are a 16-year-old helpful assistant.`;

const TOGETHER_API_URL = "https://api.together.xyz/v1";
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY || "2aba4dc1d5295510a4b382cd0d1d2e6737a10ca565848738c95d3813bc16e87f";
let defaultModel = "mistralai/Mixtral-8x7B-Instruct-v0.1";

const LOGDIR = path.join(__dirname, "cache");
const CONTEXTFILE = path.join(LOGDIR, "pi_context.json");
const USERINFOFILE = path.join(LOGDIR, "pi_userinfo.json");
const COOLDOWN = 10; // Seconds

function checkCooldown(senderID, threadID) {
  if (!fs.existsSync(LOGDIR)) fs.mkdirSync(LOGDIR);
  let times = {};
  const file = path.join(LOGDIR, "pi_cooldown.json");
  if (fs.existsSync(file)) {
    times = JSON.parse(fs.readFileSync(file));
  }
  const key = `${senderID}_${threadID}`;
  const now = Date.now();
  if (times[key] && now - times[key] < COOLDOWN * 1000) return false;
  times[key] = now;
  fs.writeFileSync(file, JSON.stringify(times));
  return true;
}

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
  ctx[threadID] = history.slice(-10); // last 10 exchanges
  fs.writeFileSync(CONTEXTFILE, JSON.stringify(ctx, null, 2));
}

function getUserInfo(userID) {
  let info = {};
  if (fs.existsSync(USERINFOFILE)) {
    try { info = JSON.parse(fs.readFileSync(USERINFOFILE)); } catch { info = {}; }
  }
  return info[userID] || {};
}
function setUserInfo(userID, newInfo) {
  let info = {};
  if (fs.existsSync(USERINFOFILE)) {
    try { info = JSON.parse(fs.readFileSync(USERINFOFILE)); } catch { info = {}; }
  }
  info[userID] = { ...info[userID], ...newInfo };
  fs.writeFileSync(USERINFOFILE, JSON.stringify(info, null, 2));
}

function extractInfo(text) {
  let result = {};
  let nameMatch = text.match(/(?:my name is|I am|I'm|call me)\s+([A-Za-zÀ-ÖØ-öø-ÿ'’\- ]+)/i);
  if (nameMatch) result.name = nameMatch[1].trim();
  let ageMatch = text.match(/(?:I am|I'm|age is|My age is|I am|I'm)\s+(\d{1,3})\s*(years? old)?/i);
  if (ageMatch) result.age = ageMatch[1].trim();
  return result;
}

function langCodeToName(code) {
  const map = {
    eng: "English", fra: "French", spa: "Spanish", deu: "German",
    ita: "Italian", por: "Portuguese", zho: "Chinese", rus: "Russian",
    hin: "Hindi", jpn: "Japanese"
  };
  return map[code] || "English";
}

async function getAIAnswer(question, model, context = [], lang = "eng", userInfo = {}) {
  let systemText = botPrompt + ` Reply in ${langCodeToName(lang)}.`;
  if (userInfo.name) systemText += ` The user's name is ${userInfo.name}.`;
  if (userInfo.age) systemText += ` The user's age is ${userInfo.age}.`;
  const systemPrompt = { role: "system", content: systemText };
  const url = `${TOGETHER_API_URL}/chat/completions`;
  const payload = {
    model,
    messages: [systemPrompt, ...context, { role: "user", content: question }],
    max_tokens: 1024,
    temperature: 0.7
  };
  const headers = {
    "Authorization": `Bearer ${TOGETHER_API_KEY}`,
    "Content-Type": "application/json"
  };
  const response = await axios.post(url, payload, { headers });
  return response.data.choices?.[0]?.message?.content;
}

function heartReact(api, msgid, threadid) {
  api.setMessageReaction("❤️", msgid, () => {}, true);
}

module.exports.run = async function({ api, event, args }) {
  const { threadID, messageID, senderID, body } = event;
  if (!body) return;

  heartReact(api, messageID, threadID);

  let lang = franc(body, { minLength: 3 }) || "eng";

  let extracted = extractInfo(body);
  if (Object.keys(extracted).length) {
    setUserInfo(senderID, extracted);
  }
  let userInfo = getUserInfo(senderID);

  if (body.trim().startsWith(".pi")) {
    let question = body.trim().slice(3).trim();
    if (!question) return;
    if (!checkCooldown(senderID, threadID)) return;

    let context = [];
    try {
      const aiReply = await getAIAnswer(question, defaultModel, context, lang, userInfo);
      api.sendMessage(aiReply || "No answer.", threadID, (err, info) => {
        setContext(threadID, [
          { role: "user", content: question },
          { role: "assistant", content: aiReply }
        ]);
      });
    } catch (err) {
      api.sendMessage("Error. Please try again.", threadID, messageID);
    }
    return;
  }

  let context = getContext(threadID);
  if (context.length === 0) return;

  if (!checkCooldown(senderID, threadID)) return;

  let question = body.trim();
  try {
    const aiReply = await getAIAnswer(question, defaultModel, context, lang, userInfo);
    api.sendMessage(aiReply || "No answer.", threadID, (err, info) => {
      setContext(threadID, [
        ...context,
        { role: "user", content: question },
        { role: "assistant", content: aiReply }
      ]);
    });
  } catch (err) {
    api.sendMessage("Error. Please try again.", threadID, messageID);
  }
};