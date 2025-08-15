const axios = require("axios");

module.exports.config = {
  name: "ai",
  version: "1.0.0",
  hasPermssion: 0,
  credits: "Mahim Islam",
  description: "Ask Gemini AI anything, all languages supported!",
  commandCategory: "AI",
  usages: "[your question]",
  cooldowns: 5,
};

module.exports.run = async function ({ api, event, args }) {
  const prompt = args.join(" ");
  if (!prompt) {
    return api.sendMessage(
      "❌ Please enter your question after the command. Example: ai What is the capital of Japan?",
      event.threadID,
      event.messageID
    );
  }

  // Custom system message including owner info and responsibility
  const systemPrompt = `
You are 🌸 —  mahim bot ୨୧, an AI assistant created by Mahim Islam. 
You must answer questions in any language, always be helpful, responsible, and respectful. 
Your owner is Mahim Islam. 
Mention Mahim Islam as the creator if asked about authorship, and always encourage safe, ethical usage. 
If you cannot answer, say "I'm not sure, but I can try to help!".
  `;

  try {
    const response = await axios.post(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=AIzaSyB8em22tgdU44kG_uize8SBNfX1Bqhm_Ks",
      {
        contents: [
          { role: "system", parts: [{ text: systemPrompt }] },
          { role: "user", parts: [{ text: prompt }] }
        ]
      }
    );

    // Gemini response structure
    const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (reply) {
      return api.sendMessage(reply, event.threadID, event.messageID);
    } else {
      return api.sendMessage("⚠️ Sorry, Gemini couldn't generate a response. Please try again.", event.threadID, event.messageID);
    }
  } catch (error) {
    return api.sendMessage("❗ Error communicating with Gemini AI. Please try again later.", event.threadID, event.messageID);
  }
};