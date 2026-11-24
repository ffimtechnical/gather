import { Check, Loader2, Mic, RotateCcw, Send, Sparkles, Square, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { aiStatus, answerConfirm, getChat, resetChat, sendMessage, speak, subscribeChat, transcribe, type AiStatus, type ChatMessage } from '../assistant';
import { ICON } from '../icons';
import { useUI } from '../ui';

const SUGGESTIONS_LEAD = ['Who needs a visit this week?', 'How is each zone doing?', 'Assign the due houses in my zone', 'Log a visit'];
const SUGGESTIONS = ['What are my tasks today?', 'Log a visit', 'Who is due near me?', 'How far is my next house from church?'];

type SR = { start(): void; stop(): void; onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null; onend: (() => void) | null; lang: string; interimResults: boolean };

export function Assistant() {
  const ui = useUI();
  const chat = useSyncExternalStore(subscribeChat, getChat);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [text, setText] = useState('');
  const [talk, setTalk] = useState(() => localStorage.getItem('ffim.talk') === '1');
  const [rec, setRec] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<SR | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const spoken = useRef(chat.messages.length);
  const ctx = { d: ui.data, me: ui.me, showHouse: ui.showHouse, flyTo: ui.flyTo };

  useEffect(() => void aiStatus().then(setStatus), []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.messages.length, chat.pending.length, chat.busy]);
  useEffect(() => {
    localStorage.setItem('ffim.talk', talk ? '1' : '0');
  }, [talk]);
  // Read new answers aloud
  useEffect(() => {
    const fresh = chat.messages.slice(spoken.current);
    spoken.current = chat.messages.length;
    if (!talk) return;
    const last = [...fresh].reverse().find((m) => m.role === 'assistant' && m.content);
    if (last) speak(last.content);
  }, [chat.messages, talk]);

  const send = (t: string) => {
    setText('');
    void sendMessage(t, ctx);
  };

  async function toggleMic() {
    if (rec === 'recording') {
      recorder.current?.stop();
      recognition.current?.stop();
      return;
    }
    // Best: Whisper on the server. Fallback: the phone's own speech recognition.
    if (status?.voice && navigator.mediaDevices?.getUserMedia && 'MediaRecorder' in window) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t));
        const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
        const chunks: Blob[] = [];
        r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        r.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          setRec('transcribing');
          try {
            const said = await transcribe(new Blob(chunks, { type: r.mimeType }));
            if (said) send(said);
            else ui.toast('Didn’t catch that. Try again.');
          } catch (e) {
            ui.toast((e as Error).message);
          } finally {
            setRec('idle');
          }
        };
        r.start();
        recorder.current = r;
        setRec('recording');
        setTimeout(() => r.state === 'recording' && r.stop(), 90_000);
      } catch {
        ui.toast('Allow microphone access to talk to Gather');
      }
      return;
    }
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
    if (!Ctor) return ui.toast('Voice isn’t available on this phone yet');
    const r = new Ctor();
    r.lang = 'en-GB';
    r.interimResults = false;
    let said = '';
    r.onresult = (e) => (said = Array.from(e.results).map((x) => x[0].transcript).join(' '));
    r.onend = () => {
      setRec('idle');
      if (said) send(said);
    };
    recognition.current = r;
    r.start();
    setRec('recording');
  }

  const visible = chat.messages.filter((m): m is ChatMessage & { role: 'user' | 'assistant' } => (m.role === 'user' || m.role === 'assistant') && Boolean(m.content));
  const suggestions = ui.data.perms.isLead ? SUGGESTIONS_LEAD : SUGGESTIONS;

  return (
    <div className="page assistant">
      <header className="page-head">
        <h1>Ask Gather</h1>
        <span className="grow" />
        <button className="icon-btn" onClick={() => setTalk(!talk)} aria-label={talk ? 'Stop reading answers aloud' : 'Read answers aloud'} aria-pressed={talk}>
          {talk ? <Volume2 {...ICON} /> : <VolumeX {...ICON} />}
        </button>
        {chat.messages.length > 0 && (
          <button className="icon-btn" onClick={() => resetChat()} aria-label="New chat">
            <RotateCcw {...ICON} />
          </button>
        )}
      </header>

      {status && !status.chat ? (
        <div className="ai-off">
          <Sparkles size={32} strokeWidth={1.5} />
          <p>The assistant isn’t switched on yet.</p>
          <p className="muted small">{ui.data.perms.isAdmin ? 'Add a free GROQ_API_KEY (and optionally GEMINI_API_KEY or OPENROUTER_API_KEY) in your Vercel settings. docs/SETUP.md explains how.' : 'Ask your admin to switch it on.'}</p>
        </div>
      ) : (
        <>
          <div className="chat">
            {visible.length === 0 && !chat.busy && (
              <div className="chat-empty">
                <Sparkles size={30} strokeWidth={1.5} />
                <p>Ask anything about your houses, people and visits, or tell me what happened at a house and I’ll log it.</p>
                <div className="chips">
                  {suggestions.map((s) => (
                    <button key={s} className="chip" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {visible.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
            {chat.pending.map((p) => (
              <div key={p.callId} className="confirm-card">
                <b>{p.title}</b>
                <ul>
                  {p.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
                <div className="row gap">
                  <button className="btn ghost" disabled={chat.busy} onClick={() => void answerConfirm(p.callId, false, ctx)}>
                    <X size={16} /> Cancel
                  </button>
                  <button className="btn primary grow-btn" disabled={chat.busy} onClick={() => void answerConfirm(p.callId, true, ctx)}>
                    <Check size={16} /> Confirm
                  </button>
                </div>
              </div>
            ))}
            {chat.busy && (
              <div className="bubble assistant typing">
                <Loader2 size={16} className="spin" />
              </div>
            )}
            {chat.error && <p className="sr-note error">{chat.error}</p>}
            <div ref={endRef} />
          </div>

          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <button type="button" className={`icon-btn mic ${rec}`} onClick={() => void toggleMic()} disabled={rec === 'transcribing'} aria-label={rec === 'recording' ? 'Stop recording' : 'Speak'}>
              {rec === 'recording' ? <Square size={18} /> : rec === 'transcribing' ? <Loader2 size={18} className="spin" /> : <Mic {...ICON} />}
            </button>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={rec === 'recording' ? 'Listening… tap to stop' : 'Type or tap the mic'} aria-label="Message" />
            <button className="icon-btn solid" disabled={!text.trim() || chat.busy} aria-label="Send">
              <Send size={18} />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
