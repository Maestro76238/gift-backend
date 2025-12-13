import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 10000;

// === absolute paths (Render-safe) ===
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// health
app.get("/", (req, res) => {
  res.send("OK");
});

// admin panel
app.get("/admin", (req, res) => {
  res.sendFile(path.resolve(__dirname, "upload.html"));
});

// start
app.listen(PORT, () => {
  console.log("Server started on port", PORT);
  console.log("Admin path:", path.resolve(__dirname, "upload.html"));
});