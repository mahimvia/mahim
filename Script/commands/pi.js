const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

module.exports.config = {
  name: "pi",
  version: "6.0.0",
  hasPermssion: 0,
  credits: "mahimvia",
  description: "Together.ai chat with history, file send/read, dynamic models",
  commandCategory: "AI",
  usages: ".pi <question> | .pi models | .pi model <name> | .pi help | .pi read <filename>",
  cooldowns: 10
};

const EMOJI = {
  loading: "⏳",
  success: "✅",
  error: "❌",
  info: "ℹ️",
  model: "🤖",
  file: "📄",
  history: "🗂️"
};

const TOGETHER_API_URL = "https://api.together.xyz/v1";
const TOGETHER_API_KEY = "2aba4dc1d5295510a4b382cd0d1d2e6737a10ca565848738c95d3813bc16e87f";
let defaultModel = "mistralai/Mixtral-8x7B-Instruct-v0.1";

const LOGDIR = path.join(__dirname, "cache");
const CONTEXTFILE = path.join(LOGDIR, "pi_context.json");
const COOLDOWN = 10; // Seconds

// Helper: set emoji reaction
function react(api, emoji, msgid, threadid) {
  api.setMessageReaction(emoji, msgid, () => {}, true);
}

// Helper: cooldown check
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
  ctx[threadID] = history.slice(-10); // Keep last 10 exchanges for context
  fs.writeFileSync(CONTEXTFILE, JSON.stringify(ctx, null, 2));
}

// Helper: get available models from Together
async function getAvailableModels() {
  const res = await axios.get(`${TOGETHER_API_URL}/models`, {
    headers: { "Authorization": `Bearer ${TOGETHER_API_KEY}` }
  });
  return res.data.data
    .filter(m => m.name && (m.name.includes("Instruct") || m.name.includes("chat") || m.name.includes("GPT") || m.name.includes("llama")))
    .map(m => m.name);
}

// Helper: get AI answer from Together
async function getAIAnswer(question, model, context = []) {
  const url = `${TOGETHER_API_URL}/chat/completions`;
  const payload = {
    model,
    messages: [...context, { role: "user", content: question }],
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

// Helper: list files sent in /cache
function listFiles() {
  if (!fs.existsSync(LOGDIR)) return [];
  return fs.readdirSync(LOGDIR)
    .filter(f => f.startsWith("pi_file_"))
    .map(f => f.replace("pi_file_", ""));
}

// Helper: save file
function saveAttachment(attachment, senderID) {
  const ext = attachment.type === "photo" ? ".jpg"
           : attachment.type === "video" ? ".mp4"
           : attachment.type === "audio" ? ".mp3"
           : attachment.type === "file" ? path.extname(attachment.name) || ".dat"
           : ".dat";
  const filename = attachment.name ? attachment.name : `file_${Date.now()}${ext}`;
  const filePath = path.join(LOGDIR, `pi_file_${filename}`);
  return axios.get(attachment.url, { responseType: "arraybuffer" }).then(res => {
    fs.writeFileSync(filePath, Buffer.from(res.data, "binary"));
    return filename;
  });
}

// Helper: read file content (limited to text files)
function readFileContent(filename) {
  const filePath = path.join(LOGDIR, `pi_file_${filename}`);
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filename).toLowerCase();
  if ([".txt", ".md", ".json", ".csv", ".log"].includes(ext)) {
    return fs.readFileSync(filePath, "utf8").slice(0, 6000); // limit to 6kb
  } else {
    return null; // Only allow text files for direct reading
  }
}

module.exports.run = async function({ api, event, args, Users }) {
  const { threadID, messageID, senderID, attachments } = event;
  let question = args.join(" ").trim();
  let context = getContext(threadID);

  // Cooldown/anti-spam
  if (!checkCooldown(senderID, threadID)) {
    api.sendMessage(`${EMOJI.error} Please wait ${COOLDOWN}s before using .pi again.`, threadID, messageID);
    react(api, EMOJI.error, messageID, threadID);
    return;
  }

  // Help
  if (!question || /^help$/i.test(question)) {
    api.sendMessage(
      `${EMOJI.info} Usage:\n.pi <your question>\n.pi models (show Together models)\n.pi model <name> (set default model)\n.pi read <filename> (read file sent earlier)\nSend a file with your question to ask about it.\nCurrent default: ${defaultModel}\nAvailable files: ${listFiles().join(", ") || "(none)"}\n`,
      threadID, messageID
    );
    react(api, EMOJI.info, messageID, threadID);
    return;
  }

  // Show models
  if (/^models$/i.test(question)) {
    try {
      const models = await getAvailableModels();
      api.sendMessage(
        `${EMOJI.model} Together chat models:\n- ${models.join('\n- ')}\nCurrent default: ${defaultModel}`,
        threadID, messageID
      );
      react(api, EMOJI.model, messageID, threadID);
    } catch (err) {
      api.sendMessage(`${EMOJI.error} Couldn't fetch models: ${err.message}`, threadID, messageID);
      react(api, EMOJI.error, messageID, threadID);
    }
    return;
  }

  // Set default model
  if (/^model\s+([^\s]+)$/i.test(question)) {
    const reqModel = question.match(/^model\s+([^\s]+)$/i)[1];
    try {
      const models = await getAvailableModels();
      if (!models.includes(reqModel)) {
        api.sendMessage(
          `${EMOJI.error} Model '${reqModel}' not found!\nAvailable: ${models.join(', ')}`,
          threadID, messageID
        );
        react(api, EMOJI.error, messageID, threadID);
        return;
      }
      defaultModel = reqModel;
      api.sendMessage(`${EMOJI.model} Default model set to: ${defaultModel}`, threadID, messageID);
      react(api, EMOJI.model, messageID, threadID);
    } catch (err) {
      api.sendMessage(`${EMOJI.error} Couldn't set model: ${err.message}`, threadID, messageID);
      react(api, EMOJI.error, messageID, threadID);
    }
    return;
  }

  // Read a file
  if (/^read\s+([^\s]+)$/i.test(question)) {
    const filename = question.match(/^read\s+([^\s]+)$/i)[1];
    const content = readFileContent(filename);
    if (!content) {
      api.sendMessage(`${EMOJI.error} File not found or not a text file: ${filename}`, threadID, messageID);
      react(api, EMOJI.error, messageID, threadID);
      return;
    }
    api.sendMessage(`${EMOJI.file} Contents of ${filename}:\n\n${content}`, threadID, messageID);
    react(api, EMOJI.file, messageID, threadID);
    return;
  }

  // File send: if there's an attachment, save and add info for AI
  let fileInfo = "";
  if (attachments && attachments.length > 0) {
    try {
      const filename = await saveAttachment(attachments[0], senderID);
      fileInfo = `\n[File received: ${filename}]`;
      // If text file, read content for context
      const fileText = readFileContent(filename);
      if (fileText) {
        question += `\n\nHere's the file "${filename}":\n${fileText}`;
      } else {
        question += `\n\nA non-text file "${filename}" was sent.`;
      }
      api.sendMessage(`${EMOJI.file} File received: ${filename}`, threadID, messageID);
    } catch (err) {
      api.sendMessage(`${EMOJI.error} Couldn't save your file: ${err.message}`, threadID, messageID);
      react(api, EMOJI.error, messageID, threadID);
      return;
    }
  }

  // Start loading reaction
  react(api, EMOJI.loading, messageID, threadID);

  // Ask AI
  try {
    const aiReply = await getAIAnswer(question, defaultModel, context);
    api.sendMessage(`${EMOJI.success} ${aiReply || "No answer."}`, threadID, (err, info) => {
      if (!err && info) react(api, EMOJI.success, info.messageID, threadID);
      // Update context/history for this thread
      setContext(threadID, [
        ...context,
        { role: "user", content: question },
        { role: "assistant", content: aiReply }
      ]);
    });
  } catch (err) {
    api.sendMessage(`${EMOJI.error} Error: ${err.response?.data?.error || err.message}`, threadID, messageID);
    react(api, EMOJI.error, messageID, threadID);
  }
};