import { MAX_VOICE_PEERS, VOICE_RADIUS, type PlayerVoiceClientMessage, type PlayerVoiceServerMessage, type VoiceIceServer } from "../lib/world/player-voice-contract";

type Player = { id: string; position: readonly number[] };
type Delivery = { to: string; message: PlayerVoiceServerMessage };
const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());

/** One instance per DO. All inputs are authoritative, joined room members. */
export class PlayerVoiceRoom {
  private optedIn = new Set<string>();
  private pairs = new Map<string, string>();
  private rosters = new Map<string, string>();
  constructor(private iceServers: VoiceIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }], private sessionId: () => string = () => crypto.randomUUID()) {}
  remove(id: string) {
    this.optedIn.delete(id); this.rosters.delete(id);
    for (const key of this.pairs.keys()) if ((JSON.parse(key) as string[]).includes(id)) this.pairs.delete(key);
  }
  refresh(players: readonly Player[]): Delivery[] {
    const members = new Set(players.map(p => p.id));
    for (const id of this.optedIn) if (!members.has(id)) this.remove(id);
    const active = players.filter(p => this.optedIn.has(p.id)).sort((a,b) => a.id.localeCompare(b.id));
    const candidates: { a: string; b: string; key: string; distance: number }[] = [];
    for (let i=0; i<active.length; i++) for (let j=i+1; j<active.length; j++) {
      const a=active[i], b=active[j];
      const distance = Math.hypot(...a.position.map((v,k) => v-b.position[k]));
      if (Number.isFinite(distance) && distance < VOICE_RADIUS) candidates.push({ a:a.id, b:b.id, key:pairKey(a.id,b.id), distance });
    }
    // Retain eligible established edges to avoid negotiation churn while walking.
    // Fill free capacity by distance and deterministic pair order, always at both ends.
    candidates.sort((a,b) => Number(this.pairs.has(b.key))-Number(this.pairs.has(a.key)) || a.distance-b.distance || a.key.localeCompare(b.key));
    const next = new Map<string,string>();
    const lists = new Map(players.map(p => [p.id, [] as {playerId:string; sessionId:string}[]]));
    for (const pair of candidates) {
      const a=lists.get(pair.a)!, b=lists.get(pair.b)!;
      if (a.length >= MAX_VOICE_PEERS || b.length >= MAX_VOICE_PEERS) continue;
      const sessionId=this.pairs.get(pair.key) ?? this.sessionId();
      next.set(pair.key,sessionId);
      a.push({playerId:pair.b,sessionId}); b.push({playerId:pair.a,sessionId});
    }
    // A saturated clique must not permanently exclude a degree-zero newcomer.
    // At most one edge replacement per isolated player per refresh. Only borrow
    // from an edge whose other endpoint keeps a connection, so silence is never
    // transferred to an existing member. If no such edge exists, this local
    // rewire cannot cover the newcomer without isolating someone else.
    for (const player of active) {
      const own = lists.get(player.id)!;
      if (own.length) continue;
      const nearby = candidates.filter(pair => pair.a === player.id || pair.b === player.id)
        .sort((a,b) => a.distance-b.distance || a.key.localeCompare(b.key));
      for (const pair of nearby) {
        const neighbor = pair.a === player.id ? pair.b : pair.a;
        const edges = lists.get(neighbor)!;
        let donor: typeof edges[number] | undefined;
        if (edges.length >= MAX_VOICE_PEERS) {
          donor = [...edges].filter(edge => lists.get(edge.playerId)!.length > 1)
            .sort((a,b) => lists.get(b.playerId)!.length-lists.get(a.playerId)!.length || a.playerId.localeCompare(b.playerId))[0];
          if (!donor) continue;
          next.delete(pairKey(neighbor, donor.playerId));
          edges.splice(edges.indexOf(donor),1);
          const other = lists.get(donor.playerId)!;
          other.splice(other.findIndex(edge => edge.playerId === neighbor),1);
        }
        const sessionId = this.sessionId();
        next.set(pair.key,sessionId);
        own.push({playerId:neighbor,sessionId});
        edges.push({playerId:player.id,sessionId});
        break;
      }
    }
    this.pairs=next;
    const deliveries: Delivery[]=[];
    for (const p of players) {
      if (!this.optedIn.has(p.id)) continue;
      const peers=lists.get(p.id)!.sort((a,b)=>a.playerId.localeCompare(b.playerId));
      const optedIn=this.optedIn.has(p.id), key=JSON.stringify([optedIn,peers]);
      if (this.rosters.get(p.id) === key) continue;
      this.rosters.set(p.id,key);
      deliveries.push({to:p.id,message:{type:"voice-peers",peers,iceServers:optedIn ? this.iceServers : [],radius:VOICE_RADIUS}});
    }
    return deliveries;
  }
  handle(from: string, message: PlayerVoiceClientMessage, players: readonly Player[]): Delivery[] {
    if (!players.some(p=>p.id===from)) return [];
    if (message.type === "voice-join") this.optedIn.add(from);
    if (message.type === "voice-leave") this.remove(from);
    const updates=this.refresh(players);
    if (message.type === "voice-leave") updates.push({to:from,message:{type:"voice-peers",peers:[],iceServers:[],radius:VOICE_RADIUS}});
    if (message.type !== "voice-signal") return updates;
    // The sender is the authenticated socket identity, never supplied by a message.
    if (from===message.to || !this.optedIn.has(from) || !this.optedIn.has(message.to) || this.pairs.get(pairKey(from,message.to))!==message.sessionId) {
      return [...updates,{to:from,message:{type:"voice-error",message:"Voice peer is no longer nearby or the session expired."}}];
    }
    return [...updates,{to:message.to,message:{type:"voice-signal",from,sessionId:message.sessionId,signal:message.signal}}];
  }
}

/** Voice traffic has independent quotas, while an ingress ceiling bounds parsing. */
export class VoiceBudget {
  private since=0;
  private ice=0;
  private sdp=0;
  private controls=0;
  private ingress=0;
  private bytes=0;
  private reset(now:number) {
    if(now-this.since>=1000) { this.since=now; this.ice=0; this.sdp=0; this.controls=0; this.ingress=0; this.bytes=0; }
  }
  admit(bytes:number,now:number) { this.reset(now); this.bytes+=bytes; return ++this.ingress<=256 && this.bytes<=512*1024; }
  allow(message:PlayerVoiceClientMessage,now:number) {
    this.reset(now);
    if(message.type!=="voice-signal") return ++this.controls<=10;
    return message.signal.kind==="ice" ? ++this.ice<=120 : ++this.sdp<=16;
  }
}
