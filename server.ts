import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini client cleanly
const ai = process.env.GEMINI_API_KEY 
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    })
  : null;

// Virtual radio operator databases for simulations when Gemini isn't available or for channel variation
const DEFAULT_ANSWERS: Record<number, Array<{ operator: string; reply: string; signalStrength: number; beepType: string }>> = {
  1: [
    { operator: "Gearbox", reply: "10-4 buddy! Just rolled past mile marker 42. Watch out for a bear in the bushes takin' pictures, over.", signalStrength: 8, beepType: "trucker" },
    { operator: "Chrome Moly", reply: "Breaker 1-9, we got ourselves a clean sheet on interstate 80. Hammer down, good buddy, over.", signalStrength: 9, beepType: "classic" },
    { operator: "Diesel Dan", reply: "Appreciate the copy! Got a load of steel bound for the windy city. We catch ya on the flip-flop, over.", signalStrength: 7, beepType: "classic" }
  ],
  2: [
    { operator: "Rescue One", reply: "Base station copy. All wilderness crews report clear skies over southern ridge. Do you have traffic for dispatch? Over.", signalStrength: 9, beepType: "roger" },
    { operator: "Trail Blazer", reply: "Station check-in, current elevation twelve thousand feet, squalls moving in. Maintain listening watch, over.", signalStrength: 6, beepType: "roger" }
  ],
  3: [
    { operator: "Cipher-9", reply: "ALPHA... WHISKEY... ZULU... SEVEN... NINER... COLD HARBOR TRANSMITTING. STATUS GREEN... [BUZZ]... STANDBY... OVER.", signalStrength: 4, beepType: "spaced" },
    { operator: "Ghost Echo", reply: "BEACON FREQUENCY ACTIVE. CYCLE 44 COMPLETE. RETRANSMITING SEQUENTIAL LOGS. OVER.", signalStrength: 5, beepType: "spaced" }
  ],
  4: [
    { operator: "Catfish", reply: "Hey there buddy! The white bass are bitin' down by the limestone bend if you got the patience. Got an oil leak on my tractor though, over.", signalStrength: 8, beepType: "classic" },
    { operator: "Sarge", reply: "Acknowledge. Just finished checking the garden lines, tomatoes lookin' prime. Stay safe out on that blacktop, over.", signalStrength: 7, beepType: "classic" }
  ],
  5: [
    { operator: "Eagle Eye", reply: "This is cloud dispatcher Eagle Eye. We read you loud and clear on general channel 5. What is your handle and destination? Over.", signalStrength: 9, beepType: "electronic" }
  ]
};

// API: CB Transmission Handler
app.post("/api/cb/transmit", async (req, res) => {
  const { channel, message, handle } = req.body;
  const targetChannel = Number(channel) || 1;
  const userText = message ? String(message).trim() : "";
  const userHandle = handle ? String(handle).trim() : "Stranger";

  // System instructions for operator roleplaying based on active channel
  const instructions: Record<number, { prompt: string; operator: string; fallbackText: string }> = {
    1: {
      operator: "Gearbox",
      fallbackText: "10-4 buddy! Traffic is crawl-and-haul around the bypass, watch your tail. Catch you on the flip side, over.",
      prompt: `You are "Gearbox", an old-school American trucker on CB channel 1. You speak in heavy, authentic 1970s trucker slang (e.g. "good buddy", "double nickel", "bear in the bushes", "10-4", "feed the bears", "wall-to-wall and treetop tall").
The user (handle: "${userHandle}") just transmitted this over the radio: "${userText}".
Reply in character. Keep your reply short (under 40 words) and end with "Over." or "Do you copy? Over." Make sure to sound like you are speaking dynamically on a radio.`
    },
    2: {
      operator: "Rescue One",
      fallbackText: "Base station copies. We've got a rescue vehicle patrolling sector bravo. No emergencies reported, over.",
      prompt: `You are "Rescue One", an official Search & Rescue (SAR) dispatcher operating on CB channel 2. You are highly professional, structured, calm, and use pilot-like or dispatcher phrasing (e.g. "Roger", "Copy", "Situation Normal", "Acknowledge", "Understood").
The user (handle: "${userHandle}") just transmitted: "${userText}".
Reply in character. Keep your response under 45 words, focused on mountain operations or wilderness safety, and end with "Over."`
    },
    3: {
      operator: "Cipher-9",
      fallbackText: "SIERRA... NINER... ECHO... OUT OF PHASE... GROUND REPEATER TIMEOUT, OVER.",
      prompt: `You are "Cipher-9", a creepy, mysterious numbers station operator on CB channel 3. You sound mechanical, cryptic, and speak in military codes, phonetics, and cold war repeating sequences (e.g. "NOVEMBER... WHISKEY... FOUR... NINER... CYCLE REPEATING").
The user (handle: "${userHandle}") says: "${userText}".
Reply with a weird, cryptic, mechanical code transmission. Keep it extremely short (under 30 words), creepy, and end with "OVER."`
    },
    4: {
      operator: "Catfish",
      fallbackText: "Well now, you got Catfish here. Standard afternoon lawn work is about done, catchin' the sunset now, over.",
      prompt: `You are "Catfish", a friendly, slow-talking grandfatherly Southern gardener and fisherman on CB channel 4. You talk about relaxing outdoor hobbies, catfish bait, old tractors, cold iced tea, and local town gossip with a warm, slow drawl.
The user (handle: "${userHandle}") says: "${userText}".
Reply in character, friendly, down-home, and conversational. Keep it under 45 words and end with "over."`
    },
    5: {
      operator: "Eagle Eye",
      fallbackText: "This is cloud central Eagle Eye. Copy that transmission. We are clear for contact, over.",
      prompt: `You are "Eagle Eye", a dynamic dispatcher operating on the primary AI-powered channel 5. You are extremely resourceful, witty, and act as a reliable relay partner. You know everything about the weather, electronic radio gear, physics, and world trivia, but you frame everything like an enthusiastic, vintage multi-band high-range antenna enthusiast.
The user (handle: "${userHandle}") says: "${userText}".
Directly address what they said. Talk to them intelligently, but in gorgeous, classic radio enthusiast styling. Keep it under 50 words and end with "Over."`
    }
  };

  const channelConfig = instructions[targetChannel] || instructions[1];

  // If no message or very generic, let's roll a random operator phrase
  if (!userText) {
    const defaultPhrases = DEFAULT_ANSWERS[targetChannel] || DEFAULT_ANSWERS[1];
    const picked = defaultPhrases[Math.floor(Math.random() * defaultPhrases.length)];
    return res.json({
      operator: picked.operator,
      reply: picked.reply,
      signalStrength: picked.signalStrength,
      beepType: picked.beepType,
      channel: targetChannel
    });
  }

  // If Gemini client exists, let's use it dynamically!
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: channelConfig.prompt,
        config: {
          temperature: 0.82,
          systemInstruction: "You are an immersive CB Radio operator simulation engine. Your responses are spoken aloud over static, so be conversational and highly brief."
        }
      });

      const replyText = response.text ? response.text.replace(/[\n\r]+/g, " ").trim() : channelConfig.fallbackText;
      
      // Calculate dynamic S-meter readings based on simulated radio qualities
      // Channel 3 is weaker (crytpic numbers station), Channel 5 is strongest
      let signalStrength = Math.floor(Math.random() * 3) + 7; // S7 to S9
      if (targetChannel === 3) signalStrength = Math.floor(Math.random() * 4) + 3; // S3 to S6
      
      const beepMap: Record<number, string> = { 1: "trucker", 2: "roger", 3: "spaced", 4: "classic", 5: "electronic" };

      return res.json({
        operator: channelConfig.operator,
        reply: replyText,
        signalStrength,
        beepType: beepMap[targetChannel] || "classic",
        channel: targetChannel
      });
    } catch (err) {
      console.error("Gemini API transmission error:", err);
      // Fallback to static lists
    }
  }

  // Static fallback if Gemini isn't available or fails
  const channelDefaultPhrases = DEFAULT_ANSWERS[targetChannel] || DEFAULT_ANSWERS[1];
  const matched = channelDefaultPhrases.find(p => p.operator === channelConfig.operator) || channelDefaultPhrases[0];
  
  return res.json({
    operator: matched.operator,
    reply: `[Simulated Check-in] ${matched.reply}`,
    signalStrength: matched.signalStrength,
    beepType: matched.beepType,
    channel: targetChannel
  });
});

// Configure Vite integration or static file serve
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT} in ${process.env.NODE_ENV || "development"} mode`);
  });
}

startServer();
