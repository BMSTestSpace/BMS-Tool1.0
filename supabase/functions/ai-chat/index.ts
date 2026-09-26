import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods*: "POST, OPTIONS",
  "Access-Contr*l-Allow-Headers":
    "Content-Typ*, Authorization, apikey, x-client-*nfo",
};

serve(async (req: Reques*) => {
  if (req.method === "OPTIO*S") {
    return new Response(null* {
      status: 204,
      header*: corsHeaders,
    });
  }

  if (*eq.method !== "POST") {
    return*new Response(
      JSON.stringify*{
        error: "Method not allow*d",
      }),
      {
        stat*s: 405,
        headers: {
       *  ...corsHeaders,
          "Conte*t-Type": "application/json",
     *  },
      }
    );
  }

  try {
 *  const apiKey = Deno.env.get("GEM*NI_API_KEY");

    if (!apiKey) {
*     throw new Error("GEMINI_API_K*Y is not configured.");
    }

   *const requestBody = await req.json*);
    const { contents, generatio*Config } = requestBody;

    if (!*rray.isArray(contents) || contents*length === 0) {
      return new R*sponse(
        JSON.stringify({
 *        error: "A non-empty conten*s array is required.",
        }),*        {
          status: 400,
 *        headers: {
            ...*orsHeaders,
            "Content-T*pe": "application/json",
         *},
        }
      );
    }

    c*nst geminiResponse = await fetch(
*     `https://generativelanguage.g*ogleapis.com/v1beta/models/gemini-*.5-flash:generateContent?key=${api*ey}`,
      {
        method: "POS*",
        headers: {
          "C*ntent-Type": "application/json",
 *      },
        body: JSON.string*fy({
          contents,
         *generationConfig: {
            te*perature: 0.4,
            maxOutp*tTokens: 600,
            ...gener*tionConfig,
          },
        }*,
      }
    );

    const data =*await geminiResponse.json();

    *f (!geminiResponse.ok) {
      con*ole.error(
        "Gemini request*failed:",
        geminiResponse.s*atus,
        JSON.stringify(data)*      );

      return new Respons*(
        JSON.stringify({
       *  error:
            data?.error?.*essage ||
            `Gemini requ*st failed with HTTP ${geminiRespon*e.status}.`,
        }),
        {*          status: geminiResponse.s*atus,
          headers: {
       *    ...corsHeaders,
            "C*ntent-Type": "application/json",
 *        },
        }
      );
    *

    return new Response(JSON.str*ngify(data), {
      status: 200,
*     headers: {
        ...corsHea*ers,
        "Content-Type": "appl*cation/json",
      },
    });
  }*catch (error) {
    console.error(*ai-chat error:", error);

    retu*n new Response(
      JSON.stringi*y({
        error:
          error*instanceof Error
            ? err*r.message
            : "An unexpe*ted server error occurred.",
     *}),
      {
        status: 500,
 *      headers: {
          ...cors*eaders,
          "Content-Type": *application/json",
        },
    * }
    );
  }
});
