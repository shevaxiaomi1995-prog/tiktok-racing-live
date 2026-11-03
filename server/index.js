import 'dotenv/config';
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';

const app=express();
const server=http.createServer(app);
const wss=new WebSocketServer({server,path:'/ws'});
const PORT=Number(process.env.PORT||8787);
const EVENT_INGEST_TOKEN=process.env.EVENT_INGEST_TOKEN||'';
const ALLOW_DEMO_EVENTS=(process.env.ALLOW_DEMO_EVENTS??'false')==='true';
app.use(express.json({limit:'64kb'}));

function publish(event){
  const payload=JSON.stringify(event);
  let sent=0;
  for(const client of wss.clients){if(client.readyState===1){client.send(payload);sent++}}
  return sent;
}
app.get('/api/health',(_req,res)=>res.json({ok:true,service:'tiktok-racing-live-events',clients:wss.clients.size}));
app.post('/api/events',(req,res)=>{
  if(!EVENT_INGEST_TOKEN||req.headers.authorization!==`Bearer ${EVENT_INGEST_TOKEN}`){return res.status(401).json({error:'Unauthorized'})}
  const event=req.body;
  if(!event||typeof event.type!=='string')return res.status(400).json({error:'Event type is required'});
  const sent=publish(event);res.json({ok:true,deliveredTo:sent});
});
app.post('/api/demo/event',(req,res)=>{
  if(!ALLOW_DEMO_EVENTS)return res.status(403).json({error:'Demo event endpoint is disabled'});
  const event=req.body;
  if(!event||typeof event.type!=='string')return res.status(400).json({error:'Event type is required'});
  const sent=publish(event);res.json({ok:true,deliveredTo:sent});
});
wss.on('connection',ws=>{ws.send(JSON.stringify({type:'server_status',status:'connected'}));});
server.listen(PORT,'0.0.0.0',()=>console.log(`TikTok Racing event server listening on :${PORT}`));
