"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Native navigation avoids the deployed Vinext client-router failure. */

import { useState } from 'react';
import Image from 'next/image';
import { ArrowLeft, ArrowUpRight, MapPin } from 'lucide-react';
import { conversationEnvironments } from '@/lib/game/environments';
import { lessonCharacterForWorldNpc } from '@/lib/lesson/characters';

export function EnvironmentGallery() {
  const [selected, setSelected] = useState(0);
  const scene = conversationEnvironments[selected];
  const tutor = scene.worldNpcId ? lessonCharacterForWorldNpc(scene.worldNpcId) : undefined;

  return <main className="environment-gallery" aria-label="Conversation settings">
    <div key={scene.id} className="environment-image" style={{ backgroundImage: `url('${scene.image}')` }} aria-hidden="true" />
    <div className="environment-shade" aria-hidden="true" />
    <header className="environment-header">
      <a href="/" className="environment-back"><ArrowLeft size={16} /> Back to Kyoto</a>
      <span className="environment-wordmark">京都 <span>Places to practise</span></span>
      <span className="environment-preview-label">Choose your conversation</span>
    </header>
    <div className="environment-story" aria-live="polite" aria-atomic="true">
      <div className="environment-eyebrow"><MapPin size={14} /> KYOTO, JAPAN <span>0{selected + 1} / 03</span></div>
      <span className="environment-japanese" lang="ja">{scene.japanese}</span>
      <h1>{scene.title}</h1>
      <p>{scene.description}</p>
    </div>
    <aside className="environment-practice" aria-label="Practice in this setting">
      <span className="environment-eyebrow">THE CONVERSATION</span>
      {tutor && <Image className="environment-host-portrait" src={tutor.preview} alt={`${tutor.name}'s HeyGen avatar`} width={224} height={160} unoptimized />}
      <h2>Meet {tutor?.name ?? scene.host}</h2>
      <p>{tutor?.role ?? scene.category} · Japanese conversation</p>
      <ol>{scene.practice.map((item, index) => <li key={item}><span>0{index + 1}</span>{item}</li>)}</ol>
      {tutor && <a className="environment-enter" href={`/?tutor=${encodeURIComponent(tutor.id)}`}>Find {tutor.name} in Kyoto <ArrowUpRight size={18} /></a>}
    </aside>
    <nav className="environment-choices" aria-label="Choose a setting">
      {conversationEnvironments.map((environment, index) => <button key={environment.id} onClick={() => setSelected(index)} aria-pressed={selected === index} className="environment-choice">
        <span className="environment-thumbnail" style={{ backgroundImage: `url('${environment.image}')` }} aria-hidden="true" />
        <span><small>0{index + 1}</small><strong>{environment.category}</strong></span><ArrowUpRight size={18} />
      </button>)}
    </nav>
  </main>;
}
