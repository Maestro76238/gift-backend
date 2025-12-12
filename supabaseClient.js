import dotenv from "dotenv";
dotenv.config();

console.log("TEST URL:", process.env.SUPABASE_URL);
console.log("TEST KEY:", process.env.SUPABASE_KEY ? "LOADED" : "MISSING");

import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
