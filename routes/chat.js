import express from "express";
import axios from "axios";

const router = express.Router();

const intentPrompt = `You are an AI assistant for a hotel booking application.

Classify the user message into one of these intents:

1. profile → user info, wallet, balance, account
2. orders → booking, hotel, reservation, history
3. book_hotel → user wants to book a specific hotel with dates
4. general → greetings or unrelated

Rules:
- Return ONLY JSON
- No explanation

For book_hotel intent, extract hotel name and dates:
{ "intent": "book_hotel", "hotelName": "Hotel Name", "checkIn": "YYYY-MM-DD", "checkOut": "YYYY-MM-DD" }

For others:
{ "intent": "profile" }

Format:
{ "intent": "profile" }

Examples:
"Mera balance kitna hai?" → { "intent": "profile" }
"Misiri hotel mein 12 june se 15 june booking karo" → { "intent": "book_hotel", "hotelName": "Misiri", "checkIn": "2026-06-12", "checkOut": "2026-06-15" }
"Maine kaunse hotel book kiye?" → { "intent": "orders" }
"Hello" → { "intent": "general" }`;

const AI_URL = "https://openrouter.ai/api/v1/chat/completions";
const AI_MODEL = "openai/gpt-3.5-turbo";

const aiCall = (systemPrompt, userContent) =>
  axios.post(
    AI_URL,
    { model: AI_MODEL, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }] },
    { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" } }
  );

router.post("/", async (req, res) => {
  const { message, userId, token } = req.body;

  if (!message) return res.status(400).json({ error: "Message is required" });

  try {
    // 1. Intent detection
    const intentRes = await aiCall(intentPrompt, message);
    const raw = intentRes.data.choices[0].message.content;
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error("Intent parse failed");
    const parsed = JSON.parse(jsonMatch[0]);
    const intent = parsed.intent;
    console.log("Detected intent:", intent, "| Parsed:", parsed);
    // const intent = JSON.parse(jsonMatch[0]).intent;
    console.log("Detected intent:", intent);

    let finalPrompt = "";

    // 2. API call + prompt building
    if (intent === "profile") {
      const { data } = await axios.get(
        `https://root.roombookkro.com/api/profile/${userId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const p = data.profile;
      const cleanProfile = { name: p.username, email: p.email, wallet: p.walletBalance, contact: p.contact };

      finalPrompt = `You are a helpful assistant.

User Profile Data:
Name: ${cleanProfile.name}
Email: ${cleanProfile.email}
Wallet Balance: ${cleanProfile.wallet}
Contact: ${cleanProfile.contact}

User Question:
${message}

Rules:
- Answer in Hinglish
- Keep it short
- Do not show JSON`;
    }

    if (intent === "orders") {
      const { data } = await axios.post(
        "https://root.roombookkro.com/api/orderHistory",
        { "userId": userId },
      );
      // console.log("order data:",data)
      const completed = data.data.paymentStatusWise.completed;

      if (!completed || completed.length === 0) {
        return res.json({ reply: "Aapki koi completed booking nahi mili. Abhi tak koi hotel book nahi kiya aapne." });
      }

      const cleanOrders = completed.map(item => ({
        hotel: item.residencyName,
        amount: item.finalAmount,
        status: item.status,
        bookingDate: item.createdAt,
        checkInDate: item.checkInDate,
        checkOutDate: item.checkOutDate,
      }));

      const summary = cleanOrders.map(o =>
        `Hotel: ${o.hotel} | Amount: ₹${o.amount} | Status: ${o.status} | Booking Date: ${o.bookingDate} | Check-in Date: ${o.checkInDate} | Check-out Date: ${o.checkOutDate}`
      ).join("\n");

      finalPrompt = `You are a helpful assistant.

User Booking Data:
${summary}

User Question:
${message}

Rules:
- Answer in Hinglish
- Mention hotel name + amount
- Keep response short
- Do not show raw JSON`;
    }

    if (intent === "book_hotel") {
      // Profile se naam fetch karo
      let guestName = "";
      try {
        const { data: profileData } = await axios.get(
          `https://root.roombookkro.com/api/profile/${userId}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        guestName = profileData?.profile?.username || "";
      } catch {
        guestName = "";
      }

      // JSON directly return karo — frontend handle karega
      return res.json({
        intent: "book_hotel",
        hotelName: parsed.hotelName,
        checkIn: parsed.checkIn,
        checkOut: parsed.checkOut,
        guestName,
      });
    }

    if (intent === "general") {
      finalPrompt = `You are a helpful hotel booking assistant. Answer in Hinglish, keep it short.\n\nUser: ${message}`;
    }

    // 3. Final AI response
    const finalRes = await aiCall("You are a helpful assistant.", finalPrompt);
    res.json({ reply: finalRes.data.choices[0].message.content });

  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
