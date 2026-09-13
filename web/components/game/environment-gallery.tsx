"use client";

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, MapPin } from 'lucide-react';
import { conversationEnvironments } from '@/lib/game/environments';

export function EnvironmentGallery() {
  const [selected, setSelected] = useState(0);
  const scene = conversationEnvironments[selected];

  return <main className="environment-gallery" aria-label="Conversation settings">
    <div key={scene.id} className="environment-image" style={{ backgroundImage: `url('${scene.image}')` }} aria-hidden="true" />
    <div className="environment-shade" aria-hidden="true" />
    <header className="environment-header">
      <Link href="/" className="environment-back"><ArrowLeft size={16} /> Back to Kyoto</Link>
      <span className="environment-wordmark">京都 <span>Places to practise</span></span>
      <span className="environment-preview-label">Environment preview</span>
    </header>
    <div className="environment-story" aria-live="polite" aria-atomic="true">
      <div className="environment-eyebrow"><MapPin size={14} /> KYOTO, JAPAN <span>0{selected + 1} / 03</span></div>
      <span className="environment-japanese" lang="ja">{scene.japanese}</span>
      <h1>{scene.title}</h1>
      <p>{scene.description}</p>
    </div>
    <aside className="environment-practice" aria-label="Practice in this setting">
      <span className="environment-eyebrow">THE CONVERSATION</span>
      <h2>Meet {scene.host}</h2>
      <p>Small moments. Real-world Japanese.</p>
      <ol>{scene.practice.map((item, index) => <li key={item}><span>0{index + 1}</span>{item}</li>)}</ol>
      <span className="environment-note">A setting for your avatar conversation</span>
    </aside>
    <nav className="environment-choices" aria-label="Choose a setting">
      {conversationEnvironments.map((environment, index) => <button key={environment.id} onClick={() => setSelected(index)} aria-pressed={selected === index} className="environment-choice">
        <span className="environment-thumbnail" style={{ backgroundImage: `url('${environment.image}')` }} aria-hidden="true" />
        <span><small>0{index + 1}</small><strong>{environment.category}</strong></span><ArrowUpRight size={18} />
      </button>)}
    </nav>
  </main>;
}
