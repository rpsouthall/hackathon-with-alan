import test from "node:test";
import assert from "node:assert/strict";
import { PlayerVoiceRoom, VoiceBudget } from "../../multiplayer/player-voice";
import { playerVoiceClientSchema, playerVoiceServerSchema, VOICE_ENVELOPE_LIMIT } from "../../lib/world/player-voice-contract";
const players = (n=2) => Array.from({length:n},(_,i)=>({id:`p${i}`,position:[i/100,0,0]}));
const signal = (to:string,sessionId:string) => ({type:"voice-signal",to,sessionId,signal:{kind:"ice",candidate:null}} as const);
function setup(n=2) {
  let next=0;
  const room = new PlayerVoiceRoom([],()=>`session_${++next}`), ps=players(n);
  const rosters = new Map<string, {playerId:string;sessionId:string}[]>();
  function ingest(updates:ReturnType<PlayerVoiceRoom["refresh"]>) {
    for(const {to,message} of updates) { assert.equal(playerVoiceServerSchema.safeParse(message).success,true); if(message.type==="voice-peers") rosters.set(to,message.peers); }
    return updates;
  }
  for(const p of ps) ingest(room.handle(p.id,{type:"voice-join"},ps));
  return {room,ps,rosters,ingest};
}
test("32 members have symmetric graphs of degree at most seven and stable sessions",()=>{
  const {room,ps,rosters}=setup(32);
  assert.equal(rosters.size,32);
  for(const [id,peers] of rosters) { assert.ok(peers.length<=7); assert.ok(peers.length>0); for(const p of peers) assert.ok(rosters.get(p.playerId)?.some(other=>other.playerId===id && other.sessionId===p.sessionId)); }
  assert.deepEqual(room.refresh([...ps].reverse()),[]);
});
test("signals derive identity, require opt-in and reject absent targets, self and stale sessions",()=>{
  const {room,ps,rosters}=setup();const sid=rosters.get("p0")![0].sessionId;
  assert.deepEqual(room.handle("p0",signal("p1",sid),ps).at(-1),{to:"p1",message:{type:"voice-signal",from:"p0",sessionId:sid,signal:{kind:"ice",candidate:null}}});
  for(const msg of [signal("missing",sid),signal("p0",sid),signal("p1","expired")]) assert.equal(room.handle("p0",msg,ps).at(-1)?.message.type,"voice-error");
  assert.deepEqual(room.handle("intruder",signal("p1",sid),ps),[]);
  room.handle("p1",{type:"voice-leave"},ps);
  assert.equal(room.handle("p0",signal("p1",sid),ps).at(-1)?.message.type,"voice-error");
});
test("authoritative range is rechecked on signal before periodic broadcasts",()=>{
  const {room,ps,rosters,ingest}=setup();const sid=rosters.get("p0")![0].sessionId;
  ps[1].position=[12,0,0];
  assert.equal(ingest(room.handle("p0",signal("p1",sid),ps)).at(-1)?.message.type,"voice-error");
  assert.deepEqual(rosters.get("p0"),[]);assert.deepEqual(rosters.get("p1"),[]);
  ps[1].position=[1,0,0];ingest(room.refresh(ps));assert.notEqual(rosters.get("p0")![0].sessionId,sid);
});
test("disable, disconnect and room instances invalidate sessions",()=>{
  const {room,ps,rosters,ingest}=setup();const sid=rosters.get("p0")![0].sessionId;
  ingest(room.handle("p0",{type:"voice-leave"},ps));ingest(room.handle("p0",{type:"voice-join"},ps));
  assert.notEqual(rosters.get("p0")![0].sessionId,sid);
  room.remove("p1");ingest(room.refresh(ps.slice(0,1)));assert.deepEqual(rosters.get("p0"),[]);
  const elsewhere=new PlayerVoiceRoom([]);assert.deepEqual(elsewhere.handle("p0",signal("p1",sid),[]),[]);
});
test("members who did not opt in never acquire voice edges",()=>{
  const room=new PlayerVoiceRoom([]),ps=players();
  const updates=room.handle("p0",{type:"voice-join"},ps);
  for(const {message} of updates) if(message.type==="voice-peers") assert.equal(message.peers.length,0);
});
test("nonfinite positions fail closed",()=>{
  const {room,ps,rosters}=setup();const sid=rosters.get("p0")![0].sessionId;ps[1].position=[NaN,0,0];
  assert.equal(room.handle("p0",signal("p1",sid),ps).at(-1)?.message.type,"voice-error");
});
test("schema rejects spoofing, extra fields, oversized SDP/ICE and NPC input",()=>{
  for(const data of [{...signal("p1","s"),from:"p2"},{type:"voice-join",playerId:"p2"},{type:"npc-audio",audio:"AA=="},{...signal("p1","s"),signal:{kind:"offer",sdp:"x".repeat(16001)}},{...signal("p1","s"),signal:{kind:"ice",candidate:{candidate:"x".repeat(2049)}}}]) assert.equal(playerVoiceClientSchema.safeParse(data).success,false);
  const offer={...signal("p1","s"),signal:{kind:"offer",sdp:"x".repeat(16000)}};
  assert.equal(playerVoiceClientSchema.safeParse(offer).success,true);assert.ok(JSON.stringify(offer).length<VOICE_ENVELOPE_LIMIT);
  assert.equal(playerVoiceClientSchema.safeParse({...signal("p1","s"),signal:{kind:"ice",candidate:null}}).success,true);
});
test("ICE, SDP and opt-in budgets are independent and reset each second",()=>{
  const b=new VoiceBudget(),ice=signal("p1","s"),offer={...ice,signal:{kind:"offer",sdp:"v=0"} as const};
  for(let i=0;i<120;i++) assert.equal(b.allow(ice,1000),true);
  assert.equal(b.allow(ice,1000),false);
  for(let i=0;i<16;i++) assert.equal(b.allow(offer,1000),true);
  assert.equal(b.allow(offer,1000),false);
  for(let i=0;i<10;i++) assert.equal(b.allow({type:"voice-join"},1000),true);
  assert.equal(b.allow({type:"voice-join"},1000),false);assert.equal(b.allow(ice,2000),true);
});
test("ingress ceiling bounds combined messages and bytes",()=>{
  const b=new VoiceBudget();for(let i=0;i<256;i++)assert.equal(b.admit(1,1000),true);
  assert.equal(b.admit(1,1000),false);assert.equal(b.admit(512*1024,2000),true);assert.equal(b.admit(1,2000),false);
});
test("moving a crowded room keeps every edge symmetric and <=7",()=>{
  const {room,ps,rosters,ingest}=setup(32);
  for(let frame=0;frame<50;frame++) {
    ps.forEach((p,i)=>p.position=[Math.sin(frame+i)*15,0,Math.cos(frame+i)*15]);ingest(room.refresh(ps));
    for(const [id,peers] of rosters) { assert.ok(peers.length<=7); for(const p of peers) assert.ok(rosters.get(p.playerId)?.some(other=>other.playerId===id && other.sessionId===p.sessionId)); }
  }
});

for (const count of [9,17]) test(`${count} co-located sequential opt-ins never strand a newcomer`,()=>{
  let next=0;
  const room=new PlayerVoiceRoom([],()=>`fair_${++next}`),ps=players(count).map(p=>({...p,position:[0,0,0]}));
  const rosters=new Map<string,{playerId:string;sessionId:string}[]>();
  const ingest=(updates:ReturnType<PlayerVoiceRoom["refresh"]>)=>{
    for(const {to,message} of updates) if(message.type==="voice-peers") rosters.set(to,message.peers);
  };
  for(let i=0;i<count;i++) {
    const before=new Map<string,string>();
    for(const [id,edges] of rosters) for(const edge of edges) before.set(JSON.stringify([id,edge.playerId].sort()),edge.sessionId);
    ingest(room.handle(ps[i].id,{type:"voice-join"},ps));
    const after=new Map<string,string>();
    for(let j=0;j<=i;j++) {
      const edges=rosters.get(ps[j].id)!;
      assert.ok(edges.length<=7);
      if(i>0) assert.ok(edges.length>0,`${ps[j].id} isolated after join ${i+1}`);
      for(const edge of edges) {
        assert.ok(rosters.get(edge.playerId)?.some(e=>e.playerId===ps[j].id && e.sessionId===edge.sessionId));
        const key=JSON.stringify([ps[j].id,edge.playerId].sort());after.set(key,edge.sessionId);
        if(before.has(key)) assert.equal(edge.sessionId,before.get(key));
      }
    }
    assert.ok([...before.keys()].filter(key=>!after.has(key)).length<=1,'at most one old edge replaced for each new arrival');
  }
  // Filling spare capacity may add edges once; it must never churn retained sessions.
  ingest(room.refresh(ps));
  const stable=JSON.stringify([...rosters]);
  for(let frame=0;frame<20;frame++) { ingest(room.refresh([...ps].reverse()));assert.equal(JSON.stringify([...rosters]),stable); }
});
test("fair rewiring invalidates the replaced pair's signaling session",()=>{
  const {room,ps,rosters,ingest}=setup(8);
  const before=new Map<string,string>();
  for(const [id,edges] of rosters) for(const edge of edges) before.set(JSON.stringify([id,edge.playerId].sort()),edge.sessionId);
  ps.push({id:"newcomer",position:[0,0,0]});ingest(room.handle("newcomer",{type:"voice-join"},ps));
  const removed=[...before].filter(([key])=>{const [a,b]=JSON.parse(key);return !rosters.get(a)!.some(edge=>edge.playerId===b);});
  assert.equal(removed.length,1);
  const [[key,sid]]=removed;const [a,b]=JSON.parse(key);
  assert.equal(room.handle(a,signal(b,sid),ps).at(-1)?.message.type,"voice-error");
});

test("gameplay-only clients receive no unsolicited voice frames",()=>{
  const room=new PlayerVoiceRoom([]),ps=players(3);
  assert.deepEqual(room.refresh(ps),[]);
  const first=room.handle("p0",{type:"voice-join"},ps);assert.deepEqual(first.map(d=>d.to),["p0"]);
  const second=room.handle("p1",{type:"voice-join"},ps);assert.ok(second.every(d=>d.to!=="p2"));
  const leave=room.handle("p0",{type:"voice-leave"},ps);
  assert.deepEqual(leave.filter(d=>d.to==="p0"),[{to:"p0",message:{type:"voice-peers",peers:[],iceServers:[],radius:12}}]);
  assert.ok(leave.every(d=>d.to!=="p2"));assert.deepEqual(room.refresh(ps),[]);
});
