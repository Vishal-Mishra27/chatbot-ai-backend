import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import chatRoute from "./routes/chat.js";

dotenv.config();

const app = express();
// app.use(cors({ origin: "http://localhost:5173" }));
app.use(cors({ origin: "https://chatbot-ai-project-vishal.netlify.app" }));

app.use(express.json());

app.use("/chat", chatRoute);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
