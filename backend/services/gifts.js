import crypto from "crypto";

export async function createGiftCode(supabase) {
  const code = crypto.randomUUID().slice(0, 8).toUpperCase();

  const { error } = await supabase.from("gifts").insert({
    code,
    is_used: false,
    file_url: null,
    created_at: new Date().toISOString()
  });

  if (error) {
    console.error("❌ CREATE GIFT ERROR:", error);
    throw error;
  }

  return code;
}