import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization, x-request-id, x-attempt","Access-Control-Expose-Headers":"Content-Type, x-request-id"};
serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
 if(req.method!=="POST")return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:{...CORS,"Content-Type":"application/json"}});
 const requestId=req.headers.get("x-request-id")||crypto.randomUUID(),attempt=req.headers.get("x-attempt")||"1";
 try{
  const key=Deno.env.get("GEMINI_API_KEY");if(!key)throw new Error("GEMINI_API_KEY is not configured");
  const {contents,generationConfig={},stream=true}=await req.json();if(!Array.isArray(contents)||!contents.length)throw new Error("contents is required");
  console.log(JSON.stringify({requestId,attempt,event:"gemini_start",stream}));
  const method=stream?"streamGenerateContent":"generateContent",suffix=stream?"&alt=sse":"";
  const upstream=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:${method}?key=${key}${suffix}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents,generationConfig:{...generationConfig,maxOutputTokens:generationConfig.maxOutputTokens??1200}})});
  if(!upstream.ok){const detail=await upstream.text();console.error(JSON.stringify({requestId,attempt,event:"gemini_error",status:upstream.status}));return new Response(JSON.stringify({error:`Gemini HTTP ${upstream.status}`,detail,requestId}),{status:upstream.status,headers:{...CORS,"Content-Type":"application/json"}});}
  if(!stream)return new Response(await upstream.text(),{headers:{...CORS,"Content-Type":"application/json","x-request-id":requestId}});
  return new Response(upstream.body,{headers:{...CORS,"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache","x-request-id":requestId}});
 }catch(e){const message=e instanceof Error?e.message:String(e);console.error(JSON.stringify({requestId,attempt,event:"function_error",message}));return new Response(JSON.stringify({error:message,requestId}),{status:500,headers:{...CORS,"Content-Type":"application/json"}});}
});
