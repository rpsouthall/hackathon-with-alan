"use client";
import { useState } from 'react';
import Link from 'next/link';
import { LessonDialogue } from '@/components/lesson/lesson-dialogue';
import { scenarios } from '@/lib/lesson/scenarios';

export default function LessonLab() {
  const [npc, setNpc] = useState<string | null>(null);
  return <main className="lesson-lab">
    <Link href="/" className="lesson-back">← Back to Kyoto</Link>
    <span className="lesson-kicker">KYOTO CONVERSATIONS</span><h1>Your next conversation<br />starts here.</h1><p>Three everyday places. Ten small steps.<br />Speak English, discover Japanese, and learn as you go.</p>
    <div className="lesson-scenario-grid">{scenarios.map((scenario, index) => <button key={scenario.id} onClick={() => setNpc(scenario.npcId)}><span className="lesson-scenario-number">0{index + 1}</span><small>{scenario.location}</small><h2>{scenario.title}</h2><p>{scenario.description}</p><span>Practise with {scenario.name} →</span></button>)}</div>
    {npc && <LessonDialogue key={npc} npcId={npc} onClose={() => setNpc(null)} />}
  </main>;
}
