import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};
const BUCKET = "bms-documents";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const safeName = (name: string) => name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 140) || "document";
const validTech = (email: unknown) => typeof email === "string" && /^[^@\s]+@se\.com$/i.test(email.trim());

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Supabase function environment is incomplete");
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const body = await req.json();
    const { action, technicianName = "", technicianEmail = "", caseId = "" } = body;
    if (!validTech(technicianEmail)) return json({ error: "A valid @se.com technician email is required" }, 403);

    if (action === "list") {
      const { data, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000, sortBy: { column: "updated_at", order: "desc" } });
      if (error) throw error;
      const query = String(body.query || "").trim().toLowerCase();
      const contentType = String(body.contentType || "");
      const documents = (data || []).filter((x: any) => x.id).map((x: any) => ({
        id: x.id, name: x.name, path: x.name, size: Number(x.metadata?.size || 0), contentType: String(x.metadata?.mimetype || ""), updatedAt: x.updated_at || x.created_at,
      })).filter((x: any) => (!query || `${x.name} ${x.path}`.toLowerCase().includes(query)) && (!contentType || x.contentType.startsWith(contentType)));
      return json({ documents });
    }

    if (action === "open") {
      const path = String(body.path || ""); if (!path) return json({ error: "Document path is required" }, 400);
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300, { download: false });
      if (error) throw error;
      await supabase.from("bms_document_audit").insert({ action: "open", storage_path: path, case_id: caseId || null, technician_name: technicianName || null, technician_email: technicianEmail }).then(() => {}).catch(() => {});
      return json({ signedUrl: data.signedUrl, expiresIn: 300 });
    }

    if (action === "attach") {
      const path = String(body.path || ""); if (!path || !caseId) return json({ error: "Document path and case ID are required" }, 400);
      await supabase.from("bms_case_documents").insert({ case_id: caseId, document_id: body.documentId || null, storage_path: path }).then(() => {}).catch(() => {});
      await supabase.from("bms_document_audit").insert({ action: "attach", storage_path: path, case_id: caseId, technician_name: technicianName || null, technician_email: technicianEmail }).then(() => {}).catch(() => {});
      return json({ attached: true });
    }

    if (action === "upload") {
      const name = safeName(String(body.name || "")); const contentType = String(body.contentType || ""); const size = Number(body.size || 0);
      if (!ALLOWED.has(contentType)) return json({ error: "Unsupported file type" }, 400);
      if (!size || size > MAX_BYTES) return json({ error: "File must be between 1 byte and 10 MB" }, 400);
      const raw = String(body.contentBase64 || ""); if (!raw) return json({ error: "File content is required" }, 400);
      const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)); if (bytes.byteLength !== size || bytes.byteLength > MAX_BYTES) return json({ error: "File size validation failed" }, 400);
      const path = `${caseId || "library"}/${crypto.randomUUID()}-${name}`;
      const { data: uploaded, error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: "3600" });
      if (error) throw error;
      let documentId: string | null = null;
      const metadata = { storage_bucket: BUCKET, storage_path: uploaded.path, file_name: name, content_type: contentType, file_size: size, uploaded_by_name: technicianName || null, uploaded_by_email: technicianEmail };
      const inserted = await supabase.from("bms_documents").insert(metadata).select("id").maybeSingle(); if (!inserted.error) documentId = inserted.data?.id || null;
      if (caseId) await supabase.from("bms_case_documents").insert({ case_id: caseId, document_id: documentId, storage_path: uploaded.path }).then(() => {}).catch(() => {});
      await supabase.from("bms_document_audit").insert({ action: "upload", document_id: documentId, storage_path: uploaded.path, case_id: caseId || null, technician_name: technicianName || null, technician_email: technicianEmail }).then(() => {}).catch(() => {});
      return json({ document: { id: documentId, name, path: uploaded.path, contentType, size }, metadataWarning: inserted.error?.message || null });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
