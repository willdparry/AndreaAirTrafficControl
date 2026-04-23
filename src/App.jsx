import { useState, useEffect, useRef, useCallback } from "react";

// ── Config ────────────────────────────────────────────────────────────────────
const PROXY = "/api/opensky";
const POLL_INTERVAL = 15000; // 15s — respectful of rate limits

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchOpenSky(path, params = {}) {
  const qs = new URLSearchParams({ path, ...params }).toString();
  const res = await fetch(`${PROXY}?${qs}`);
  if (!res.ok) throw new Error(`OpenSky error ${res.status}`);
  return res.json();
}

const F = { icao24:0, callsign:1, origin:2, time_pos:3, last_contact:4, lon:5, lat:6, baro_alt:7, on_ground:8, velocity:9, heading:10 };

function parseState(sv) {
  return {
    icao24:   sv[F.icao24],
    callsign: (sv[F.callsign] || "").trim(),
    lon:      sv[F.lon],
    lat:      sv[F.lat],
    alt:      sv[F.baro_alt] || 0,
    speed:    sv[F.velocity] ? Math.round(sv[F.velocity] * 1.94384) : 0,
    heading:  sv[F.heading] || 0,
    onGround: sv[F.on_ground],
  };
}

function project(lon, lat) {
  return { x: ((lon + 180) / 360) * 800, y: ((90 - lat) / 180) * 400 };
}

function timestamp() {
  return new Date().toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit", second:"2-digit" }) + "Z";
}

function fl(altMetres) {
  return Math.round((altMetres * 3.28084) / 100);
}

// ── Initial family ────────────────────────────────────────────────────────────
const INITIAL_FAMILY = [
  { id:1, name:"Will",    callsign:"WILL-1", emoji:"🧔", color:"#00FF9C", flight:"", status:"ground", squawk:"----", clearance:"Standby",       liveData:null },
  { id:2, name:"Sophie",  callsign:"SOPH-2", emoji:"👩", color:"#00C8FF", flight:"", status:"ground", squawk:"----", clearance:"Standby",       liveData:null },
  { id:3, name:"James",   callsign:"JAME-3", emoji:"👦", color:"#FFD700", flight:"", status:"ground", squawk:"----", clearance:"Hold position", liveData:null },
  { id:4, name:"Grandad", callsign:"PAPA-4", emoji:"👴", color:"#FF6B6B", flight:"", status:"ground", squawk:"----", clearance:"Standby",       liveData:null },
  { id:5, name:"Chloe",   callsign:"CHLO-5", emoji:"👧", color:"#C77DFF", flight:"", status:"ground", squawk:"----", clearance:"Standby",       liveData:null },
];

const PHRASEOLOGY = ["Roger that.","Wilco.","Affirm.","Standby.","Copy all.","Negative.","Say again?","Squawk ident."];

// ── App ───────────────────────────────────────────────────────────────────────
export default function AndreaATC() {
  const [family, setFamily]           = useState(INITIAL_FAMILY);
  const [log, setLog]                 = useState([{ id:1, memberId:null, text:"ANDREA CTR online. Radar initialising.", time:timestamp(), type:"sys" }]);
  const [input, setInput]             = useState("");
  const [target, setTarget]           = useState(1);
  const [selected, setSelected]       = useState(null);
  const [blink, setBlink]             = useState(true);
  const [radarStatus, setRadarStatus] = useState("INITIALISING");
  const [lastContact, setLastContact] = useState(null);
  const [addingMember, setAddingMember] = useState(false);
  const [editingFlight, setEditingFlight] = useState(null);
  const [flightInput, setFlightInput] = useState("");
  const [newMember, setNewMember]     = useState({ name:"", emoji:"🧑", flight:"" });
  const logRef      = useRef(null);
  const prevStatus  = useRef({});
  const familyRef   = useRef(family);
  familyRef.current = family;

  useEffect(() => { const t = setInterval(()=>setBlink(b=>!b), 600); return ()=>clearInterval(t); }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior:"smooth" }); }, [log]);

  function addToLog(entry) {
    setLog(l => [...l, { id: Date.now()+Math.random(), time:timestamp(), ...entry }]);
  }

  // ── Poll OpenSky ────────────────────────────────────────────────────────────
  const poll = useCallback(async () => {
    const active = familyRef.current.filter(m => m.flight && m.flight.length >= 4);
    if (!active.length) return;
    setRadarStatus("SCANNING");
    try {
      const data = await fetchOpenSky("states/all", { lamin:"25", lomin:"-30", lamax:"72", lomax:"45" });
      const states = data.states || [];
      setLastContact(Date.now());
      setRadarStatus("ACTIVE");

      setFamily(prev => prev.map(member => {
        if (!member.flight) return member;
        const target = member.flight.toUpperCase().replace(/\s/g,"");
        const sv = states.find(s => (s[F.callsign]||"").trim().toUpperCase().replace(/\s/g,"") === target);
        if (!sv) return member;

        const live      = parseState(sv);
        const newStatus = live.onGround ? "landed" : "flying";
        const prev      = prevStatus.current[member.id];

        if (prev && prev !== newStatus) {
          if (newStatus === "landed") {
            addToLog({ memberId:member.id, type:"auto", text:`${member.callsign} (${member.flight}) has landed. Runway contact confirmed. ✅` });
          } else {
            addToLog({ memberId:member.id, type:"auto", text:`${member.callsign} (${member.flight}) is airborne. Radar contact established.` });
          }
        }
        prevStatus.current[member.id] = newStatus;

        return {
          ...member, status: newStatus, squawk: live.squawk || "----",
          clearance: live.onGround ? "Vacate runway, contact ground" : `FL${fl(live.alt)} — ${live.speed}KT`,
          liveData: live,
        };
      }));
    } catch (err) {
      setRadarStatus("NO CONTACT");
      addToLog({ memberId:null, type:"sys", text:`Radar contact lost. ${err.message}` });
    }
  }, []);

  useEffect(() => { poll(); const t = setInterval(poll, POLL_INTERVAL); return ()=>clearInterval(t); }, [poll]);

  // ── Comms ───────────────────────────────────────────────────────────────────
  function transmit() {
    if (!input.trim()) return;
    const m = family.find(f=>f.id===target);
    addToLog({ memberId:target, type:"atc", text:`${m.callsign}, ${input.trim()}` });
    setInput("");
    setTimeout(() => {
      addToLog({ memberId:target, type:"pilot", text:`${PHRASEOLOGY[Math.floor(Math.random()*PHRASEOLOGY.length)]} — ${m.callsign}.` });
    }, 1100);
  }

  // ── Flight number editing ───────────────────────────────────────────────────
  function saveFlightNumber(memberId) {
    const num = flightInput.trim().toUpperCase();
    setFamily(prev => prev.map(m => m.id===memberId ? {...m, flight:num, status:num?"flying":"ground", liveData:null} : m));
    if (num) {
      const m = familyRef.current.find(f=>f.id===memberId);
      addToLog({ memberId, type:"sys", text:`Flight plan received: ${m.callsign} tracking ${num}. Scanning…` });
    }
    setEditingFlight(null); setFlightInput("");
  }

  // ── Add member ──────────────────────────────────────────────────────────────
  function addFamilyMember() {
    if (!newMember.name.trim()) return;
    const colors = ["#00FF9C","#00C8FF","#FFD700","#FF6B6B","#C77DFF","#FF9F43"];
    const cs = newMember.name.slice(0,4).toUpperCase()+"-"+(family.length+1);
    const m = { id:Date.now(), name:newMember.name, callsign:cs, emoji:newMember.emoji,
      color:colors[family.length%colors.length], flight:newMember.flight.toUpperCase()||null,
      status:newMember.flight?"flying":"ground", squawk:"----", clearance:"Cleared as filed", liveData:null };
    setFamily(f=>[...f,m]);
    addToLog({ memberId:m.id, type:"sys", text:`New traffic: ${cs} added to sector.` });
    setNewMember({ name:"", emoji:"🧑", flight:"" }); setAddingMember(false);
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const sel          = selected ? family.find(m=>m.id===selected) : null;
  const filteredLog  = sel ? log.filter(l=>l.memberId===sel.id||l.memberId===null) : log;
  const flyingLive   = family.filter(m=>m.status==="flying"&&m.liveData?.lon!=null);

  return (
    <div style={s.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;700;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#050e05}::-webkit-scrollbar-thumb{background:#00aa44;border-radius:2px}
        button{cursor:pointer} input{font-family:'Share Tech Mono',monospace}
        @keyframes blip{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.3;transform:scale(0.7)}}
        @keyframes sweep{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
        @keyframes flicker{0%,100%{opacity:1}92%{opacity:1}93%{opacity:0.4}94%{opacity:1}97%{opacity:0.6}98%{opacity:1}}
        @keyframes fadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .log-entry{animation:fadein 0.3s ease-out}
      `}</style>
      <div style={s.scanline}/><div style={s.vignette}/>

      {/* Title bar */}
      <div style={s.titleBar}>
        <div style={s.titleLeft}>
          <span style={s.titleMain}>ANDREA ATC</span>
          <span style={s.titleSub}>▸ FAMILY TRAFFIC CONTROL UNIT v2.4 — LIVE RADAR</span>
        </div>
        <div style={s.titleRight}>
          <div style={s.statusItem}>
            <span style={{...s.dot, background:radarStatus==="ACTIVE"?"#00FF9C":radarStatus==="SCANNING"?"#FFD700":"#FF6B6B", animation:"blip 1.2s infinite"}}/>
            RADAR: {radarStatus}
          </div>
          {lastContact && <div style={s.statusItem}><span style={{...s.dot,background:"#00aa44"}}/>SWEEP: {new Date(lastContact).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}Z</div>}
          <div style={s.statusItem}><span style={{...s.dot,background:"#FFD700",animation:"blip 1s infinite"}}/>{flyingLive.length} AIRBORNE</div>
          <div style={s.clock}>{timestamp()}</div>
        </div>
      </div>

      <div style={s.body}>
        {/* ══ LEFT ══ */}
        <div style={s.colLeft}>

          {/* Radar */}
          <div style={s.radarWrap}>
            <div style={s.radarLabel}>◈ PRIMARY RADAR — LIVE ADS-B via OpenSky Network</div>
            <svg viewBox="0 0 800 400" style={s.radarSvg} preserveAspectRatio="xMidYMid meet">
              <rect width="800" height="400" fill="#020a02"/>
              {[80,160,240].map(r=><ellipse key={r} cx="400" cy="200" rx={r*1.6} ry={r} fill="none" stroke="#00aa2222" strokeWidth="1"/>)}
              {[-60,-30,0,30,60].map(lat=>{const{y}=project(0,lat);return<line key={lat} x1="0" y1={y} x2="800" y2={y} stroke="#00aa2218" strokeWidth="0.5"/>})}
              {[-120,-60,0,60,120].map(lon=>{const{x}=project(lon,0);return<line key={lon} x1={x} y1="0" x2={x} y2="400" stroke="#00aa2218" strokeWidth="0.5"/>})}
              <line x1="400" y1="0" x2="400" y2="400" stroke="#00aa2230" strokeWidth="0.5"/>
              <line x1="0" y1="200" x2="800" y2="200" stroke="#00aa2230" strokeWidth="0.5"/>
              {[[385,130,18,22],[420,145,55,45],[175,160,90,70],[225,290,55,70],[430,250,55,75],[600,155,120,70],[660,310,55,35]].map(([cx,cy,rx,ry],i)=>(
                <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill="#011801" stroke="#00aa2240" strokeWidth="0.5"/>
              ))}
              {/* Sweep */}
              <g style={{transformOrigin:"400px 200px",animation:"sweep 4s linear infinite"}}>
                <path d="M400,200 L400,0 A400,200 0 0,1 800,200 Z" fill="rgba(0,255,100,0.025)"/>
              </g>
              {/* Live blips */}
              {flyingLive.map(member=>{
                const ld=member.liveData;
                const p=project(ld.lon,ld.lat);
                const rad=(ld.heading-90)*Math.PI/180;
                return(
                  <g key={member.id}>
                    <circle cx={p.x} cy={p.y} r="5" fill="none" stroke={member.color} strokeWidth="1">
                      <animate attributeName="r" from="5" to="22" dur="2s" repeatCount="indefinite"/>
                      <animate attributeName="opacity" from="0.6" to="0" dur="2s" repeatCount="indefinite"/>
                    </circle>
                    <line x1={p.x} y1={p.y} x2={p.x+Math.cos(rad)*20} y2={p.y+Math.sin(rad)*20} stroke={member.color} strokeWidth="0.8" opacity="0.5"/>
                    <rect x={p.x+10} y={p.y-22} width={78} height={40} fill="#020a02" stroke={member.color} strokeWidth="0.8" opacity="0.95"/>
                    <text x={p.x+13} y={p.y-10} fontSize="7.5" fill={member.color} fontFamily="'Share Tech Mono',monospace" fontWeight="bold">{member.callsign}</text>
                    <text x={p.x+13} y={p.y} fontSize="6.5" fill={member.color} fontFamily="'Share Tech Mono',monospace" opacity="0.85">{member.flight}</text>
                    <text x={p.x+13} y={p.y+10} fontSize="6" fill={member.color} fontFamily="'Share Tech Mono',monospace" opacity="0.7">FL{fl(ld.alt)} {ld.speed}KT</text>
                    <circle cx={p.x} cy={p.y} r="3.5" fill={member.color} style={{animation:"blip 1s ease-in-out infinite"}}/>
                  </g>
                );
              })}
              {flyingLive.length===0&&(
                <text x="400" y="205" textAnchor="middle" fontSize="11" fill="#00aa4455" fontFamily="'Share Tech Mono',monospace" letterSpacing="3">
                  NO AIRBORNE TRAFFIC — SECTOR QUIET
                </text>
              )}
            </svg>
          </div>

          {/* Strips */}
          <div style={s.stripsSection}>
            <div style={s.sectionLabel}>◈ FLIGHT PROGRESS STRIPS — click [ SET FLIGHT ] to track a flight</div>
            <div style={s.strips}>
              {family.map(member=>(
                <div key={member.id} style={{...s.strip, borderLeftColor:member.color, background:selected===member.id?`${member.color}18`:"#050e0588"}}
                  onClick={()=>{setSelected(s=>s===member.id?null:member.id);setTarget(member.id);}}>
                  <div style={s.stripCallsign}>
                    <span style={{...s.stripCs,color:member.color}}>{member.callsign}</span>
                    <span style={s.stripEmoji}>{member.emoji}</span>
                    <span style={{...s.stripStatus,color:member.status==="flying"?"#00FF9C":member.status==="landed"?"#00C8FF":"#555",borderColor:member.status==="flying"?"#00FF9C":member.status==="landed"?"#00C8FF":"#333"}}>
                      {member.status==="flying"?"AIRBORNE":member.status==="landed"?"LANDED":"ON GND"}
                    </span>
                    {member.liveData&&<span style={s.liveTag}>● LIVE</span>}
                  </div>
                  {editingFlight===member.id?(
                    <div style={s.flightEditRow} onClick={e=>e.stopPropagation()}>
                      <input autoFocus placeholder="e.g. BA2490" value={flightInput}
                        onChange={e=>setFlightInput(e.target.value.toUpperCase())}
                        onKeyDown={e=>{if(e.key==="Enter")saveFlightNumber(member.id);if(e.key==="Escape")setEditingFlight(null);}}
                        style={s.flightEditInput}/>
                      <button style={s.flightEditSave} onClick={()=>saveFlightNumber(member.id)}>SET</button>
                      <button style={s.flightEditCancel} onClick={()=>setEditingFlight(null)}>✕</button>
                    </div>
                  ):(
                    <div style={s.stripRow}>
                      <button style={s.flightNumBtn} onClick={e=>{e.stopPropagation();setEditingFlight(member.id);setFlightInput(member.flight||"");}}>
                        {member.flight||"[ SET FLIGHT ]"}
                      </button>
                      <span style={s.stripField}>SQK {member.squawk}</span>
                      <span style={s.stripClearance}>{member.clearance}</span>
                    </div>
                  )}
                  {member.liveData&&!member.liveData.onGround&&(
                    <div style={s.stripRow}>
                      {[["ALT",`FL${fl(member.liveData.alt)}`],["SPD",`${member.liveData.speed}KT`],["HDG",`${Math.round(member.liveData.heading)}°`]].map(([k,v])=>(
                        <span key={k} style={s.liveChip}><span style={s.liveChipKey}>{k}</span> {v}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {!addingMember?(
                <button style={s.addStrip} onClick={()=>setAddingMember(true)}>+ ADD TRAFFIC TO SECTOR</button>
              ):(
                <div style={s.addForm} onClick={e=>e.stopPropagation()}>
                  <div style={s.addRow}>
                    <input placeholder="NAME" value={newMember.name} onChange={e=>setNewMember(m=>({...m,name:e.target.value}))} style={s.addInput}/>
                    <input placeholder="FLIGHT (optional)" value={newMember.flight} onChange={e=>setNewMember(m=>({...m,flight:e.target.value.toUpperCase()}))} style={s.addInput}/>
                  </div>
                  <div style={s.emojiRow}>
                    {["🧔","👩","👦","👧","👴","👵","🧑"].map(e=>(
                      <button key={e} style={{...s.emojiBtn,borderColor:newMember.emoji===e?"#00FF9C":"#1a3a1a"}} onClick={()=>setNewMember(m=>({...m,emoji:e}))}>{e}</button>
                    ))}
                  </div>
                  <div style={s.addBtns}>
                    <button style={s.confirmBtn} onClick={addFamilyMember}>CONFIRM FLIGHT PLAN</button>
                    <button style={s.cancelBtn} onClick={()=>setAddingMember(false)}>CANCEL</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ══ RIGHT ══ */}
        <div style={s.colRight}>
          {/* Comms */}
          <div style={s.commsPanel}>
            <div style={s.commsPanelHeader}>
              <span style={s.sectionLabel}>◈ COMMS LOG {sel?`— ${sel.callsign}`:"— ALL TRAFFIC"}</span>
              {sel&&<button style={s.clearFilterBtn} onClick={()=>setSelected(null)}>ALL TRAFFIC</button>}
            </div>
            <div style={s.commsLog} ref={logRef}>
              {filteredLog.map(entry=>{
                const m=family.find(f=>f.id===entry.memberId);
                return(
                  <div key={entry.id} className="log-entry" style={{...s.logEntry,...(entry.type==="atc"?s.logAtc:entry.type==="pilot"?s.logPilot:s.logAuto)}}>
                    <span style={{...s.logPrefix,color:entry.type==="atc"?"#FFD700":entry.type==="pilot"?m?.color:"#00aa44"}}>
                      {entry.type==="atc"?"ANDREA CTR ▸":entry.type==="pilot"?`${m?.callsign} ▸`:"SYS ▸"}
                    </span>
                    <span style={s.logText}>{entry.text}</span>
                    <span style={s.logTime}>{entry.time}</span>
                  </div>
                );
              })}
            </div>
            <div style={s.txSection}>
              <div style={s.targetRow}>
                <span style={s.txLabel}>TX ▸</span>
                {family.map(m=>(
                  <button key={m.id} style={{...s.txBtn,borderColor:m.color,background:target===m.id?m.color:"transparent",color:target===m.id?"#000":m.color}}
                    onClick={()=>setTarget(m.id)}>{m.callsign}</button>
                ))}
              </div>
              <div style={s.txRow}>
                <span style={{...s.txCursor,opacity:blink?1:0}}>▌</span>
                <input style={s.txInput} placeholder={`${family.find(m=>m.id===target)?.callsign}, ...`}
                  value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&transmit()}/>
                <button style={s.txSend} onClick={transmit} disabled={!input.trim()}>TRANSMIT</button>
              </div>
              <div style={s.phraseRow}>
                <span style={s.phraseLabel}>QUICK TX:</span>
                {["Cleared to land.","Say altitude.","Contact ground.","Squawk ident.","Freq change approved."].map(p=>(
                  <button key={p} style={s.phraseBtn} onClick={()=>setInput(p)}>{p}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Status board */}
          <div style={s.statusBoard}>
            <div style={s.sectionLabel}>◈ SECTOR STATUS</div>
            <div style={s.statusGrid}>
              {[[family.filter(m=>m.status==="flying").length,"AIRBORNE","#00FF9C"],[family.filter(m=>m.status==="landed").length,"LANDED","#00C8FF"],[family.filter(m=>m.status==="ground").length,"ON GND","#555"],[family.length,"TOTAL TFC","#FFD700"]].map(([n,label,color])=>(
                <div key={label} style={s.statusCell}>
                  <div style={{...s.statusNum,color}}>{n}</div>
                  <div style={s.statusKey}>{label}</div>
                </div>
              ))}
            </div>
            <div style={s.atisBox}>
              <div style={s.atisLine}><span style={s.atisLabel}>ATIS ▸ </span><span style={s.atisText}>ANDREA FAMILY CTRL. ALL AIRCRAFT FILE FLIGHT PLANS BEFORE DEPARTURE. FAILURE TO CALL ON LANDING WILL RESULT IN IMMEDIATE BOLLOCKING. INFORMATION ALPHA.</span></div>
              <div style={s.atisLine}><span style={s.atisLabel}>DATA ▸ </span><span style={s.atisText}>Live ADS-B via OpenSky Network. Updates every 15s. Coverage: Europe + Atlantic (25°N–72°N, 30°W–45°E).</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const MONO="'Share Tech Mono',monospace", ORBI="'Orbitron',monospace", GREEN="#00FF9C", DIM="#00aa44";
const s={
  root:{minHeight:"100vh",background:"#020802",fontFamily:MONO,color:GREEN,position:"relative",overflow:"hidden",animation:"flicker 8s infinite"},
  scanline:{position:"fixed",inset:0,pointerEvents:"none",zIndex:100,background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.08) 2px,rgba(0,0,0,0.08) 4px)"},
  vignette:{position:"fixed",inset:0,pointerEvents:"none",zIndex:99,background:"radial-gradient(ellipse at center,transparent 60%,rgba(0,0,0,0.7) 100%)"},
  titleBar:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 20px",borderBottom:`1px solid ${DIM}44`,background:"#010601",position:"relative",zIndex:10},
  titleLeft:{display:"flex",flexDirection:"column",gap:2},
  titleMain:{fontFamily:ORBI,fontSize:20,fontWeight:900,color:GREEN,letterSpacing:4},
  titleSub:{fontSize:9,color:DIM,letterSpacing:3},
  titleRight:{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"},
  statusItem:{display:"flex",alignItems:"center",gap:6,fontSize:9,color:DIM,letterSpacing:2},
  dot:{width:6,height:6,borderRadius:"50%",display:"inline-block"},
  clock:{fontFamily:ORBI,fontSize:13,color:GREEN,letterSpacing:2},
  body:{display:"flex",gap:12,padding:"12px 16px",alignItems:"flex-start",flexWrap:"wrap",position:"relative",zIndex:5},
  colLeft:{flex:"1 1 460px",display:"flex",flexDirection:"column",gap:12},
  colRight:{flex:"1 1 360px",display:"flex",flexDirection:"column",gap:12},
  radarWrap:{border:`1px solid ${DIM}55`,borderRadius:4},
  radarLabel:{padding:"6px 12px",fontSize:9,color:DIM,letterSpacing:3,borderBottom:`1px solid ${DIM}33`},
  radarSvg:{display:"block",width:"100%",height:"auto"},
  stripsSection:{border:`1px solid ${DIM}55`,borderRadius:4},
  sectionLabel:{padding:"6px 12px",fontSize:9,color:DIM,letterSpacing:3,borderBottom:`1px solid ${DIM}33`},
  strips:{display:"flex",flexDirection:"column"},
  strip:{borderLeft:"3px solid",padding:"8px 12px",borderBottom:`1px solid ${DIM}22`,cursor:"pointer",textAlign:"left",transition:"background 0.15s",display:"flex",flexDirection:"column",gap:5},
  stripCallsign:{display:"flex",alignItems:"center",gap:8},
  stripCs:{fontFamily:ORBI,fontSize:11,fontWeight:700,letterSpacing:2},
  stripEmoji:{fontSize:14},
  stripStatus:{fontSize:8,border:"1px solid",borderRadius:2,padding:"1px 6px",letterSpacing:2,marginLeft:"auto"},
  liveTag:{fontSize:7,color:"#00FF9C",letterSpacing:2,animation:"blip 1.5s infinite"},
  stripRow:{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"},
  stripField:{fontSize:9,color:DIM,letterSpacing:1},
  stripClearance:{fontSize:9,color:"#aaa",marginLeft:"auto",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:180},
  flightNumBtn:{fontSize:9,background:"transparent",border:`1px solid ${DIM}44`,color:GREEN,padding:"2px 8px",fontFamily:MONO,letterSpacing:1,cursor:"pointer"},
  flightEditRow:{display:"flex",gap:6,alignItems:"center"},
  flightEditInput:{flex:1,background:"#010601",border:`1px solid ${GREEN}`,padding:"3px 8px",color:GREEN,fontSize:10,outline:"none",letterSpacing:1},
  flightEditSave:{background:`${DIM}44`,border:`1px solid ${DIM}`,color:GREEN,fontSize:8,padding:"3px 8px",fontFamily:MONO,letterSpacing:1},
  flightEditCancel:{background:"transparent",border:"1px solid #333",color:"#555",fontSize:8,padding:"3px 6px",fontFamily:MONO},
  liveChip:{fontSize:9,color:GREEN,background:`${DIM}18`,border:`1px solid ${DIM}33`,padding:"1px 7px",letterSpacing:1},
  liveChipKey:{color:DIM,fontSize:8},
  addStrip:{padding:"10px 14px",background:"transparent",border:`1px dashed ${DIM}55`,color:DIM,fontSize:9,letterSpacing:3,cursor:"pointer",textAlign:"center"},
  addForm:{padding:12,borderTop:`1px solid ${DIM}33`,display:"flex",flexDirection:"column",gap:8},
  addRow:{display:"flex",gap:8},
  addInput:{flex:1,background:"#010601",border:`1px solid ${DIM}55`,padding:"6px 10px",color:GREEN,fontSize:11,outline:"none"},
  emojiRow:{display:"flex",gap:6},
  emojiBtn:{fontSize:16,background:"transparent",border:"1px solid",borderRadius:2,padding:"2px 6px",color:GREEN},
  addBtns:{display:"flex",gap:8},
  confirmBtn:{flex:2,background:`${DIM}33`,border:`1px solid ${DIM}`,color:GREEN,fontSize:9,padding:"6px",letterSpacing:2,fontFamily:MONO},
  cancelBtn:{flex:1,background:"transparent",border:"1px solid #333",color:"#555",fontSize:9,padding:"6px",letterSpacing:2,fontFamily:MONO},
  commsPanel:{border:`1px solid ${DIM}55`,borderRadius:4,display:"flex",flexDirection:"column"},
  commsPanelHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${DIM}33`},
  clearFilterBtn:{background:"transparent",border:"none",color:DIM,fontSize:8,letterSpacing:2,padding:"6px 12px",cursor:"pointer",textDecoration:"underline"},
  commsLog:{height:260,overflowY:"auto",padding:"8px 12px",display:"flex",flexDirection:"column",gap:6,background:"#010601"},
  logEntry:{display:"flex",flexWrap:"wrap",gap:"4px 8px",fontSize:11,lineHeight:1.5,paddingBottom:4,borderBottom:`1px solid ${DIM}11`},
  logAtc:{},logPilot:{opacity:0.8},logAuto:{opacity:0.55},
  logPrefix:{fontWeight:"bold",whiteSpace:"nowrap",fontSize:9,letterSpacing:1},
  logText:{flex:1,color:"#cce8cc"},
  logTime:{fontSize:8,color:"#335533",whiteSpace:"nowrap",marginLeft:"auto"},
  txSection:{padding:"10px 12px",borderTop:`1px solid ${DIM}33`,display:"flex",flexDirection:"column",gap:8},
  targetRow:{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"},
  txLabel:{fontSize:9,color:DIM,letterSpacing:2},
  txBtn:{fontSize:8,border:"1px solid",padding:"2px 8px",letterSpacing:1,fontFamily:MONO,transition:"all 0.1s"},
  txRow:{display:"flex",alignItems:"center",gap:8},
  txCursor:{color:GREEN,fontSize:16,lineHeight:1,width:8,flexShrink:0},
  txInput:{flex:1,background:"#010601",border:`1px solid ${DIM}88`,padding:"7px 10px",color:GREEN,fontSize:11,outline:"none"},
  txSend:{background:`${DIM}33`,border:`1px solid ${DIM}`,color:GREEN,fontSize:9,padding:"7px 14px",letterSpacing:2,fontFamily:MONO},
  phraseRow:{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"},
  phraseLabel:{fontSize:8,color:"#335533",letterSpacing:1},
  phraseBtn:{fontSize:8,background:"transparent",border:`1px solid ${DIM}33`,color:DIM,padding:"2px 7px",fontFamily:MONO,letterSpacing:0.5},
  statusBoard:{border:`1px solid ${DIM}55`,borderRadius:4,background:"#010601"},
  statusGrid:{display:"flex",borderBottom:`1px solid ${DIM}22`},
  statusCell:{flex:1,padding:"10px 8px",textAlign:"center",borderRight:`1px solid ${DIM}22`},
  statusNum:{fontFamily:ORBI,fontSize:24,fontWeight:900,color:GREEN},
  statusKey:{fontSize:7,color:"#335533",letterSpacing:2,marginTop:2},
  atisBox:{padding:"10px 12px",display:"flex",flexDirection:"column",gap:6},
  atisLine:{display:"flex",gap:6,alignItems:"flex-start"},
  atisLabel:{fontSize:8,color:"#FFD700",letterSpacing:2,whiteSpace:"nowrap",marginTop:1},
  atisText:{fontSize:8,color:DIM,letterSpacing:0.5,lineHeight:1.6},
};
