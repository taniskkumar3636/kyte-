import React, { useState, useEffect, useRef } from 'react';
import { 
  Radio, 
  Send, 
  UserCheck, 
  UserPlus, 
  AtSign, 
  ArrowLeft, 
  MessageSquare, 
  Search, 
  CheckCheck, 
  Activity, 
  Zap,
  Info
} from 'lucide-react';

import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  addDoc, 
  onSnapshot 
} from 'firebase/firestore';

// --- Firebase Configuration ---
const firebaseConfig = typeof __firebase_config !== 'undefined' 
  ? JSON.parse(__firebase_config) 
  : { apiKey: "demo", authDomain: "demo.firebaseapp.com", projectId: "demo-app" };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'ultra-low-bandwidth-chat';

// --- 1-Byte Dictionary Compression ---
const DICTIONARY = [
  { phrase: "how are you", token: "\x80" },
  { phrase: "good morning", token: "\x81" },
  { phrase: "good night", token: "\x82" },
  { phrase: "on my way", token: "\x83" },
  { phrase: "call me", token: "\x84" },
  { phrase: "see you", token: "\x85" },
  { phrase: "where are you", token: "\x86" },
  { phrase: "i am fine", token: "\x87" },
  { phrase: "thank you", token: "\x88" },
  { phrase: "thanks", token: "\x89" },
  { phrase: "hello", token: "\x8A" },
  { phrase: "urgent", token: "\x8B" },
  { phrase: "location", token: "\x8C" },
  { phrase: "please", token: "\x8D" },
  { phrase: "sorry", token: "\x8E" },
  { phrase: "yes", token: "\x90" },
  { phrase: "no", token: "\x91" },
  { phrase: "ok", token: "\x92" },
  { phrase: "bye", token: "\x93" },
];

function compressText(text) {
  let lower = text.toLowerCase();
  DICTIONARY.forEach(({ phrase, token }) => {
    if (lower.includes(phrase)) {
      lower = lower.replace(new RegExp(phrase, 'gi'), token);
    }
  });
  return { compressed: lower, bytes: lower.length };
}

function decompressText(compressedStr) {
  let text = compressedStr;
  DICTIONARY.forEach(({ phrase, token }) => {
    text = text.replaceAll(token, phrase);
  });
  return text;
}

// Generate deterministic Chat ID between two handles (e.g. "alex" + "bob" -> "alex_bob")
function getChatRoomId(handle1, handle2) {
  return [handle1.toLowerCase(), handle2.toLowerCase()].sort().join('_');
}

export default function App() {
  const [user, setUser] = useState(null);
  const [myHandle, setMyHandle] = useState(() => localStorage.getItem('pulse_handle') || '');
  const [inputHandle, setInputHandle] = useState('');
  const [handleError, setHandleError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  // Direct Messaging State
  const [activeRecipient, setActiveRecipient] = useState(null);
  const [searchTarget, setSearchTarget] = useState('');
  const [searchError, setSearchError] = useState('');
  const [recentContacts, setRecentContacts] = useState(() => {
    const saved = localStorage.getItem('pulse_recents');
    return saved ? JSON.parse(saved) : [];
  });

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [totalBytesSent, setTotalBytesSent] = useState(0);
  const chatEndRef = useRef(null);

  // 1. Anonymous Auth
  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Real-time Messages for Active 1-to-1 Chat
  useEffect(() => {
    if (!user || !myHandle || !activeRecipient) return;

    const roomId = getChatRoomId(myHandle, activeRecipient);
    const msgsRef = collection(db, 'artifacts', appId, 'public', 'direct_chats', roomId, 'messages');

    const unsubscribe = onSnapshot(msgsRef, (snapshot) => {
      const msgs = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          text: decompressText(data.payload || '')
        };
      });
      msgs.sort((a, b) => a.timestamp - b.timestamp);
      setMessages(msgs);
    }, console.error);

    return () => unsubscribe();
  }, [user, myHandle, activeRecipient]);

  // Auto scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle Registration
  const handleRegister = async (e) => {
    e.preventDefault();
    const cleanHandle = inputHandle.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    
    if (cleanHandle.length < 3) {
      setHandleError('Handle must be at least 3 characters (letters, numbers, underscores).');
      return;
    }

    setIsRegistering(true);
    setHandleError('');

    try {
      const handleDocRef = doc(db, 'artifacts', appId, 'public', 'handles', cleanHandle);
      const docSnap = await getDoc(handleDocRef);

      if (docSnap.exists() && docSnap.data().uid !== user?.uid) {
        setHandleError(`@${cleanHandle} is already taken. Please choose another.`);
        setIsRegistering(false);
        return;
      }

      // Register handle
      await setDoc(handleDocRef, {
        handle: cleanHandle,
        uid: user?.uid || 'anon',
        createdAt: Date.now()
      });

      localStorage.setItem('pulse_handle', cleanHandle);
      setMyHandle(cleanHandle);
    } catch (err) {
      console.error('Registration failed:', err);
      // Fallback for offline/demo testing
      localStorage.setItem('pulse_handle', cleanHandle);
      setMyHandle(cleanHandle);
    } finally {
      setIsRegistering(false);
    }
  };

  // Open Chat with Handle
  const handleStartChat = async (e) => {
    e?.preventDefault();
    const target = searchTarget.trim().toLowerCase().replace('@', '');
    
    if (!target) return;
    if (target === myHandle) {
      setSearchError("You cannot start a direct chat with yourself.");
      return;
    }

    setSearchError('');
    setActiveRecipient(target);
    setSearchTarget('');

    // Save to recents
    if (!recentContacts.includes(target)) {
      const updated = [target, ...recentContacts].slice(0, 10);
      setRecentContacts(updated);
      localStorage.setItem('pulse_recents', JSON.stringify(updated));
    }
  };

  // Send Micro-Message
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !user || !myHandle || !activeRecipient) return;

    const raw = inputText.trim();
    const { compressed, bytes } = compressText(raw);
    const packetSize = bytes + 8; // Compressed bytes + compact sender header

    setInputText('');
    setTotalBytesSent(prev => prev + packetSize);

    const roomId = getChatRoomId(myHandle, activeRecipient);
    const msgsRef = collection(db, 'artifacts', appId, 'public', 'direct_chats', roomId, 'messages');

    try {
      await addDoc(msgsRef, {
        sender: myHandle,
        senderId: user.uid,
        payload: compressed,
        bytes: packetSize,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error("Transmission error:", err);
    }
  };

  // --- SCREEN 1: Choose Handle Screen ---
  if (!myHandle) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950 text-slate-100 p-4 font-sans select-none">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="text-center space-y-2">
            <div className="inline-flex p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-400">
              <AtSign className="w-8 h-8" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-wide">Claim Your Handle</h1>
            <p className="text-xs text-slate-400">
              Pick a permanent unique handle. Others will message you directly using this name.
            </p>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1">YOUR UNIQUE USERNAME</label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500 font-mono font-bold">@</span>
                <input
                  type="text"
                  value={inputHandle}
                  onChange={(e) => setInputHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="e.g. rahul_dev"
                  maxLength={18}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-4 py-3 text-sm text-emerald-400 font-mono font-semibold placeholder-slate-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50"
                />
              </div>
              {handleError && <p className="text-[11px] text-rose-400 mt-1.5">{handleError}</p>}
            </div>

            <button
              type="submit"
              disabled={isRegistering || inputHandle.length < 3}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-bold py-3 rounded-xl text-sm transition flex items-center justify-center space-x-2"
            >
              <UserPlus className="w-4 h-4" />
              <span>{isRegistering ? 'Registering Handle...' : 'Create & Connect'}</span>
            </button>
          </form>

          <div className="border-t border-slate-800/80 pt-4 flex items-center justify-between text-[11px] font-mono text-slate-500">
            <span>Payload: ~12 Bytes</span>
            <span>2 kbps Optimized</span>
          </div>
        </div>
      </div>
    );
  }

  // --- SCREEN 2: Main Messenger View ---
  return (
    <div className="flex h-screen max-h-screen bg-slate-950 text-slate-100 font-sans select-none overflow-hidden">
      
      {/* Sidebar: Handle Profile & Search (Hidden on mobile when chat is active) */}
      <aside className={`w-full md:w-80 bg-slate-900 border-r border-slate-800 flex flex-col ${activeRecipient ? 'hidden md:flex' : 'flex'}`}>
        
        {/* User Handle Banner */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold font-mono text-sm">
              @{myHandle.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="font-bold text-sm text-white font-mono">@{myHandle}</span>
                <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <span className="text-[10px] text-emerald-400/80 font-mono">Online • 2kbps Link</span>
            </div>
          </div>

          <button
            onClick={() => {
              if (confirm("Sign out and remove saved handle from this browser?")) {
                localStorage.removeItem('pulse_handle');
                setMyHandle('');
                setActiveRecipient(null);
              }
            }}
            className="text-[10px] text-slate-500 hover:text-rose-400 font-mono"
            title="Switch Handle"
          >
            Switch
          </button>
        </div>

        {/* Start New Chat by Handle Search */}
        <div className="p-3 border-b border-slate-800 bg-slate-950/40">
          <form onSubmit={handleStartChat} className="space-y-1.5">
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500 font-mono text-xs">@</span>
              <input
                type="text"
                value={searchTarget}
                onChange={(e) => setSearchTarget(e.target.value)}
                placeholder="Enter handle to message..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-8 py-2 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-emerald-500"
              />
              <button type="submit" className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-emerald-400 hover:text-white">
                <Search className="w-3.5 h-3.5" />
              </button>
            </div>
            {searchError && <p className="text-[10px] text-rose-400 pl-1">{searchError}</p>}
          </form>
        </div>

        {/* Recent Conversations */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="px-2 py-1 text-[10px] font-mono text-slate-500 tracking-wider uppercase">Direct Conversations</div>
          
          {recentContacts.length === 0 ? (
            <div className="text-center py-8 px-4 text-xs text-slate-500 space-y-1">
              <MessageSquare className="w-5 h-5 mx-auto text-slate-600 mb-2" />
              <p>No active chats yet.</p>
              <p className="text-[11px] text-slate-600">Type any friend's handle above to start messaging.</p>
            </div>
          ) : (
            recentContacts.map((handle) => (
              <button
                key={handle}
                onClick={() => setActiveRecipient(handle)}
                className={`w-full text-left p-2.5 rounded-xl border flex items-center justify-between transition ${
                  activeRecipient === handle
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-950/50 border-slate-800/80 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center font-mono text-xs text-slate-300">
                    {handle[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="font-mono font-bold text-xs">@{handle}</div>
                    <div className="text-[10px] text-slate-500 font-mono">1-to-1 Direct Link</div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Telemetry Footer */}
        <div className="p-3 bg-slate-950 border-t border-slate-800 flex justify-between items-center text-[10px] font-mono text-slate-400">
          <span className="flex items-center gap-1 text-emerald-400">
            <Zap className="w-3 h-3" /> 2 kbps GPRS Mode
          </span>
          <span>Sent: {totalBytesSent} B</span>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className={`flex-1 flex flex-col h-full bg-slate-950 ${!activeRecipient ? 'hidden md:flex' : 'flex'}`}>
        {activeRecipient ? (
          <>
            {/* Direct Chat Top Bar */}
            <header className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setActiveRecipient(null)}
                  className="md:hidden p-1.5 bg-slate-800 text-slate-300 rounded-lg hover:text-white"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold font-mono text-xs">
                  @{activeRecipient[0].toUpperCase()}
                </div>
                <div>
                  <h2 className="font-bold text-sm text-white font-mono">@{activeRecipient}</h2>
                  <span className="text-[10px] text-slate-400 font-mono">Direct Compressed Channel</span>
                </div>
              </div>

              <div className="flex items-center space-x-2 font-mono text-xs text-slate-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="hidden sm:inline">Zero-Overhead</span>
              </div>
            </header>

            {/* Message Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 font-sans">
              {messages.length === 0 ? (
                <div className="text-center py-16 text-slate-500 text-xs space-y-2">
                  <div className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-emerald-400">
                    <AtSign className="w-5 h-5" />
                  </div>
                  <p className="font-mono text-slate-300 font-semibold">Direct line to @{activeRecipient}</p>
                  <p>Send your first compressed message below.</p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isMe = msg.sender === myHandle || (user && msg.senderId === user.uid);
                  return (
                    <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center space-x-1.5 mb-0.5 text-[10px] font-mono text-slate-400">
                        <span className="font-semibold text-slate-300">@{msg.sender}</span>
                        <span>•</span>
                        <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="text-emerald-400 bg-emerald-950/60 border border-emerald-900/40 px-1 rounded">
                          {msg.bytes} B
                        </span>
                      </div>
                      <div
                        className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm border shadow-sm ${
                          isMe
                            ? 'bg-emerald-600/20 text-emerald-100 border-emerald-500/40 rounded-br-xs'
                            : 'bg-slate-900 text-slate-100 border-slate-800 rounded-bl-xs'
                        }`}
                      >
                        <p className="break-words leading-relaxed">{msg.text}</p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Bar */}
            <form onSubmit={handleSendMessage} className="p-3 bg-slate-900 border-t border-slate-800 flex items-center space-x-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Message @${activeRecipient} (e.g. on my way, call me)...`}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
              <button
                type="submit"
                disabled={!inputText.trim()}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-sm flex items-center space-x-1.5 transition"
              >
                <span>Send</span>
                <Send className="w-4 h-4" />
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500 space-y-3">
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-emerald-400">
              <MessageSquare className="w-8 h-8" />
            </div>
            <h3 className="font-bold text-white text-base">Select or Search a Handle</h3>
            <p className="text-xs text-slate-400 max-w-xs">
              Type any user's handle on the left to st
