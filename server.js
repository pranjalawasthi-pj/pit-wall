import express from 'express'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

dotenv.config()
const app = express()
const PORT = Number(process.env.PORT || 8787)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.disable('x-powered-by')
app.use(express.json({ limit: '22mb' }))
const PROMPT = `You read university timetables. Reply with ONLY valid JSON: {"classes":[{"day":0,"start":"HH:MM","end":"HH:MM","subject":"short name","guessed":false}],"notes":"one short line"}. day: Mon=0 ... Sat=5. Read cells exactly; never invent classes. HBTU periods: 10:00-10:50, 10:50-11:40, 11:40-12:30, 12:30-13:20, lunch 13:20-14:20, 14:20-15:10, 15:10-16:00, 16:00-16:50. If unclear, infer by position and set guessed=true. Merge consecutive periods of one lab/class. Include ONLY requested branch/section. Use 24-hour time. Skip free, lunch and empty cells. Return JSON only.`
const rate = new Map()
function rateLimit(req, res, next) { const key=req.ip||'unknown', now=Date.now(), hits=(rate.get(key)||[]).filter(t=>now-t<60000); if(hits.length>=15)return res.status(429).json({error:'Too many AI requests. Wait one minute.'}); hits.push(now); rate.set(key,hits); next() }
app.get('/api/ai/status', (_req,res)=>res.json({configured:Boolean(process.env.AI_API_KEY), model:process.env.AI_MODEL||'gpt-4o-mini'}))
function extractJson(text){const clean=String(text||'').replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/i,'').trim();const a=clean.indexOf('{'),b=clean.lastIndexOf('}');if(a<0||b<=a)throw new Error('AI returned no timetable JSON. Try a clearer file.');return JSON.parse(clean.slice(a,b+1))}
app.post('/api/ai/read-timetable',rateLimit,async(req,res)=>{try{
 const {branchLabel,mediaType,data}=req.body||{}
 if(!process.env.AI_API_KEY)return res.status(503).json({error:'AI is not configured. Add your single AI_API_KEY to the server .env file and restart.'})
 if(typeof branchLabel!=='string'||!branchLabel.trim()||branchLabel.length>120)return res.status(400).json({error:'Select a valid branch first.'})
 if(!['image/png','image/jpeg','image/webp'].includes(mediaType))return res.status(400).json({error:'The universal API accepts timetable images. PDF pages are converted to an image in the browser; please retry.'})
 if(typeof data!=='string'||data.length>28000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))return res.status(400).json({error:'Invalid image or file exceeds 20 MB.'})
 const base=(process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'')
 const model=process.env.AI_MODEL||'gpt-4o-mini'
 const prompt=`${PROMPT}\nRequested branch/section: ${branchLabel}. Return the JSON now.`
 const response=await fetch(`${base}/chat/completions`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${process.env.AI_API_KEY}`},body:JSON.stringify({model,temperature:0,max_tokens:10000,response_format:{type:'json_object'},messages:[{role:'system',content:PROMPT},{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:`data:${mediaType};base64,${data}`}}]}]})})
 const out=await response.json().catch(()=>({}));if(!response.ok)throw new Error(out.error?.message||`AI API request failed (${response.status})`)
 const text=out.choices?.[0]?.message?.content||'';res.json({result:extractJson(text),model})
 }catch(error){console.error('[AI timetable]',error.message);res.status(502).json({error:error.message||'AI timetable reading failed.'})}})
if(process.env.NODE_ENV==='production')app.use(express.static(path.join(__dirname,'dist')))
app.listen(PORT,()=>console.log(`PIT WALL API listening on http://localhost:${PORT}`))
