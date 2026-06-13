import express from "express";
import axios from "axios";

const router = express.Router();

const AI_URL = "https://openrouter.ai/api/v1/chat/completions";
const AI_MODEL = "openai/gpt-3.5-turbo";

const aiCall = (systemPrompt, userContent) =>
  axios.post(
    AI_URL,
    { model: AI_MODEL, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }] },
    { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" } }
  );

const getIntentPrompt = () => {
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  return `You are an AI assistant for a hotel booking application. Today's date is ${today}.

Classify the user message into one of these intents:

1. profile → user info, wallet, balance, account
2. orders → booking history, reservation history
3. book_hotel → user mentions a specific hotel name to book
4. smart_booking → user wants to find and book a hotel based on preference (cheapest, expensive, nearby, city, duration)
5. general → greetings or unrelated

Rules:
- Return ONLY JSON, no explanation
- Use today = ${today}, tomorrow = ${tomorrow} for date calculations

Formats:

book_hotel:
{ "intent": "book_hotel", "hotelName": "Hotel Name", "checkIn": "YYYY-MM-DD", "checkOut": "YYYY-MM-DD" }

smart_booking:
{ "intent": "smart_booking", "city": "lucknow or null", "preference": "cheapest|expensive|any", "checkIn": "YYYY-MM-DD or null", "checkOut": "YYYY-MM-DD or null", "nights": 1 }

others:
{ "intent": "profile" }

Date detection (today = ${today}):
- "aaj ke liye" or "aaj" → checkIn = ${today}, checkOut = ${tomorrow}, nights = 1
- "aaj se 3 din" → checkIn = ${today}, checkOut = today+3days, nights = 3
- "kal se 2 din" → checkIn = ${tomorrow}, checkOut = tomorrow+2days, nights = 2
- no date mentioned → checkIn = null, checkOut = null, nights = 1

Preference detection:
- "sasta", "cheapest", "budget", "kam price", "affordable" → cheapest
- "mehnga", "expensive", "luxury", "premium", "best" → expensive
- nothing specific → any

Examples:
"Lucknow ka sabse sasta hotel aaj se 3 din ke liye book karo" → { "intent": "smart_booking", "city": "lucknow", "preference": "cheapest", "checkIn": "${today}", "checkOut": "...", "nights": 3 }
"Mere liye ek din ke liye hotel book karo" → { "intent": "smart_booking", "city": null, "preference": "any", "checkIn": "${today}", "checkOut": "${tomorrow}", "nights": 1 }
"Mera balance kitna hai?" → { "intent": "profile" }
"Maine kaunse hotel book kiye?" → { "intent": "orders" }
"Hello" → { "intent": "general" }`;
};

router.post("/", async (req, res) => {
  const { message, userId, token } = req.body;
  if (!message) return res.status(400).json({ error: "Message is required" });

  try {
    // 1. Intent detection
    const intentRes = await aiCall(getIntentPrompt(), message);
    const raw = intentRes.data.choices[0].message.content;
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error("Intent parse failed");
    const parsed = JSON.parse(jsonMatch[0]);
    const intent = parsed.intent;
    console.log("Detected intent:", intent, "| Parsed:", parsed);

    let finalPrompt = "";

    // 2. Profile
    if (intent === "profile") {
      const { data } = await axios.get(
        `https://root.roombookkro.com/api/profile/${userId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const p = data.profile;
      const cleanProfile = { name: p.username, email: p.email, wallet: p.walletBalance, contact: p.contact };
      finalPrompt = `You are a helpful assistant.\n\nUser Profile Data:\nName: ${cleanProfile.name}\nEmail: ${cleanProfile.email}\nWallet Balance: ${cleanProfile.wallet}\nContact: ${cleanProfile.contact}\n\nUser Question:\n${message}\n\nRules:\n- Answer in Hinglish\n- Keep it short\n- Do not show JSON`;
    }

    // 3. Orders
    if (intent === "orders") {
      const { data } = await axios.post("https://root.roombookkro.com/api/orderHistory", { userId });
      const completed = data.data.paymentStatusWise.completed;
      if (!completed || completed.length === 0) {
        return res.json({ reply: "Aapki koi completed booking nahi mili. Abhi tak koi hotel book nahi kiya aapne." });
      }
      const cleanOrders = completed.map(item => ({
        hotel: item.residencyName, amount: item.finalAmount, status: item.status,
        bookingDate: item.createdAt, checkInDate: item.checkInDate, checkOutDate: item.checkOutDate,
      }));
      const summary = cleanOrders.map(o =>
        `Hotel: ${o.hotel} | Amount: ₹${o.amount} | Status: ${o.status} | Booking Date: ${o.bookingDate} | Check-in: ${o.checkInDate} | Check-out: ${o.checkOutDate}`
      ).join("\n");
      finalPrompt = `You are a helpful assistant.\n\nUser Booking Data:\n${summary}\n\nUser Question:\n${message}\n\nRules:\n- Answer in Hinglish\n- Mention hotel name + amount\n- Keep response short\n- Do not show raw JSON`;
    }

    // 4. Book specific hotel
    if (intent === "book_hotel") {
      let guestName = "";
      try {
        const { data: profileData } = await axios.get(
          `https://root.roombookkro.com/api/profile/${userId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        guestName = profileData?.profile?.username || "";
      } catch { guestName = ""; }
      return res.json({ intent: "book_hotel", hotelName: parsed.hotelName, checkIn: parsed.checkIn, checkOut: parsed.checkOut, guestName });
    }

    // 5. Smart booking
    if (intent === "smart_booking") {
      let guestName = "";
      try {
        const { data: profileData } = await axios.get(
          `https://root.roombookkro.com/api/profile/${userId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        guestName = profileData?.profile?.username || "";
      } catch { guestName = ""; }

      return res.json({
        intent: "smart_booking",
        city: parsed.city || null,
        preference: parsed.preference || "any",
        checkIn: parsed.checkIn || null,
        checkOut: parsed.checkOut || null,
        nights: parsed.nights || 1,
        guestName,
      });
    }

    // 6. General
    if (intent === "general") {
      finalPrompt = `You are a helpful hotel booking assistant. Answer in Hinglish, keep it short.\n\nUser: ${message}`;
    }

    const finalRes = await aiCall("You are a helpful assistant.", finalPrompt);
    res.json({ reply: finalRes.data.choices[0].message.content });

  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
