import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticRequestSchema, RoomTickDiagnostics, ROOM_LOCATION_HINT, roomObjectName } from "../../multiplayer/room-diagnostics";

test("new APAC generation preserves room identity and separates old objects",()=>{
  assert.equal(ROOM_LOCATION_HINT,"apac");
  assert.equal(roomObjectName("friends"),"v3-apac:friends");
  assert.notEqual(roomObjectName("friends"),"friends");
  assert.notEqual(roomObjectName("friends"),roomObjectName("another"));
});
test("diagnostic requests cannot smuggle identities or arbitrary timestamps",()=>{
  assert.equal(diagnosticRequestSchema.safeParse({type:"diagnostic-ping",id:7}).success,true);
  for(const value of [{type:"diagnostic-ping",id:-1},{type:"diagnostic-ping",id:1,from:"other"},{type:"diagnostic-ping",id:Infinity},{type:"diagnostic-ping",id:1.5},{type:"diagnostic-ping",id:2147483648}])assert.equal(diagnosticRequestSchema.safeParse(value).success,false);
});
test("all-zero execution clocks report unavailable CPU/processing, not zero cost",()=>{
  const d=new RoomTickDiagnostics();assert.equal(d.snapshot().samples,0);
  d.record(50,0);d.record(90,0);
  assert.equal(d.snapshot().processingWallMs,null);assert.equal(d.snapshot().cpuMs,null);
  assert.equal(d.snapshot().processingClock,"below-clock-resolution");
  assert.equal(d.snapshot().latenessMs?.max,40);
});
test("tick history stays bounded and tracks scheduling and wall duration separately",()=>{
  const d=new RoomTickDiagnostics();d.record(999,99);
  for(let i=0;i<120;i++)d.record(50,2);
  d.record(NaN,1);d.record(50,-1);
  assert.equal(d.snapshot().samples,120);assert.equal(d.snapshot().intervalMs?.max,50);
  assert.equal(d.snapshot().processingWallMs?.p95,2);assert.equal(d.snapshot().cpuMs,null);
  assert.equal(d.snapshot().processingClock,"wall-clock-not-cpu");
});
