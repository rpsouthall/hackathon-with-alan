import { transcriptFragment } from '/live-config.mjs';
const $=id=>document.getElementById(id);
const start=$('start'),stop=$('stop'),mute=$('mute'),audio=$('audio'),status=$('status'),error=$('error'),captions=$('captions');
let current=null;
const showError=message=>{error.textContent=message;};
function release(s){clearTimeout(s.timeout);clearTimeout(s.limit);s.mic?.getTracks().forEach(t=>t.stop());s.dc?.close();s.pc?.close();if(current===s){current=null;audio.srcObject=null;start.disabled=false;mute.disabled=true;stop.disabled=true;}}
async function end(s,graceful=true){
 if(s.ending)return;s.ending=true;mute.disabled=true;stop.disabled=true;s.mic?.getTracks().forEach(t=>t.enabled=false);
 if(graceful && s.ready && s.dc?.readyState==='open'){
   status.textContent='Ending conversation…';s.dc.send(JSON.stringify({type:'session.close'}));
   await Promise.race([s.closed,new Promise(r=>setTimeout(r,3000))]);
 }
 if(s.ticket){try{const r=await fetch('/api/live/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:s.ticket})});if(!r.ok)showError('Server could not confirm shutdown. The server will retry at the session limit.');}catch{showError('Shutdown could not be confirmed. Keep the test server running so its timer can end the session.');}}
 release(s);status.textContent='Conversation ended.';
}
function caption(s,event){
 const fragment=transcriptFragment(event);if(!fragment)return;
 // Preserve exact fragments and their timing. This UI displays fragments, not inferred turns.
 s.fragments.push(fragment);
 if(!s.hasCaptions){captions.replaceChildren();s.hasCaptions=true;}
 const follow=captions.scrollHeight-captions.scrollTop-captions.clientHeight<70;
 const row=document.createElement('div');row.className='line';
 const label=document.createElement('b');label.textContent=fragment.speaker==='npc'?'Aiko':'You';
 const text=document.createElement('p');text.lang='ja';text.textContent=fragment.text;row.append(label,text);captions.append(row);
 if(follow)captions.scrollTop=captions.scrollHeight;
}
start.onclick=async()=>{
 start.disabled=true;error.textContent='';captions.replaceChildren();status.textContent='Allow microphone access to begin…';
 const s={fragments:[],ending:false,ready:false};s.closed=new Promise(r=>s.resolveClosed=r);current=s;
 try{
   s.mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
   s.pc=new RTCPeerConnection();s.mic.getAudioTracks().forEach(t=>s.pc.addTrack(t,s.mic));
   s.pc.ontrack=e=>{if(current!==s)return;audio.srcObject=new MediaStream([e.track]);audio.play().catch(()=>showError('Press Play on the audio controls to hear Aiko.'));};
   s.pc.onconnectionstatechange=()=>{if(s.pc.connectionState==='failed'&&!s.ending){showError('Voice connection failed. Try again.');void end(s,false);}};
   s.dc=s.pc.createDataChannel('oai-events');
   s.dc.onmessage=({data})=>{
     if(current!==s)return;
     let e;try{e=JSON.parse(data);}catch{return;}
     if(e.type==='session.started'){
       s.ready=true;clearTimeout(s.timeout);status.textContent='Connected · Speak to Aiko in Japanese';stop.disabled=false;mute.disabled=false;mute.textContent='Mute microphone';
       s.dc.send(JSON.stringify({type:'session.instructions.append',event_id:crypto.randomUUID(),delegation_id:null,content:'Greet the player immediately in Japanese: いらっしゃいませ。何になさいますか？ Then pause and listen. Continue responding in simple Japanese.'}));
     }else if(e.type==='session.closed'){s.resolveClosed();if(!s.ending)void end(s,false);}
     else if(e.type==='error'){showError('The voice service reported an error. End the conversation and try again.');}
     else caption(s,e);
   };
   s.dc.onclose=()=>{if(!s.ending&&current===s){showError('The voice connection closed.');void end(s,false);}};
   s.dc.onerror=()=>{if(!s.ending)void end(s,false);};
   await s.pc.setLocalDescription(await s.pc.createOffer());
   if(s.pc.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>{s.pc.removeEventListener('icegatheringstatechange',changed);reject(new Error('Microphone connection timed out.'));},10000);
     function changed(){if(s.pc.iceGatheringState==='complete'){clearTimeout(timer);s.pc.removeEventListener('icegatheringstatechange',changed);resolve();}}
     s.pc.addEventListener('icegatheringstatechange',changed);changed();
   });
   status.textContent='Connecting to Aiko…';
   const response=await fetch('/api/live/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sdp:s.pc.localDescription.sdp}),signal:AbortSignal.timeout(35000)});
   const result=await response.json();if(!response.ok)throw new Error(result.error||'Unable to start voice.');
   s.ticket=result.ticket;
   s.limit=setTimeout(()=>void end(s),Math.max(1000,result.limitMs-5000));
   s.timeout=setTimeout(()=>{showError('Aiko did not connect. Please try again.');void end(s,false);},20000);
   await s.pc.setRemoteDescription({type:'answer',sdp:result.transport.sdp});
 }catch(e){showError(e.name==='NotAllowedError'?'Microphone access was blocked. Allow it in your browser and try again.':e.message);await end(s,false);}
};
stop.onclick=()=>{if(current)void end(current);};
mute.onclick=()=>{if(!current?.ready)return;const tracks=current.mic.getAudioTracks();const enabled=!tracks[0].enabled;tracks.forEach(t=>t.enabled=enabled);mute.textContent=enabled?'Mute microphone':'Unmute microphone';status.textContent=enabled?'Connected · Speak to Aiko in Japanese':'Connected · Microphone muted';};
window.addEventListener('pagehide',()=>{if(current){const s=current;s.ending=true;if(s.ticket)navigator.sendBeacon('/api/live/stop',new Blob([JSON.stringify({ticket:s.ticket})],{type:'application/json'}));release(s);}});
fetch('/api/health').then(r=>r.json()).then(d=>{if(!current){status.textContent=d.configured?'Ready · Start when you want to talk':'API key is missing';start.disabled=!d.configured;}}).catch(()=>{status.textContent='Local voice server unavailable';start.disabled=true;});
