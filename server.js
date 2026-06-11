import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import chatRoute from "./routes/chat.js";
import searchRoute from "./routes/search.js";
import bookingRoute from "./routes/booking.js";

dotenv.config();

const app = express();
app.use(cors({ origin: ["http://localhost:5173", "https://chatbot-ai-project-vishal.netlify.app"] }));

app.use(express.json());

app.use("/chat", chatRoute);
app.use("/search", searchRoute);
app.use("/booking", bookingRoute);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
