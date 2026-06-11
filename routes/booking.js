import express from "express";
import axios from "axios";

const router = express.Router();

const PLACE_ORDER_URL = "https://root.roombookkro.com/api/placeorder";
const ADD_WALLET_URL = "https://root.roombookkro.com/api/user/add_wallet";
const CASHFREE_ORDER_URL = "https://sandbox.cashfree.com/pg/orders";

const CASHFREE_HEADERS = {
  "x-api-version": "2023-08-01",
  "x-client-id": process.env.CASHFREE_CLIENT_ID,
  "x-client-secret": process.env.CASHFREE_CLIENT_SECRET,
};

const buildOrderPayload = (bookingState, paymentMethod, paymentStatus, orderId) => ({
  userId: bookingState.userId,
  residencyId: bookingState.residencyId,
  roomId: bookingState.roomId,
  nor: bookingState.nor,
  checkInDate: bookingState.checkInDate,
  checkOutDate: bookingState.checkOutDate,
  totalAmount: bookingState.totalAmount,
  nog: bookingState.nog,
  bookingFor: bookingState.bookingFor,
  discount: bookingState.discount || 0,
  finalAmount: bookingState.finalAmount,
  cupponCode: bookingState.cupponCode || "",
  paymentMethod,
  orderId,
  paymentStatus,
  isChildren: bookingState.isChildren ? 1 : 0,
  childrenNumber: bookingState.childrenNumber || 0,
  description: bookingState.description || "",
});

// POST /booking/start — AI-driven booking details collection
router.post("/start", async (req, res) => {
  const { message, bookingState } = req.body;
  if (!message || !bookingState) return res.status(400).json({ error: "message and bookingState are required" });

  const bookingPrompt = `You are a hotel booking assistant for RoomBookKro.

Current booking state (JSON):
${JSON.stringify(bookingState, null, 2)}

Collect these missing fields one by one naturally:
- checkInDate (ISO string, default time 14:00)
- checkOutDate (ISO string, default time 11:00)
- bookingFor (guest name)
- nog (number of guests, integer)
- nor (number of rooms, default 1)
- isChildren (true/false)
- childrenNumber (integer, only if isChildren true)
- description (optional)
- cupponCode (optional)

Once all REQUIRED fields are collected (checkInDate, checkOutDate, bookingFor, nog, nor, isChildren):
- Calculate: numberOfNights = days between checkInDate and checkOutDate
- totalAmount = pricePerNight × numberOfNights × nor
- discount = 0 (unless cupponCode provided)
- finalAmount = totalAmount - discount
- Return JSON with status "ready"

Rules:
- Ask ONE field at a time
- Speak in Hinglish
- Return ONLY valid JSON in this format:

If still collecting:
{ "status": "collecting", "reply": "<question>", "bookingState": { ...updatedState } }

If all done:
{ "status": "ready", "reply": "Sab details mil gayi! Aap payment kaise karna chahenge?\n1. 💵 Pay at Hotel\n2. 💳 Online Payment", "bookingState": { ...finalState with totalAmount, finalAmount, discount, numberOfNights } }

User said: "${message}"`;

  try {
    const aiRes = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: "openai/gpt-3.5-turbo", messages: [{ role: "user", content: bookingPrompt }] },
      { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" } }
    );

    const raw = aiRes.data.choices[0].message.content;
    // Safely extract JSON even if AI adds extra text
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI returned invalid JSON");
    const parsed = JSON.parse(jsonMatch[0]);
    res.json(parsed);
  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({ error: "Booking details collect karne mein error aaya." });
  }
});

// POST /booking/place — Pay at Hotel
router.post("/place", async (req, res) => {
  const { bookingState } = req.body;
  if (!bookingState) return res.status(400).json({ error: "bookingState is required" });

  try {
    const orderId = `ORD-${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const payload = buildOrderPayload(bookingState, 2, 0, orderId);
    console.log("Placing order with payload:", JSON.stringify(payload, null, 2));
    const { data } = await axios.post(PLACE_ORDER_URL, payload, {
      headers: { Authorization: `Bearer ${bookingState.token}` },
    });

    res.json({ success: true, orderId, data });
  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({ error: "Order place karne mein error aaya. Dobara try karein." });
  }
});

// POST /booking/payment-session — Create Cashfree payment session
router.post("/payment-session", async (req, res) => {
  const { userId, finalAmount, token } = req.body;
  if (!userId || !finalAmount) return res.status(400).json({ error: "userId and finalAmount are required" });

  try {
    const { data } = await axios.post(
      ADD_WALLET_URL,
      { userId, amount: finalAmount },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    console.log("add_wallet response:", JSON.stringify(data, null, 2));

    res.json({
      payment_link: data.payment_link,
      order_id: data.order_id || data.cashfree_order_id,
      payment_session_id: data.payment_session_id,
    });
  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({ error: "Payment session banana mein error aaya. Dobara try karein." });
  }
});

// POST /booking/verify-and-place — Verify Cashfree payment then place order
router.post("/verify-and-place", async (req, res) => {
  const { bookingState, cashfreeOrderId } = req.body;
  if (!bookingState || !cashfreeOrderId) return res.status(400).json({ error: "bookingState and cashfreeOrderId are required" });

  try {
    // 1. Check Cashfree order status directly
    console.log("Checking Cashfree order:", cashfreeOrderId);
    const { data: cfData } = await axios.get(
      `https://sandbox.cashfree.com/pg/orders/${cashfreeOrderId}`,
      {
        headers: {
          "x-api-version": "2023-08-01",
          "x-client-id": "TEST10256948ec57a943389eb31e588f84965201",
          "x-client-secret": "cfsk_ma_test_4bf75f253a8b0b51dd9252a617bec825_4076da95",
        },
      }
    );
    console.log("Cashfree order status:", cfData.order_status);

    const status = cfData.order_status;

    if (status === "ACTIVE" || status === "PENDING") {
      return res.json({ status: "PENDING", message: "❌ Aapka payment abhi complete nahi hua hai. Kripya payment complete karke dobara try karein." });
    }
    if (status === "EXPIRED") {
      return res.json({ status: "EXPIRED", message: "⏰ Payment session expire ho gaya. Naya payment link generate karte hain." });
    }
    if (status === "FAILED") {
      return res.json({ status: "FAILED", message: "❌ Payment failed ho gaya. Dobara try karein?" });
    }
    if (status === "PAID") {
      const payload = buildOrderPayload(bookingState, 1, 1, cashfreeOrderId);
      console.log("place order payload:", JSON.stringify(payload, null, 2));
      const { data: orderData } = await axios.post(PLACE_ORDER_URL, payload, {
        headers: { Authorization: `Bearer ${bookingState.token}` },
      });
      return res.json({ status: "PAID", success: true, orderId: cashfreeOrderId, data: orderData });
    }

    res.json({ status, message: "Unknown payment status. Support se contact karein." });
  } catch (error) {
    console.error(error?.response?.data || error.message);
    res.status(500).json({ error: "Payment verify karne mein error aaya. Support se contact karein." });
  }
});

export default router;
