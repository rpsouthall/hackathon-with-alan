"use client";

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronLeft, Coffee, HelpCircle, Languages, LoaderCircle, Mic, MicOff, RotateCcw, Send, Sparkles, Volume2, X } from 'lucide-react';
import { lessonClientId } from '@/lib/lesson/client-id';
import { scenarioForNpc } from '@/lib/lesson/scenarios';
import { lessonCharacterForWorldNpc, scenarioForCharacter } from '@/lib/lesson/characters';
import { environmentForNpc } from '@/lib/game/environments';
import { LessonEngine, gradeChoice } from '@/lib/lesson/engine';
import type { LessonEvent, LessonSnapshot, NativeLanguage, Turn } from '@/lib/lesson/types';
import { startMicCapture, type MicCapture } from '@/lib/lesson/mic-capture';
import type { joinAvatarRoom } from '@/lib/lesson/avatar-room';

type AvatarRoom = Awaited<ReturnType<typeof joinAvatarRoom>>;
type Capabilities = { aiFeedback: boolean; liveAvatar: boolean; missing: string[] };
const kindLabels = { roleplay: 'Your turn to speak', meaning: 'Check your understanding', politeness: 'Choose a polite reply', fill: 'Complete the phrase' };

export function LessonDialogue({ npcId, worldNpcId, onClose, allowLive = true }: { npcId: string; worldNpcId?: string; onClose: () => void; allowLive?: boolean }) {
  const character = worldNpcId ? lessonCharacterForWorldNpc(worldNpcId) : undefined;
  const scenario = character ? scenarioForCharacter(character) : scenarioForNpc(npcId);
  const environment = environmentForNpc(npcId);
  const preview = useRef(new LessonEngine(scenario));
  const [lesson, setLesson] = useState<LessonSnapshot>(() => new LessonEngine(scenario).state);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [connected, setConnected] = useState(false);
  const [language, setLanguage] = useState<NativeLanguage>('English');
  const [answer, setAnswer] = useState('');
  const [hint, setHint] = useState(false);
  const [translations, setTranslations] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [live, setLive] = useState<'off' | 'starting' | 'ready'>('off');
  const [muted, setMuted] = useState(false);
  const [micStatus, setMicStatus] = useState<'off' | 'starting' | 'on'>('off');
  const [micError, setMicError] = useState('');
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [reconnect, setReconnect] = useState(0);
  const socket = useRef<WebSocket | null>(null);
  const mic = useRef<MicCapture | null>(null);
  const microphoneSetup = useRef<AbortController | null>(null);
  const avatarSetup = useRef<AbortController | null>(null);
  const startupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveState = useRef<'off' | 'starting' | 'ready'>('off');
  const autoStarted = useRef(false);
  const room = useRef<AvatarRoom | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const generation = useRef(0);
  const mediaVersion = useRef(0);
  const initialLanguage = useRef(language);
  const dialog = useRef<HTMLElement>(null);
  const question = scenario.questions[lesson.index];
  const latest = turns.slice(-6);

  useEffect(() => {
    const previousFocus = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);

  function send(event: object) {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(event));
  }
  function releaseMedia() {
    mediaVersion.current++;
    if (startupTimer.current) clearTimeout(startupTimer.current);
    startupTimer.current = null;
    avatarSetup.current?.abort(); avatarSetup.current = null;
    microphoneSetup.current?.abort(); microphoneSetup.current = null;
    mic.current?.stop(); mic.current = null; setMicStatus('off');
    void room.current?.disconnect(); room.current = null;
  }
  function stopAvatar() {
    send({ type: 'stop-live' }); releaseMedia();
    liveState.current = 'off'; setLive('off'); setHasVideo(false); setMuted(false);
  }

  useEffect(() => {
    const epoch = ++generation.current;
    autoStarted.current = false;
    // Fetch the video client while provider sessions open, rather than adding
    // its download and compilation to the eventual room-connection delay.
    void import('@/lib/lesson/avatar-room').catch(() => {});
    const controller = new AbortController();
    const current = () => generation.current === epoch;
    void fetch('/lesson-api/config', { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('Lesson service unavailable');
      return response.json() as Promise<Capabilities>;
    }).then(value => { if (current()) setCapabilities(value); }).catch(() => {
      if (current()) setError('The lesson service is offline. You can explore the questions and choice quizzes.');
    });
    // The Cloudflare/Vinext dev server also owns upgrade handlers. Bypass
    // that competing upgrade path for our loopback-only companion.
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const ws = new WebSocket(local ? 'ws://127.0.0.1:8790/lesson-api/session' : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/lesson-api/session`);
    socket.current = ws;
    ws.onopen = () => {
      setConnected(false);
      ws.send(JSON.stringify({ type: 'start', scenarioId: scenario.id, language: initialLanguage.current, clientId: lessonClientId(), characterId: worldNpcId }));
    };
    ws.onmessage = message => {
      if (!current()) return;
      const event = JSON.parse(message.data) as LessonEvent;
      if (event.type === 'connected') { setConnected(true); setLesson(event.lesson); setError(''); }
      if (event.type === 'lesson') { setLesson(event.lesson); setChecking(false); }
      if (event.type === 'checking') setChecking(true);
      if (event.type === 'error') { setError(event.message); setChecking(false); }
      if (event.type === 'turn') setTurns(previous => {
        const found = previous.some(turn => turn.id === event.turn.id);
        return (found ? previous.map(turn => turn.id === event.turn.id ? event.turn : turn) : [...previous, event.turn]).slice(-30);
      });
      if (event.type === 'live-starting') { liveState.current = 'starting'; setLive('starting'); }
      if (event.type === 'ready') {
        if (startupTimer.current) clearTimeout(startupTimer.current);
        startupTimer.current = null;
        liveState.current = 'ready'; setLive('ready'); mic.current?.setMuted(false); setMuted(false);
      }
      if (event.type === 'ended') { releaseMedia(); liveState.current = 'off'; setLive('off'); setHasVideo(false); }
      if (event.type === 'avatar') {
        const version = mediaVersion.current;
        const setup = avatarSetup.current;
        if (!setup || setup.signal.aborted || liveState.current === 'off') return;
        void import('@/lib/lesson/avatar-room').then(({ joinAvatarRoom }) => {
          if (!current() || setup.signal.aborted || version !== mediaVersion.current || !video.current || !audio.current) return null;
          return joinAvatarRoom(event.url, event.token, video.current, audio.current,
            () => { if (current() && version === mediaVersion.current) setHasVideo(true); },
            () => { if (current() && version === mediaVersion.current) { setError('The avatar video disconnected. Start it again to continue speaking.'); send({ type: 'stop-live' }); releaseMedia(); liveState.current = 'off'; setLive('off'); setHasVideo(false); } }, setup.signal, () => { if (current() && version === mediaVersion.current) setAudioBlocked(true); });
        }).then(value => {
          if (!value) return;
          if (!current() || version !== mediaVersion.current || setup.signal.aborted) { void value.disconnect(); return; }
          room.current = value; ws.send(JSON.stringify({ type: 'avatar-ready' }));
        }).catch(() => {
          if (current() && version === mediaVersion.current && !setup.signal.aborted) { setError('The avatar video could not connect. Please try again.'); send({ type: 'stop-live' }); releaseMedia(); liveState.current = 'off'; setLive('off'); setHasVideo(false); }
        });
      }
    };
    ws.onclose = () => {
      if (!current()) return;
      liveState.current = 'off'; setConnected(false); setChecking(false); setLive('off'); setHasVideo(false); releaseMedia();
      setError('The lesson connection ended. Reconnect to start a new lesson.');
    };
    ws.onerror = () => { if (current()) setError('The lesson service could not connect.'); };
    return () => {
      generation.current = epoch + 1; liveState.current = 'off'; controller.abort(); releaseMedia(); socket.current = null;
      ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = () => {};
      if (ws.readyState === WebSocket.CONNECTING) ws.addEventListener('open', () => ws.close(), { once: true }); else ws.close();
    };
  }, [scenario.id, worldNpcId, reconnect]);

  async function enableMicrophone() {
    if (microphoneSetup.current || mic.current || liveState.current === 'off') return;
    const epoch = generation.current, version = mediaVersion.current;
    const controller = new AbortController(); microphoneSetup.current = controller;
    setMicError(''); setMicStatus('starting');
    try {
      const capture = await startMicCapture(chunk => {
        if (socket.current?.readyState === WebSocket.OPEN && socket.current.bufferedAmount < 128000) send({ type: 'audio', audio: chunk });
      }, undefined, controller.signal);
      if (epoch !== generation.current || version !== mediaVersion.current || controller.signal.aborted) { capture.stop(); return; }
      capture.setMuted(liveState.current !== 'ready'); mic.current = capture;
      setMicStatus('on'); setMuted(false);
      void room.current?.enableAudio().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
    } catch (cause) {
      if (epoch === generation.current && version === mediaVersion.current && !controller.signal.aborted) {
        setMicStatus('off');
        setMicError(cause instanceof Error ? cause.message : 'Enable your microphone to speak, or continue in the chat.');
      }
    } finally { if (microphoneSetup.current === controller) microphoneSetup.current = null; }
  }

  function startAvatar() {
    if (!connected || socket.current?.readyState !== WebSocket.OPEN || !capabilities?.liveAvatar || !allowLive || lesson.completed || liveState.current !== 'off') return;
    releaseMedia();
    liveState.current = 'starting'; setLive('starting'); setError(''); setHasVideo(false); setTurns([]); setAudioBlocked(false);
    avatarSetup.current = new AbortController();
    const version = mediaVersion.current;
    startupTimer.current = setTimeout(() => {
      if (version !== mediaVersion.current || liveState.current !== 'starting') return;
      stopAvatar(); setError('The avatar could not finish connecting. Retry the avatar to start a fresh session.');
    }, 90000);
    // Video connects independently: a pending microphone permission must never
    // leave the learner looking at a placeholder instead of their tutor.
    send({ type: 'live' });
    void enableMicrophone();
  }
  const beginEncounter = useEffectEvent(startAvatar);
  useEffect(() => {
    if (!connected || socket.current?.readyState !== WebSocket.OPEN || !capabilities?.liveAvatar || !allowLive || autoStarted.current) return;
    autoStarted.current = true;
    beginEncounter();
  }, [connected, capabilities?.liveAvatar, allowLive]);

  function submit(choice?: number) {
    setError('');
    if (connected) { setChecking(true); send({ type: 'answer', questionId: question.id, answer: choice === undefined ? answer : undefined, choice }); }
    else if (choice !== undefined) {
      const ticket = preview.current.begin(question.id);
      preview.current.finish(ticket, gradeChoice(question, choice)); setLesson({ ...preview.current.state });
    }
  }
  function progress(action: 'next' | 'retry') {
    setAnswer(''); setHint(false); setError('');
    if (connected) send({ type: action, questionId: question.id });
    else { preview.current[action](question.id); setLesson({ ...preview.current.state }); }
  }
  function restart() {
    autoStarted.current = false; stopAvatar(); preview.current = new LessonEngine(scenario); setLesson(preview.current.state);
    setConnected(false); setAnswer(''); setHint(false); setTurns([]); setChecking(false); setReconnect(value => value + 1);
  }

  return <section ref={dialog} className="lesson-overlay lesson-with-environment" role="dialog" aria-modal="true" aria-label={`${scenario.title} Japanese lesson`} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href]')).filter(element => element.offsetParent !== null);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="lesson-environment" style={{ backgroundImage: `url('${environment.image}')` }} aria-hidden="true" />
    <header className="lesson-header">
      <button className="lesson-back" onClick={onClose}><ChevronLeft size={18} /> Back to Kyoto</button>
      <div className="lesson-location"><Coffee size={16} /><span>{scenario.location}</span></div>
      <button className="lesson-icon-button" onClick={onClose} aria-label="Close lesson"><X size={20} /></button>
    </header>
    <div className="lesson-body">
      <aside className="lesson-avatar-column">
        <div className="lesson-avatar-stage" style={{ backgroundImage: `url('${character?.preview ?? environment.image}')` }}>
          <video ref={video} autoPlay playsInline muted aria-hidden={!hasVideo} className={hasVideo ? 'is-visible' : ''} aria-label={`${scenario.name} live HeyGen avatar`} />
          <audio ref={audio} autoPlay />
          {!hasVideo && <div className="lesson-avatar-placeholder">
            <div className="lesson-avatar-orbit"><span lang="ja">話</span></div>
            <span className="lesson-kicker">YOUR JAPANESE CONVERSATION PARTNER</span>
            <h1>{scenario.name}</h1>
            <p>{live === 'starting' ? 'Bringing your avatar into the conversation…' : 'A little practice. A real conversation.'}</p>
            <span className="lesson-avatar-tag">{live === 'starting' ? 'Connecting HeyGen' : 'Live avatar not connected'}</span>
          </div>}
          <div className="lesson-avatar-caption"><span className={live === 'ready' ? 'lesson-dot active' : 'lesson-dot'} />{live === 'ready' ? `${scenario.name} · Japanese tutor` : 'HeyGen LiveAvatar + GPT-Live'}</div>
        </div>
        <div className="lesson-voice-controls">
          {live === 'off' ? <button className="lesson-primary" onClick={startAvatar} disabled={!connected || !capabilities?.liveAvatar || !allowLive || lesson.completed}><RotateCcw size={18} /> Retry live avatar</button> : <>
            {micStatus === 'on' ? <button className="lesson-primary" onClick={() => { const next = !muted; setMuted(next); mic.current?.setMuted(next); }} disabled={live !== 'ready'}>{muted ? <MicOff size={18} /> : <Mic size={18} />}{live === 'starting' ? 'Connecting tutor…' : muted ? 'Unmute microphone' : 'Microphone on'}</button> : <button className="lesson-primary" onClick={() => void enableMicrophone()} disabled={micStatus === 'starting'}>{micStatus === 'starting' ? <LoaderCircle className="lesson-spin" size={18} /> : <Mic size={18} />}{micStatus === 'starting' ? 'Preparing microphone…' : 'Enable microphone'}</button>}
            <button className="lesson-secondary" onClick={stopAvatar}>Stop avatar</button>
          </>}
          {hasVideo && audioBlocked && <button className="lesson-secondary" onClick={() => { void room.current?.enableAudio().then(() => setAudioBlocked(false)).catch(() => setMicError('Click Enable sound again to allow browser audio.')); }}><Volume2 size={18} /> Enable sound</button>}
        </div>
        {micError && <p className="lesson-service-note" role="status">{micError} You can still type in the chat.</p>}
        <p className="lesson-service-note">{capabilities?.liveAvatar ? 'Your avatar and chat are private to you. Speak English or try Japanese; your tutor replies in Japanese.' : capabilities ? 'The live avatar is unavailable. You can continue practising in the chat.' : 'Connecting to your lesson service…'}</p>
        <label className="lesson-language"><Languages size={16} /> I speak <select aria-label="Your native language" value={language} disabled={live !== 'off'} onChange={event => { const value = event.target.value as NativeLanguage; setLanguage(value); initialLanguage.current = value; send({ type: 'language', language: value }); }}><option>English</option><option>Mandarin Chinese</option><option>Spanish</option><option>Japanese</option></select></label>
      </aside>

      <div className="lesson-content-column">
        <div className="lesson-title-row"><div><span className="lesson-kicker">GUIDED SCENARIO · BEGINNER</span><h2>{scenario.title}</h2></div><span className="lesson-count">{lesson.completed ? '10' : String(lesson.index + 1).padStart(2, '0')}<small> / 10</small></span></div>
        <div className="lesson-progress" aria-label={`${lesson.reviewed} of 10 questions reviewed`}>{scenario.questions.map((item, index) => <span key={item.id} className={index < lesson.reviewed ? 'done' : index === lesson.index && !lesson.completed ? 'current' : ''} />)}</div>
        {error && <div className="lesson-error" role="alert">{error}{!connected && <button onClick={restart}>Reconnect</button>}<button onClick={() => setError('')} aria-label="Dismiss message"><X size={14} /></button></div>}

        {lesson.completed ? <div className="lesson-complete">
          <span className="lesson-complete-mark"><Check size={32} /></span><span className="lesson-kicker">よくできました</span><h3>One conversation further.</h3><p>You reviewed all ten questions with {scenario.name}. Take these phrases into your next conversation.</p><div className="lesson-review-list">{scenario.questions.map(item => <div key={item.id}><span lang="ja">{item.modelAnswer}</span><small>{item.answerMeaning}</small></div>)}</div><button className="lesson-primary" onClick={onClose}>Explore another scenario <ArrowRight size={18} /></button><button className="lesson-text-button" onClick={restart}><RotateCcw size={15} /> Practise again</button>
        </div> : <>
          <article className="lesson-question">
            <div className="lesson-question-meta"><span>{scenario.name} says</span><button className="lesson-text-button" onClick={() => setTranslations(value => !value)}>{translations ? 'Hide translation' : 'Show translation'}</button></div>
            <h3 lang="ja">{question.japanese}</h3>
            {translations && <p>{question.meaning}</p>}
          </article>
          <div className="lesson-task"><span className="lesson-kicker">{kindLabels[question.kind]}</span><h3>{question.task}</h3></div>
          {question.options ? <div className="lesson-options">{question.options.map((option, index) => <button key={option} disabled={checking || !!lesson.feedback} onClick={() => submit(index)} className={lesson.feedback?.answer === option ? 'selected' : ''}><span>{String.fromCharCode(65 + index)}</span>{option}{lesson.feedback?.answer === option && <Check size={16} />}</button>)}</div> : <form className="lesson-answer" onSubmit={event => { event.preventDefault(); submit(); }}>
            <label htmlFor="lesson-answer">{live === 'ready' ? 'Speak to the avatar, or type your answer' : `Answer in ${language} or Japanese`}</label>
            <div><input id="lesson-answer" value={answer} onChange={event => setAnswer(event.target.value)} maxLength={1500} autoComplete="off" placeholder="Type your reply here…" disabled={checking} /><button className="lesson-primary" disabled={!connected || !capabilities?.aiFeedback || !answer.trim() || checking} aria-label="Check answer"><Send size={18} /></button></div>
            {!connected && <small>Connect the lesson service to receive feedback on your own answer.</small>}
          </form>}
          {checking && <p className="lesson-checking" role="status"><LoaderCircle className="lesson-spin" size={16} /> Checking your answer…</p>}
          {lesson.feedback && <article className={`lesson-feedback ${lesson.feedback.verdict}`} aria-live="polite">
            <div className="lesson-feedback-heading"><Sparkles size={16} /><strong>{lesson.feedback.verdict === 'correct' ? 'You’ve got it' : lesson.feedback.verdict === 'improve' ? 'A small refinement' : 'Let’s try that together'}</strong></div>
            <p>{lesson.feedback.explanation}</p><small>YOU SAID</small><blockquote>{lesson.feedback.answer}</blockquote><small>A NATURAL WAY TO SAY IT</small><h4 lang="ja">{lesson.feedback.japanese}</h4><p className="lesson-reading">{lesson.feedback.reading}</p><p>{lesson.feedback.meaning}</p>
            <div className="lesson-feedback-actions"><button className="lesson-secondary" disabled={checking} onClick={() => progress('retry')}><RotateCcw size={15} /> Try again</button><button className="lesson-primary" disabled={checking} onClick={() => progress('next')}>{lesson.index === 9 ? 'Finish lesson' : 'Next question'}<ArrowRight size={17} /></button></div>
          </article>}
          <button className="lesson-text-button lesson-hint-toggle" onClick={() => setHint(value => !value)}><HelpCircle size={16} />{hint ? 'Hide example' : 'Need a little help?'}</button>
          {hint && <div className="lesson-hint"><p lang="ja">{question.modelAnswer}</p><span>{question.reading}</span><p>{question.answerMeaning}</p><small>{question.tip}</small></div>}
          <section className="lesson-transcript" aria-label="Conversation chat">
            <h3>Conversation</h3>
            <div aria-live="polite">{latest.length ? latest.map(turn => <p key={turn.id}><strong>{turn.role === 'user' ? 'You' : scenario.name}</strong><span>{turn.text}{!turn.done && ' …'}</span></p>) : <p>{live === 'starting' ? 'Your tutor is joining. You can type an answer while the video connects.' : 'Your messages and your tutor’s replies appear here.'}</p>}</div>
            <small>Speech recognition can contain errors. Feedback assesses words, not pronunciation.</small>
          </section>
        </>}
      </div>
    </div>
  </section>;
}
