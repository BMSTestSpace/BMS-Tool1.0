// BMS Troubleshooter - document-library Edge Function
// Version 0.6.33: uploads go into the shared library (previous version: 0.6.32, 20 MB uploads).
//
// What changed in 0.6.33 (request and response formats are unchanged; the app needs no change):
//  1. New uploads are stored under "library/" instead of under the case folder. They now appear in the
//     "Approved document library" search for every technician, as well as on the case they were uploaded from.
//     The upload still links the file to the case (bms_case_documents) exactly as before.
//  2. The library list now reads two places: the top of the bucket (as before) and the "library/" folder.
//     Files in library/ are shown under their original name (the random id in front of the stored name is hidden).
//  3. Housekeeping files whose name starts with "." (the dashboard creates ".emptyFolderPlaceholder") are never listed.
// Files uploaded by 0.6.32 or earlier live in case folders (CASE-.../). They are NOT listed in the library. They still open from
// the case they were attached to. To bring one into the library, move it into library/ in the Storage dashboard, or upload it again.
//
// Earlier change (0.6.32): MAX_BYTES is 20 MB, the base64 text is decoded with a plain loop instead of
// Uint8Array.from(atob(raw), fn) (about 10x less CPU and 5x less memory on a 20 MB file; Edge Functions are limited to 2 s of CPU
// and 256 MB of memory per request), oversized requests are refused before the body is read, and invalid base64 returns 400.
// The storage bucket "bms-documents" must also allow 20 MB.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};
const BUCKET = "bms-documents";
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_MB = MAX_BYTES / (1024 * 1024);
// base64 is 4 characters for every 3 bytes. The extra 64 KB covers the JSON around the file text.
const MAX_BASE64_CHARS = Math.ceil(MAX_BYTES / 3) * 4;
const MAX_REQUEST_BYTES = MAX_BASE64_CHARS + 64 * 1024;
// Uploads are stored as library/<random id>-<safe file name>. The random id keeps two uploads of the same file name apart.
const LIBRARY_FOLDER = "library";
const STORED_ID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;
const shownName = (stored: string) => stored.replace(STORED_ID_PREFIX, "") || stored;
const isDocumentObject = (x: any) => Boolean(x && x.id) && !String(x.name || "").startsWith(".");
const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
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
    if (Number(req.headers.get("content-length") || 0) > MAX_REQUEST_BYTES) return json({ error: `Request is too large. Files must be between 1 byte and ${MAX_MB} MB` }, 413);
    const body = await req.json();
    const { action, technicianName = "", technicianEmail = "", caseId = "" } = body;
    if (!validTech(technicianEmail)) return json({ error: "A valid @se.com technician email is required" }, 403);

    if (action === "list") {
      const sortBy = { column: "updated_at", order: "desc" };
      const [top, lib] = await Promise.all([
        supabase.storage.from(BUCKET).list("", { limit: 1000, sortBy }),
        supabase.storage.from(BUCKET).list(LIBRARY_FOLDER, { limit: 1000, sortBy }),
      ]);
      if (top.error) throw top.error;
      if (lib.error) throw lib.error;
      const query = String(body.query || "").trim().toLowerCase();
      const contentType = String(body.contentType || "");
      const toDoc = (x: any, path: string, name: string) => ({
        id: x.id, name, path, size: Number(x.metadata?.size || 0), contentType: String(x.metadata?.mimetype || ""), updatedAt: x.updated_at || x.created_at,
      });
      const documents = [
        ...(top.data || []).filter(isDocumentObject).map((x: any) => toDoc(x, x.name, x.name)),
        ...(lib.data || []).filter(isDocumentObject).map((x: any) => toDoc(x, `${LIBRARY_FOLDER}/${x.name}`, shownName(String(x.name)))),
      ].sort((a: any, b: any) => (Date.parse(b.updatedAt || "") || 0) - (Date.parse(a.updatedAt || "") || 0))
        .filter((x: any) => (!query || `${x.name} ${x.path}`.toLowerCase().includes(query)) && (!contentType || x.contentType.startsWith(contentType)));
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
      if (!size || size > MAX_BYTES) return json({ error: `File must be between 1 byte and ${MAX_MB} MB` }, 400);
      const raw = String(body.contentBase64 || ""); if (!raw) return json({ error: "File content is required" }, 400);
      if (raw.length > MAX_BASE64_CHARS) return json({ error: `File must be between 1 byte and ${MAX_MB} MB` }, 400);
      let bytes: Uint8Array;
      try { bytes = base64ToBytes(raw); } catch { return json({ error: "File content is not valid base64" }, 400); }
      if (bytes.byteLength !== size || bytes.byteLength > MAX_BYTES) return json({ error: "File size validation failed" }, 400);
      const path = `${LIBRARY_FOLDER}/${crypto.randomUUID()}-${name}`;
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
