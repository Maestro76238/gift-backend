import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

// --- fix __dirname for ES modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// health check
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// ADMIN PANEL
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});

// start server
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});