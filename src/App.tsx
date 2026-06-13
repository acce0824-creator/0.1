import React, { useState, useEffect, useRef } from "react";
import { 
  Volume2, 
  VolumeX, 
  Mic, 
  MicOff, 
  Radio, 
  RotateCcw, 
  Search, 
  SkipForward, 
  AlertTriangle, 
  HelpCircle, 
  User, 
  Send,
  Sparkles,
  Info,
  Layers,
  ChevronRight,
  Play,
  Square
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// CB Radio Operating Frequencies
const CHANNELS = [
  { id: 1, name: "CH-01", frequency: "26.965 MHz", label: "Highway Patrol & Truckers", operator: "Gearbox", desc: "Long-haul drivers, road traffic condition reports, speed trap warnings, and general heavy-rig slang." },
  { id: 2, name: "CH-02", frequency: "26.975 MHz", label: "Search & Rescue Dispatch", operator: "Rescue One", desc: "Wilderness coordinate reporting, mountain weather alerts, emergency base communications." },
  { id: 3, name: "CH-03", frequency: "26.985 MHz", label: "Numbers Station (Cryptic)", operator: "Cipher-9", desc: "Unidentified Cold-War repeater repeating military code phonetic ciphers and bizarre signal hums." },
  { id: 4, name: "CH-04", frequency: "27.005 MHz", label: "Local Country Chit-Chat", operator: "Catfish", desc: "Friendly neighborhood gossip, lake fishing update notes, old lawnmowers, and general farm banter." },
  { id: 5, name: "CH-05", frequency: "27.015 MHz", label: "Base Station (AI Relay)", operator: "Eagle Eye", desc: "Primary full-duplex interactive transceiver connected directly to a smart base station dispatcher." }
];

export default function App() {
  // App States
  const [power, setPower] = useState<boolean>(false);
  const [channel, setChannel] = useState<number>(1);
  const [fineTuning, setFineTuning] = useState<number>(0); // -50 to +50 kHz offset
  const [volume, setVolume] = useState<number>(60); // 0 to 100
  const [squelch, setSquelch] = useState<number>(30); // 0 to 100
  const [rfGain, setRfGain] = useState<number>(80); // 0 to 100
  const [anl, setAnl] = useState<boolean>(true); // Automatic Noise Limiter
  const [paCb, setPaCb] = useState<boolean>(false); // false = CB Radio, true = PA (Megaphone)
  const [sMeterMode, setSMeterMode] = useState<"SRF" | "SWR">("SRF");
  
  // Interactive States
  const [scanMode, setScanMode] = useState<boolean>(false);
  const [transmitting, setTransmitting] = useState<boolean>(false);
  const [receiving, setReceiving] = useState<boolean>(false);
  const [activeOperator, setActiveOperator] = useState<string | null>(null);
  const [scrollingTicker, setScrollingTicker] = useState<string>("CB-27 TRANSCEIVER BAND MODEL TRX-710 ONLINE. SELECT CHANNEL AND ADJUST SQUELCH.");
  const [activeVoiceResponse, setActiveVoiceResponse] = useState<string>("");
  const [userHandle, setUserHandle] = useState<string>("RoadRunner");
  const [typedMessage, setTypedMessage] = useState<string>("");
  const [micState, setMicState] = useState<"inactive" | "recording" | "blocked" | "checking">("inactive");
  
  // CB Chatter Logs
  const [chatterLogs, setChatterLogs] = useState<Array<{
    id: string;
    operator: string;
    text: string;
    channel: number;
    isUser: boolean;
    timestamp: string;
    signalStrength: number;
  }>>([
    {
      id: "init",
      operator: "SYSTEM",
      text: "Radio station power initialized. Standby on CB frequencies.",
      channel: 1,
      isUser: false,
      timestamp: "SYSTEM",
      signalStrength: 9
    }
  ]);

  // Audio Playback Logs
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [playingLastTx, setPlayingLastTx] = useState<boolean>(false);
  const [showHelp, setShowHelp] = useState<boolean>(false);

  // Web Audio Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const staticGainNodeRef = useRef<GainNode | null>(null);
  const staticOscRef = useRef<AudioBufferSourceNode | null>(null);
  const heterodyneOscRef = useRef<OscillatorNode | null>(null);
  const heterodyneGainRef = useRef<GainNode | null>(null);
  const masterGainNodeRef = useRef<GainNode | null>(null);
  const audioInitializedRef = useRef<boolean>(false);

  // Meter Needle Fluctuations Ref
  const [needleAngle, setNeedleAngle] = useState<number>(-45); // Leftmost position
  const [ledIntensity, setLedIntensity] = useState<number>(0.2); // Backdrop glow intensity

  // Microphone Media Recorder Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const speechRecognitionRef = useRef<any>(null);

  // --- 1. WEB AUDIO SYNTHESIS ENGINE ---
  
  const initAudioEngine = () => {
    if (audioInitializedRef.current) return;
    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtxClass();
      audioCtxRef.current = ctx;

      // Master Gain
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime((volume / 100) * 0.4, ctx.currentTime);
      masterGain.connect(ctx.destination);
      masterGainNodeRef.current = masterGain;

      // CB Speaker Filter Bank (Bandpass 350Hz - 2200Hz to sound like a tiny radio speaker)
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.setValueAtTime(2200, ctx.currentTime);

      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.setValueAtTime(350, ctx.currentTime);

      // Overdrive distortion to simulate old speaker/mic element grid
      const distortion = ctx.createWaveShaper();
      distortion.curve = makeDistortionCurve(25);
      distortion.oversample = "4x";

      // Connect filters
      highpass.connect(lowpass);
      lowpass.connect(distortion);
      distortion.connect(masterGain);

      // Create continuous static noise node
      const bufferSize = 2 * ctx.sampleRate;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const staticSource = ctx.createBufferSource();
      staticSource.buffer = noiseBuffer;
      staticSource.loop = true;

      // Static Filter: narrow Bandpass to sound like raw radio hiss
      const staticFilter = ctx.createBiquadFilter();
      staticFilter.type = "bandpass";
      staticFilter.frequency.setValueAtTime(1100, ctx.currentTime);
      staticFilter.Q.setValueAtTime(1.8, ctx.currentTime);

      const staticGain = ctx.createGain();
      // Set background squelch gain relative to dials
      const currentStaticVol = calculateStaticGain(squelch, volume, transmitting, receiving, rfGain, fineTuning);
      staticGain.gain.setValueAtTime(currentStaticVol, ctx.currentTime);

      // Connect static noise network
      staticSource.connect(staticFilter);
      staticFilter.connect(staticGain);
      staticGain.connect(distortion); // route into distortion/filters and to speaker
      staticSource.start();

      staticGainNodeRef.current = staticGain;
      staticOscRef.current = staticSource;

      // Heterodyne Fine-tuning whistling oscillator (analog drift drone)
      const whistleOsc = ctx.createOscillator();
      whistleOsc.type = "sine";
      whistleOsc.frequency.setValueAtTime(0, ctx.currentTime);

      const whistleGain = ctx.createGain();
      whistleGain.gain.setValueAtTime(0, ctx.currentTime);

      whistleOsc.connect(whistleGain);
      whistleGain.connect(distortion);
      whistleOsc.start();

      heterodyneOscRef.current = whistleOsc;
      heterodyneGainRef.current = whistleGain;

      audioInitializedRef.current = true;
      playBeep(1800, 0.08, "sine"); // Sweet clicky power-on indicator
    } catch (err) {
      console.error("Failed to initialize Web Audio Engine:", err);
    }
  };

  const makeDistortionCurve = (amount: number) => {
    const k = typeof amount === "number" ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  };

  // Helper formula to compute physical static volume based on CB dial settings
  const calculateStaticGain = (
    sql: number, 
    vol: number, 
    tx: boolean, 
    rx: boolean, 
    rf: number, 
    fine: number
  ) => {
    if (tx) return 0; // Completely silent static during your own transmission
    
    const noiseVolFactor = 0.5; // Base dampener
    const tuningOffsetFactor = Math.abs(fine) / 50; // Off-tuning makes static louder
    const rfFactor = rf / 100; // Low RF gain squashes reception volume
    const masterVol = vol / 100;

    // Squelch Level comparison. S0 = wide open static, S100 = completely gated
    const squelchThreshold = sql / 10; // 0 to 10 scale
    const simulatedSignalStrength = rx ? 8.2 : (0.4 + tuningOffsetFactor * 1.5);

    const isSquelchOpen = simulatedSignalStrength >= squelchThreshold;

    if (!isSquelchOpen) {
      return 0.001; // Squelch is CLOSED! High silence.
    }

    // Dynamic Sshhhhh volume
    const rawStaticGain = (0.05 + tuningOffsetFactor * 0.18) * rfFactor * masterVol * noiseVolFactor;
    return rawStaticGain;
  };

  // Sound standard click sounds or synth tones
  const playBeep = (freq: number, duration: number, type: "sine" | "triangle" | "sawtooth" | "square" = "sine", gainVal = 0.08) => {
    if (!audioCtxRef.current || !masterGainNodeRef.current) return;
    const ctx = audioCtxRef.current;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(gainVal, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    
    // Connect to speaker distortion stream directly to get authentic radio filter overlay
    osc.connect(gain);
    gain.connect(masterGainNodeRef.current);
    
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };

  // Sound unique K-Beeps and Roger-Beep variants
  const triggerRogerBeep = (type: string) => {
    if (!audioCtxRef.current || !masterGainNodeRef.current) return;
    const ctx = audioCtxRef.current;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(masterGainNodeRef.current);

    if (type === "trucker") {
      // Traditional dual tone: 800Hz for 80ms, then 1000Hz for 80ms
      osc.type = "sine";
      osc.frequency.setValueAtTime(800, now);
      gainNode.gain.setValueAtTime(0.12, now);
      osc.start(now);
      osc.frequency.setValueAtTime(1000, now + 0.08);
      gainNode.gain.setValueAtTime(0.12, now + 0.08);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.180);
      osc.stop(now + 0.180);
    } else if (type === "roger") {
      // 1000Hz standard Roger Beep
      osc.type = "sine";
      osc.frequency.setValueAtTime(1020, now);
      gainNode.gain.setValueAtTime(0.12, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.220);
      osc.start(now);
      osc.stop(now + 0.220);
    } else if (type === "spaced") {
      // Mysterious sci-fi space tone slide down (Channel 3 vibe)
      osc.type = "sine";
      osc.frequency.setValueAtTime(1400, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.35);
      gainNode.gain.setValueAtTime(0.09, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === "electronic") {
      // Modern electronic digital dual chirp (Channel 5 vibe)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(masterGainNodeRef.current);

      osc.type = "square";
      osc.frequency.setValueAtTime(1200, now);
      gainNode.gain.setValueAtTime(0.04, now);
      gainNode.gain.setValueAtTime(0, now + 0.06);
      osc.start(now);
      osc.stop(now + 0.14);

      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1500, now + 0.06);
      gain2.gain.setValueAtTime(0.06, now + 0.06);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc2.start(now + 0.06);
      osc2.stop(now + 0.15);
    } else {
      // Classic 1200Hz ham radio beep
      osc.type = "sine";
      osc.frequency.setValueAtTime(1250, now);
      gainNode.gain.setValueAtTime(0.10, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.150);
      osc.start(now);
      osc.stop(now + 0.150);
    }
  };

  // Sound burst of radio carrier static (squelch tail crackle)
  const playSquelchTailStaticBurst = (duration: number) => {
    if (!audioCtxRef.current || !masterGainNodeRef.current || anl) return;
    const ctx = audioCtxRef.current;
    
    // Create random static burst to mock squelch open/shut crackle
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
       data[i] = (Math.random() * 2 - 1) * 0.45;
    }
    
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(950, ctx.currentTime);
    filter.Q.setValueAtTime(2.2, ctx.currentTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime((volume / 100) * 0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(masterGainNodeRef.current);
    
    noise.start();
  };

  // --- 2. EFFECT HOOKS FOR DIALS & SCANNING ---

  // Handle Power state modifications
  useEffect(() => {
    if (power) {
      initAudioEngine();
      setScrollingTicker("TRX CB-RADIO POWERED ON. FREQ IN RANGE 26.965-27.015MHZ. SYSTEMS OK.");
      setNeedleAngle(-35); // Moves slightly up to reflect power-on thermal noise
      setLedIntensity(0.85);
    } else {
      // Shut down dsp parameters
      if (staticGainNodeRef.current) {
        staticGainNodeRef.current.gain.setValueAtTime(0, audioCtxRef.current?.currentTime || 0);
      }
      if (heterodyneGainRef.current) {
        heterodyneGainRef.current.gain.setValueAtTime(0, audioCtxRef.current?.currentTime || 0);
      }
      setNeedleAngle(-45);
      setLedIntensity(0.1);
      setReceiving(false);
      setTransmitting(false);
      setScanMode(false);
      setScrollingTicker("TRANSCEIVER SYSTEM OFFLINE. CLICK POWER ON TO BOOT.");
    }
  }, [power]);

  // Update master volume parameter
  useEffect(() => {
    if (audioInitializedRef.current && masterGainNodeRef.current && audioCtxRef.current) {
      masterGainNodeRef.current.gain.setValueAtTime((volume / 100) * 0.4, audioCtxRef.current.currentTime);
    }
  }, [volume]);

  // Update Squelch, RF Gain & Static soundscapes dynamically
  useEffect(() => {
    if (audioInitializedRef.current && staticGainNodeRef.current && audioCtxRef.current) {
      const targetStaticGain = calculateStaticGain(squelch, volume, transmitting, receiving, rfGain, fineTuning);
      staticGainNodeRef.current.gain.setTargetAtTime(targetStaticGain, audioCtxRef.current.currentTime, 0.05);
    }
  }, [squelch, volume, transmitting, receiving, rfGain, fineTuning]);

  // Fine tuning updates VFO drone pitch and heterodyne whining
  useEffect(() => {
    if (audioInitializedRef.current && heterodyneOscRef.current && heterodyneGainRef.current && audioCtxRef.current) {
      const ctx = audioCtxRef.current;
      const absOffset = Math.abs(fineTuning); // 0 to 50

      if (absOffset < 3) {
        // Silent and zero on-frequency
        heterodyneGainRef.current.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
      } else {
        // Pitch rises as you move off standard carrier frequency
        const pitch = absOffset * 32 + 180; // 180Hz to 1780Hz
        // Volume peaking at about 25kHz deviation
        const strengthMultiplier = Math.sin((absOffset / 50) * Math.PI);
        const whistleVol = strengthMultiplier * (volume / 100) * 0.035 * (rfGain / 100);

        heterodyneOscRef.current.frequency.setTargetAtTime(pitch, ctx.currentTime, 0.05);
        heterodyneGainRef.current.gain.setTargetAtTime(whistleVol, ctx.currentTime, 0.08);
      }
    }
  }, [fineTuning, volume, rfGain]);

  // S-Meter moving needle simulation loop
  useEffect(() => {
    if (!power) {
      setNeedleAngle(-45);
      return;
    }

    const interval = setInterval(() => {
      let baseAngle = -35; // base thermal background noise

      if (transmitting) {
        // Transmitter pins needle to S9+30dB (the rightmost edge!)
        baseAngle = 38 + (Math.random() * 2 - 1) * 1.5;
      } else if (receiving) {
        // Operators have firm signal strength
        const matchCH = CHANNELS.find(c => c.id === channel);
        const operatorSignal = matchCH?.id === 3 ? 3 : 7; // Cryptic signals are faint
        
        // Fine tuning degrades signal strength
        const tuningPenalty = Math.max(0, Math.floor(Math.abs(fineTuning) / 8));
        const finalSignal = Math.max(1, operatorSignal - tuningPenalty);

        // Map final signal strength (1-9) to SWR scale angles (-35 to +20 deg)
        baseAngle = -35 + (finalSignal * 7) + (Math.random() * 3 - 1.5);
      } else {
        // Just raw air static feedback
        const squelchGated = (squelch / 10) > 1.0;
        const rfLevel = rfGain / 100;
        
        if (squelchGated) {
          baseAngle = -42 + (Math.random() * 0.5); // resting dead stop
        } else {
          // background noise floor vibrates with thermal gain
          baseAngle = -38 + (rfLevel * 5) + (Math.random() * 1.5 - 0.75);
        }
      }

      setNeedleAngle(baseAngle);
    }, 180);

    return () => clearInterval(interval);
  }, [power, transmitting, receiving, rfGain, squelch, channel, fineTuning]);

  // --- 3. CHANNEL AUTOMATIC SCANNER ENGINE ---

  useEffect(() => {
    if (!scanMode || !power) return;

    let scanTimer = setInterval(() => {
      // Move to next channel
      setChannel(prev => {
        const next = prev === 5 ? 1 : prev + 1;
        playBeep(2100, 0.02, "sine", 0.03); // Quick synth digit click

        // Simulate a "SQUELCH BREAKER" random transmission on that channel!
        // To make scanning exciting, there's a 45% chance we lock onto trucker chatter
        const simulationRoll = Math.random() < 0.45;
        if (simulationRoll) {
          setScanMode(false); // STOP scanning! We found carrier.
          clearInterval(scanTimer);
          
          // Trigger a random incoming monologue from that channel's operator
          setTimeout(() => {
            simulateReceiverSpeech(next);
          }, 400);
        }

        return next;
      });
    }, 900); // Scan rate of 900ms per band step

    return () => clearInterval(scanTimer);
  }, [scanMode, power]);

  // --- 4. DYNAMIC SPEECH RECIPIENT CAPTURE & GEMINI CLIENT ---

  // Sets up speech recognition for hands-free voice-to-text
  useEffect(() => {
    const SpeechClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechClass) {
      const rec = new SpeechClass();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = "en-US";

      rec.onresult = (e: any) => {
        const resultText = e.results[0][0].transcript;
        if (resultText) {
          setTypedMessage(resultText);
          setScrollingTicker(`MIC CAPTURED: "${resultText.toUpperCase()}"... RELEASE PTT TO TX.`);
        }
      };

      rec.onerror = (e: any) => {
        console.warn("Speech recognition warning/error:", e.error);
        if (e.error === "not-allowed") {
          setMicState("blocked");
        }
      };

      speechRecognitionRef.current = rec;
    }
  }, []);

  // Keyboard shortcut: SPACEBAR triggers PTT transmission holding!
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !transmitting && power && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        startPTT();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" && transmitting && power && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        stopPTT();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [transmitting, power]);

  // Start Push-To-Talk
  const startPTT = async () => {
    if (!power) {
      setScrollingTicker("ERROR: POWER CONTROLLER OFFLINE. FLIP SWITCH TO 'ON'.");
      return;
    }
    if (scanMode) setScanMode(false);
    
    // Stop any speaking operators
    window.speechSynthesis?.cancel();
    setReceiving(false);

    setTransmitting(true);
    setScrollingTicker(`[TX] TRANSMITTING ACTIVE... HOLD TO SPEAK ON CH-0${channel}`);
    playBeep(250, 0.12, "triangle", 0.08); // Heavy relay metal click

    // Attempt actual browser Voice Recording
    setMicState("checking");
    recordedChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicState("recording");
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        const audioUrl = URL.createObjectURL(audioBlob);
        setRecordedAudioUrl(audioUrl);
        setMicState("inactive");
      };

      mediaRecorder.start();

      // Also trigger Speech recognition to transcribe user words
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.start();
        } catch (recognitionErr) {
          // Already running
        }
      }
    } catch (err) {
      console.warn("Microphone access denied or failed:", err);
      setMicState("blocked");
    }
  };

  // Stop Push To Talk
  const stopPTT = () => {
    if (!transmitting) return;
    setTransmitting(false);
    playBeep(180, 0.1, "triangle", 0.08); // Metal mic click off

    // Stop recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      // Halt audio stream tracks
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }

    // Stop speech recognition
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch (e) {}
    }

    const currentBeepOption = channel === 1 ? "trucker" : channel === 3 ? "spaced" : channel === 5 ? "electronic" : "classic";
    triggerRogerBeep(currentBeepOption);

    // Prepare text payload
    const userWords = typedMessage.trim() || "Breaker check! Copy on Channel " + channel + ", over.";
    
    // Log user chat
    const userLog = {
      id: "user-" + Date.now(),
      operator: userHandle || "Stranger",
      text: userWords,
      channel: channel,
      isUser: true,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      signalStrength: 9
    };

    setChatterLogs(prev => [...prev.slice(-30), userLog]);
    setTypedMessage("");

    // Automatically trigger AI Responder on selected channel!
    // Give it a brief 1.2-second realistic radio delay
    setScrollingTicker(`[TX COMPLETE] CARRIER DROPPED. WAITING FOR COPY ON ${CHANNELS[channel-1].frequency}...`);
    
    setTimeout(() => {
      sendTransmissionToOperator(channel, userWords);
    }, 1500);
  };

  // Trigger quick presets
  const triggerQuickMessage = (text: string) => {
    if (!power) return;
    setTypedMessage(text);
    // Mimic quick trigger sequence
    startPTT();
    setTimeout(() => {
      stopPTT();
    }, 400);
  };

  // Hit full stack Express endpoint to execute server side Gemini API operators
  const sendTransmissionToOperator = async (ch: number, text: string) => {
    if (!power) return;
    setReceiving(true);
    playSquelchTailStaticBurst(0.4); // Radio static squelch click

    try {
      const response = await fetch("/api/cb/transmit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: ch,
          message: text,
          handle: userHandle
        })
      });

      const data = await response.json();
      
      const incomingText = data.reply || "Static blocks the transmission, over.";
      const opName = data.operator || "Unknown Operator";
      const signal = data.signalStrength || 7;
      const beep = data.beepType || "classic";

      setActiveOperator(opName);
      setActiveVoiceResponse(incomingText);
      setScrollingTicker(`[RX CH-0${ch}] ${opName.toUpperCase()}: "${incomingText.toUpperCase()}"`);

      // Log operator's transmission
      const operatorLog = {
        id: "op-" + Date.now(),
        text: incomingText,
        operator: opName,
        channel: ch,
        isUser: false,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        signalStrength: signal
      };
      setChatterLogs(prev => [...prev.slice(-30), operatorLog]);

      // Speak text response through custom radio filter simulation loop
      speakRadioText(incomingText, beep);

    } catch (err) {
      console.error("Transceiver API Error:", err);
      // Fallback
      setReceiving(false);
      setScrollingTicker("ERROR: WEAK CARRIER SIGNAL. TRY TURNING RF GAIN UP.");
    }
  };

  // Speech synthesis speaking like a real high-fidelity filtered CB speaker
  const speakRadioText = (text: string, rogerBeepStyle: string) => {
    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel(); // Terminate anything existing

    // Squelch threshold lock check
    const currentSquelchThreshold = squelch / 10;
    const matchSignal = channel === 3 ? 4.5 : 8.0; // Numbers station signal is faint

    if (matchSignal < currentSquelchThreshold) {
      setScrollingTicker(`[SQUELCHED] CH-0${channel} ACTIVE BUT LOCKED BY SQUELCH DIAL. LOWER SQUELCH TO LISTEN.`);
      // Still log but don't speak, representing a real gated carrier!
      setTimeout(() => {
        setReceiving(false);
      }, 3000);
      return;
    }

    const cleanText = text.replace(/over\.?$/i, "").trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Try to get an older vintage-sounding or heavy-rate voice
    const voices = window.speechSynthesis.getVoices();
    // Choose voice based on operator persona
    if (channel === 1 || channel === 4) {
      const maleVoice = voices.find(v => v.name.toLowerCase().includes("male") || v.name.toLowerCase().includes("google us english") || v.name.toLowerCase().includes("david"));
      if (maleVoice) utterance.voice = maleVoice;
      utterance.pitch = 0.85; // Low trucker voice
      utterance.rate = 0.95;
    } else if (channel === 2) {
      const dispatchVoice = voices.find(v => v.name.toLowerCase().includes("standard") || v.name.toLowerCase().includes("microsoft"));
      if (dispatchVoice) utterance.voice = dispatchVoice;
      utterance.pitch = 1.0;
      utterance.rate = 1.1; // Speedy dispatcher
    } else if (channel === 3) {
      const mechanicalVoice = voices.find(v => v.name.toLowerCase().includes("zira") || v.name.toLowerCase().includes("female"));
      if (mechanicalVoice) utterance.voice = mechanicalVoice;
      utterance.pitch = 1.3; // Spooky mechanical numbers station robot
      utterance.rate = 0.75; // S-l-o-w cryptic reading
    }

    utterance.onstart = () => {
      // Squelch noise burst on voice entry
      playSquelchTailStaticBurst(0.2);
    };

    utterance.onend = () => {
      // Drop carrier after speech finishes
      playSquelchTailStaticBurst(0.25);
      setTimeout(() => {
        triggerRogerBeep(rogerBeepStyle);
        setReceiving(false);
        setActiveOperator(null);
        setScrollingTicker(`[RX STANDBY] CB MONITORS FREQ CH-0${channel} AT ${CHANNELS[channel-1].frequency}.`);
      }, 400);
    };

    utterance.onerror = () => {
      setReceiving(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  // Simulate an random incoming dialogue from preset Operators (Fills background chatter)
  const simulateReceiverSpeech = (targetCh: number) => {
    if (!power || transmitting || receiving) return;
    
    // Choose active text matching preset log database list
    const pool = CHANNELS[targetCh-1];
    setReceiving(true);
    setScrollingTicker(`[CHANNELS SEARCH] LOCK CARRIER ON CH-0${targetCh}...`);

    setTimeout(async () => {
      try {
        const response = await fetch("/api/cb/transmit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channel: targetCh,
            message: "", // empty forces a standard operator chatter
            handle: "Unknown Trucker"
          })
        });
        const data = await response.json();
        
        setActiveOperator(data.operator);
        setActiveVoiceResponse(data.reply);
        setScrollingTicker(`[BANDS COPT] LOCK AT ${pool.frequency}. ${data.operator.toUpperCase()} OUT.`);
        
        const operatorLog = {
          id: "op-chatter-" + Date.now(),
          text: data.reply,
          operator: data.operator,
          channel: targetCh,
          isUser: false,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          signalStrength: data.signalStrength
        };
        setChatterLogs(prev => [...prev.slice(-30), operatorLog]);
        speakRadioText(data.reply, data.beepType);

      } catch (err) {
        setReceiving(false);
      }
    }, 800);
  };

  const playRecordedMessageCheck = () => {
    if (!recordedAudioUrl) return;
    setPlayingLastTx(true);
    playBeep(450, 0.08, "sine");

    const audio = new Audio(recordedAudioUrl);
    audio.play();
    audio.onended = () => {
      setPlayingLastTx(false);
      triggerRogerBeep("classic");
    };
  };

  // Keep browsers from dropping SpeechSynthesis voice cache loads
  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
       window.speechSynthesis.getVoices();
    }
  }, []);

  return (
    <div id="cb-radio-main-layout" className="min-h-screen bg-[#07090b] flex flex-col items-center justify-start p-4 md:p-8 selection:bg-amber-600 selection:text-black">
      
      {/* HEADER BAR */}
      <header className="w-full max-w-5xl flex flex-col sm:flex-row items-center justify-between border-b border-zinc-800 pb-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-amber-500 to-amber-700 rounded-lg shadow-lg border border-amber-400">
            <Radio className="w-6 h-6 text-black animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-100 flex items-center gap-2">
              TRX-710 Industrial CB Radio <span className="text-xs bg-amber-500/10 text-amber-500 border border-amber-500/30 px-1.5 py-0.5 rounded font-mono">5-BAND</span>
            </h1>
            <p className="text-xs text-zinc-400">Low-latency analog signal modeling via Web Audio Synthesizer</p>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4 sm:mt-0">
          <button 
            id="help-toggle-btn"
            onClick={() => setShowHelp(!showHelp)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs border border-zinc-700 transition"
          >
            <HelpCircle className="w-4 h-4 text-amber-500" />
            {showHelp ? "Hide Panel" : "Quick Start Guide"}
          </button>
          
          <div className="text-right hidden md:block">
            <div className="text-[10px] text-zinc-500 font-mono">UTC MONITOR TIME</div>
            <div className="text-xs text-amber-500 font-mono font-bold tracking-widest">
              {new Date().toISOString().substring(11, 19)}
            </div>
          </div>
        </div>
      </header>

      {/* QUICK HELP SYSTEM */}
      <AnimatePresence>
        {showHelp && (
          <motion.div 
            initial={{ opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="w-full max-w-5xl bg-zinc-900 border border-zinc-700 rounded-lg p-5 mb-6 shadow-2xl relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-1 bg-amber-500 h-full"></div>
            <h3 className="text-amber-500 font-bold text-sm mb-3 flex items-center gap-2 font-mono uppercase">
              <Info className="w-4 h-4" /> CB Radio Operators Manual - Quick Start
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-zinc-300">
              <div>
                <span className="font-bold text-zinc-100 block mb-1">1. Power & Volume:</span>
                Flip the chunky silver <span className="font-bold text-amber-500">POWER</span> switch key to ON on the panel. Drag the <span className="font-bold text-zinc-100">VOLUME dial</span> to at least 40% to initiate the speaker line.
              </div>
              <div>
                <span className="font-bold text-zinc-100 block mb-1">2. Squelch Noise Gate:</span>
                Squelch cuts off static. Turn <span className="font-bold text-zinc-100 font-mono">SQL</span> counter-clockwise (to 0) to hear the pure static background hiss. Turn it clockwise to silence static when channels are silent. Squelch will open automatically when high signal transmissions are detected!
              </div>
              <div>
                <span className="font-bold text-zinc-100 block mb-1">3. Transmit Push-To-Talk:</span>
                Either click and <span className="font-bold text-amber-500">HOLD PTT</span> on screen, or <span className="font-bold text-amber-500">HOLD SPACEBAR</span>. Release to stop transmit. Other operators on the active channel will hear you and transmit back via Gemini! (Or use Quick Dispatch text buttons).
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-zinc-800 flex flex-wrap gap-2 justify-between items-center text-[11px] text-zinc-400 font-mono">
              <div>📡 Frequencies: Ch-1 (Truckers) | Ch-2 (Rescue) | Ch-3 (Numbers Station) | Ch-4 (Local Country) | Ch-5 (Base Station AI)</div>
              <button 
                onClick={() => setShowHelp(false)}
                className="text-amber-500 hover:underline"
              >
                Dismiss Setup [X]
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CORE INDUSTRIAL CONSOLE WRAPPER */}
      <main className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* PHYSICAL BASE STATION UNIT */}
        <div id="base-unit-chassis" className="lg:col-span-8 bg-zinc-950 p-5 md:p-7 rounded-2xl border-4 border-zinc-800 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] relative overflow-hidden">
          
          {/* Metal screws accent decor for realistic hardware look */}
          <div className="absolute top-3 left-3 w-3 h-3 bg-zinc-700 rounded-full border border-zinc-900 shadow-inner flex items-center justify-center text-[5px] text-zinc-950 font-bold animate-pulse">+</div>
          <div className="absolute top-3 right-3 w-3 h-3 bg-zinc-700 rounded-full border border-zinc-900 shadow-inner flex items-center justify-center text-[5px] text-zinc-950 font-bold animate-pulse">+</div>
          <div className="absolute bottom-3 left-3 w-3 h-3 bg-zinc-700 rounded-full border border-zinc-900 shadow-inner flex items-center justify-center text-[5px] text-zinc-950 font-bold animate-pulse">+</div>
          <div className="absolute bottom-3 right-3 w-3 h-3 bg-zinc-700 rounded-full border border-zinc-900 shadow-inner flex items-center justify-center text-[5px] text-zinc-950 font-bold animate-pulse">+</div>

          {/* CHASSIS GRAIN / METALLIC SHEEN */}
          <div className="absolute inset-0 bg-radial-gradient from-zinc-800/10 via-transparent to-zinc-950 pointer-events-none"></div>

          {/* UPPER MONITORING LAYER: NEEDLE METER & DIGITAL MONITOR */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
            
            {/* ANALOG NEEDLE SWR / S-METER */}
            <div id="smeter-chassis" className="bg-zinc-900 p-3.5 rounded-xl border border-zinc-800 shadow-inner flex flex-col justify-between relative overflow-hidden group">
              <div className="absolute inset-0 bg-amber-500/[0.02] group-hover:bg-amber-500/[0.04] transition duration-500"></div>
              
              {/* Backlight Glow Bulb */}
              <div className="flex justify-between items-center z-10">
                <span className="text-[10px] font-mono font-bold text-zinc-500 tracking-wider">RX / TX RF LEVEL SWR</span>
                <div className="flex gap-1.5">
                  <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 border border-black/40 ${transmitting ? "bg-red-500 shadow-[0_0_8px_#ef4444]" : "bg-red-950"}`}></div>
                  <div className={`w-2.5 h-2.5 rounded-full transition-all duration-300 border border-black/40 ${receiving ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : "bg-green-950"}`}></div>
                </div>
              </div>

              {/* Physical S-Meter Curved Scale Graphic */}
              <div className="relative h-24 mt-2 flex items-end justify-center z-10 select-none">
                
                {/* SVG Dial Grid */}
                <svg className="w-full h-full absolute inset-0" viewBox="0 0 200 120">
                  {/* Backdrop gauge */}
                  <path d="M 20,110 A 90,90 0 0,1 180,110" fill="none" stroke="#374151" strokeWidth="6" strokeLinecap="round" />
                  
                  {/* RX Signal Scales S1 to S9 */}
                  <path d="M 30,105 A 80,80 0 0,1 110,30" fill="none" stroke="#22c55e" strokeWidth="3" strokeDasharray="2,3" />
                  {/* DB Scales +10 to +30 */}
                  <path d="M 110,30 A 80,80 0 0,1 170,105" fill="none" stroke="#ef4444" strokeWidth="3.5" strokeDasharray="3,2" />

                  {/* Tick Marks labels */}
                  <text x="25" y="118" className="fill-zinc-500 text-[8px] font-mono">S1</text>
                  <text x="45" y="80" className="fill-zinc-400 text-[8px] font-mono">S3</text>
                  <text x="75" y="50" className="fill-zinc-400 text-[8px] font-mono">S5</text>
                  <text x="110" y="42" className="fill-zinc-400 text-[8px] font-mono">S9</text>
                  <text x="145" y="65" className="fill-red-500 text-[8px] font-mono font-bold">+10dB</text>
                  <text x="165" y="110" className="fill-red-500 text-[8px] font-mono font-bold">+30dB</text>

                  {/* SWR markers */}
                  <path d="M 35,90 A 65,65 0 0,1 165,90" fill="none" stroke="#1f2937" strokeWidth="1.5" />
                  <text x="100" y="82" textAnchor="middle" className="fill-zinc-600 text-[7px] font-mono">MODULATION CAL</text>
                </svg>

                {/* Backlight Glow Filter Overlay */}
                <div 
                  className="absolute inset-0 pointer-events-none rounded-md"
                  style={{
                    boxShadow: `inset 0 0 35px rgba(245, 158, 11, ${ledIntensity * 0.25})`,
                    backgroundColor: `rgba(245, 158, 11, ${ledIntensity * 0.05})`
                  }}
                ></div>

                {/* Physical Moving Needle */}
                <motion.div 
                  className="absolute bottom-1 origin-bottom w-1 h-20 bg-amber-500 shadow-md rounded"
                  style={{ 
                    rotate: needleAngle,
                    bottom: "2px"
                  }}
                  animate={{ rotate: needleAngle }}
                  transition={{ type: "spring", stiffness: 95, damping: 15 }}
                />

                {/* Center Pivot Bezel */}
                <div className="absolute -bottom-2 w-7 h-7 bg-zinc-800 rounded-full border-4 border-zinc-950 shadow-lg flex items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-zinc-950 rounded-full"></div>
                </div>
              </div>

              {/* Mode indicator reading */}
              <div className="flex justify-between items-center text-[9px] font-mono font-bold text-zinc-500 mt-1 select-none">
                <span>[S-METER SIG: S{Math.round((needleAngle + 45) / 9.2)}]</span>
                <span className="text-amber-500 font-bold">{transmitting ? "TX CAL" : receiving ? "GATE OPEN" : "SQUELCH MONITOR"}</span>
              </div>
            </div>

            {/* VINTAGE 7-SEGMENT LED GLOW DIGITAL PANEL */}
            <div id="led-screen-bezel" className="bg-[#0b0c0f] p-4 rounded-xl border-2 border-zinc-800 shadow-[inset_0_4px_12px_rgba(0,0,0,0.9)] flex flex-col justify-between min-h-[140px] relative">
              
              {/* Backlight background grid effect */}
              <div className="absolute inset-0 bg-[linear-gradient(rgba(18,24,15,1)_0.5px,transparent_0.5px),linear-gradient(90deg,rgba(18,24,15,1)_0.5px,transparent_0.5px)] bg-[size:3px_3px] pointer-events-none opacity-20"></div>

              {/* Status Header */}
              <div className="flex items-center justify-between z-10 border-b border-[#121c10] pb-1.5">
                <span className="text-[9px] font-display font-medium text-amber-500/60 tracking-widest uppercase">7-Segment Dual Hex Receiver</span>
                <div className="flex gap-2 text-[9px] font-mono text-[#4ade80]/40">
                  <span className={anl ? "text-[#4ade80] font-bold" : ""}>ANL</span>
                  <span>|</span>
                  <span className={paCb ? "text-[#f59e0b] font-bold" : "text-[#4ade80] font-bold"}>{paCb ? "PA" : "CB"}</span>
                  <span>|</span>
                  <span className={scanMode ? "text-[#ef4444] font-bold animate-pulse" : ""}>SCAN</span>
                </div>
              </div>

              {/* MAIN FREQUENCY DISPLAY */}
              <div className="flex items-end justify-between my-2 z-10">
                {/* Large Channel display */}
                <div className="flex flex-col">
                  <span className="text-[9px] font-mono text-[#a1a1aa] leading-none">BAND</span>
                  <div className="text-4xl font-display font-black text-amber-500 tracking-tighter drop-shadow-[0_0_6px_rgba(245,158,11,0.6)]">
                    {CHANNELS[channel - 1].name.split("-")[1]}
                  </div>
                </div>

                {/* Megahertz display */}
                <div className="text-right flex flex-col items-end">
                  <span className="text-[9px] font-mono text-[#a1a1aa] leading-none">CARRIER RF FREQUENCY</span>
                  <div className="text-2xl font-display font-bold text-amber-400 tracking-wider font-mono drop-shadow-[0_0_4px_rgba(251,191,36,0.5)]">
                    {(parseFloat(CHANNELS[channel - 1].frequency) + fineTuning / 1000).toFixed(4)} <span className="text-sm text-amber-600">MHz</span>
                  </div>
                </div>
              </div>

              {/* MARQUEE TEXT TICKER */}
              <div className="bg-[#07080a] border border-[#162114] px-2.5 py-1 rounded-md overflow-hidden z-10 relative">
                <div className="text-[10px] font-mono text-[#4ade80] whitespace-nowrap overflow-hidden flex gap-2">
                  <span className="font-bold text-[#ef4444]/80 mr-1">[!]</span>
                  <marquee scrollamount="3.5" className="w-full">
                    {scrollingTicker}
                  </marquee>
                </div>
                {/* Signal indicators on grid */}
                <div className="absolute top-1 right-2 flex gap-0.5 pointer-events-none">
                  <div className="w-[2px] h-[3px] bg-[#4ade80]/20"></div>
                  <div className="w-[2px] h-[4px] bg-[#4ade80]/20"></div>
                  <div className="w-[2px] h-[5px] bg-[#4ade80]"></div>
                </div>
              </div>

            </div>
          </div>

          {/* LOWER OPERATING CONTROL DECK: ROTARY DIALS & TOGGLE SWITCHES */}
          <div className="bg-zinc-900/60 p-4 rounded-xl border border-zinc-800/80 relative">
            
            <div className="absolute inset-0 bg-gradient-to-b from-zinc-800/10 to-transparent pointer-events-none"></div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 items-center">
              
              {/* DIAL 1: MASTER POWER & VOLUME */}
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-mono font-bold text-zinc-400 mb-2 uppercase">POWER / VOL</span>
                
                {/* Dial Rotator widget */}
                <div className="relative w-16 h-16 rounded-full bg-zinc-950 border-4 border-zinc-800 shadow-[0_4px_8px_rgba(0,0,0,0.5)] flex items-center justify-center p-1 select-none">
                  <div className="absolute inset-0 rounded-full border border-zinc-700/30"></div>
                  
                  {/* Indicator notch */}
                  <motion.div 
                    className="absolute w-1 h-7 bg-zinc-400 rounded-full origin-bottom"
                    style={{ 
                      top: "4px",
                      rotate: (volume / 100) * 270 - 135
                    }}
                    animate={{ rotate: power ? ((volume / 100) * 230 - 115) : -135 }}
                  />
                  
                  {/* Inner dial screw cap */}
                  <div className="w-9 h-9 rounded-full bg-[#1e2025] border-2 border-zinc-800 shadow-inner flex items-center justify-center">
                    <div className="w-2 h-2 bg-black rounded-full"></div>
                  </div>
                </div>

                {/* Slider bar input control */}
                <div className="w-full mt-3 px-2 flex items-center gap-1.5">
                  <button 
                    onClick={() => {
                      setPower(!power);
                      playBeep(900, 0.05, "sine");
                    }}
                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono border font-bold transition ${power ? "bg-amber-500 text-black border-amber-400 shadow-sm" : "bg-zinc-800 text-zinc-400 border-zinc-700"}`}
                  >
                    {power ? "ON" : "OFF"}
                  </button>
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    disabled={!power}
                    value={volume} 
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                  <span className="text-[9px] font-mono text-zinc-500 font-bold min-w-[20px] text-right">{power ? volume : 0}</span>
                </div>
              </div>

              {/* DIAL 2: ANALOG SQUELCH GATER */}
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-mono font-bold text-zinc-400 mb-2 uppercase">SQUELCH (SQL)</span>
                
                <div className="relative w-16 h-16 rounded-full bg-zinc-950 border-4 border-zinc-800 shadow-[0_4px_8px_rgba(0,0,0,0.5)] flex items-center justify-center p-1 select-none">
                  <div className="absolute inset-0 rounded-full border border-zinc-700/30"></div>
                  <motion.div 
                    className="absolute w-1 h-7 bg-zinc-400 rounded-full origin-bottom"
                    style={{ 
                      top: "4px",
                      rotate: (squelch / 100) * 270 - 135
                    }}
                    animate={{ rotate: (squelch / 100) * 270 - 135 }}
                  />
                  <div className="w-9 h-9 rounded-full bg-[#1e2025] border-2 border-zinc-800 shadow-inner flex items-center justify-center">
                    <div className="w-2 h-2 bg-black rounded-full"></div>
                  </div>
                </div>

                <div className="w-full mt-3 px-2 flex items-center gap-1.5">
                  <span className="text-[9px] font-mono text-zinc-500">Muted</span>
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    disabled={!power}
                    value={squelch} 
                    onChange={(e) => setSquelch(Number(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                  <span className="text-[9px] font-mono text-zinc-500 font-bold min-w-[20px] text-right">{squelch}</span>
                </div>
              </div>

              {/* DIAL 3: RF GAIN RANGE */}
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-mono font-bold text-zinc-400 mb-2 uppercase">RF GAIN (SENS)</span>
                
                <div className="relative w-16 h-16 rounded-full bg-zinc-950 border-4 border-zinc-800 shadow-[0_4px_8px_rgba(0,0,0,0.5)] flex items-center justify-center p-1 select-none">
                  <div className="absolute inset-0 rounded-full border border-zinc-700/30"></div>
                  <motion.div 
                    className="absolute w-1 h-7 bg-zinc-400 rounded-full origin-bottom"
                    style={{ 
                      top: "4px",
                      rotate: (rfGain / 100) * 270 - 135
                    }}
                    animate={{ rotate: (rfGain / 100) * 270 - 135 }}
                  />
                  <div className="w-9 h-9 rounded-full bg-[#1e2025] border-2 border-zinc-800 shadow-inner flex items-center justify-center">
                    <div className="w-2 h-2 bg-black rounded-full"></div>
                  </div>
                </div>

                <div className="w-full mt-3 px-2 flex items-center gap-1.5">
                  <span className="text-[9px] font-mono text-zinc-500">Faint</span>
                  <input 
                    type="range" 
                    min="0" 
                    max="100" 
                    disabled={!power}
                    value={rfGain} 
                    onChange={(e) => setRfGain(Number(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                  <span className="text-[9px] font-mono text-zinc-500 font-bold min-w-[20px] text-right">{rfGain}</span>
                </div>
              </div>

              {/* DIAL 4: MANUAL VFO FINE-TUNER */}
              <div className="flex flex-col items-center">
                <span className="text-[10px] font-mono font-bold text-zinc-400 mb-2 uppercase flex items-center gap-1">
                  VFO OSC DRIFT
                </span>
                
                <div className="relative w-16 h-16 rounded-full bg-zinc-950 border-4 border-zinc-800 shadow-[0_4px_8px_rgba(0,0,0,0.5)] flex items-center justify-center p-1 select-none">
                  <div className="absolute inset-0 rounded-full border border-zinc-700/30"></div>
                  <motion.div 
                    className="absolute w-1.5 h-7 bg-amber-500 rounded-full origin-bottom"
                    style={{ 
                      top: "4px",
                      rotate: ((fineTuning + 50) / 100) * 270 - 135
                    }}
                    animate={{ rotate: ((fineTuning + 50) / 100) * 270 - 135 }}
                  />
                  <div className="w-9 h-9 rounded-full bg-[#1e2025] border-2 border-zinc-800 shadow-inner flex items-center justify-center">
                    <div className="w-2 h-2 bg-black rounded-full"></div>
                  </div>
                </div>

                <div className="w-full mt-3 px-2 flex flex-col items-center gap-1">
                  <div className="flex items-center w-full gap-1">
                    <button 
                      disabled={!power}
                      onClick={() => setFineTuning(0)}
                      className="px-1.5 py-0.5 rounded bg-zinc-800 text-[8px] font-mono text-zinc-400 border border-zinc-700 hover:text-amber-500"
                      title="Reset fine tuning"
                    >
                      LOCK
                    </button>
                    <input 
                      type="range" 
                      min="-50" 
                      max="50" 
                      disabled={!power}
                      value={fineTuning} 
                      onChange={(e) => setFineTuning(Number(e.target.value))}
                      className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                    />
                  </div>
                  <span className="text-[9px] font-mono text-zinc-500 font-bold">
                    {fineTuning > 0 ? `+${fineTuning}` : fineTuning} kHz
                  </span>
                </div>
              </div>

            </div>

            {/* TOGGLE ACCESSORY BOARD BUTTONS */}
            <div className="mt-6 pt-4 border-t border-zinc-850 flex flex-wrap items-center justify-between gap-4">
              
              {/* TOGGLES */}
              <div className="flex items-center gap-5">
                {/* Noise Blanker (ANL) Switch */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-zinc-400 uppercase font-bold">ANL FILTER</span>
                  <button 
                    disabled={!power}
                    onClick={() => {
                      setAnl(!anl);
                      playBeep(anl ? 800 : 1000, 0.05, "sine", 0.05);
                    }}
                    className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none ${!power ? "bg-zinc-800 cursor-not-allowed opacity-50" : anl ? "bg-amber-500" : "bg-zinc-700"}`}
                  >
                    <div className={`bg-black w-4 h-4 rounded-full shadow-md transform duration-250 ${anl ? "translate-x-4" : ""} flex items-center justify-center`}>
                      <div className="w-1 h-1 bg-zinc-600 rounded-full"></div>
                    </div>
                  </button>
                </div>

                {/* PA / CB Switch */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-zinc-400 uppercase font-bold">PA/CB SYSTEM</span>
                  <button 
                    disabled={!power}
                    onClick={() => {
                      setPaCb(!paCb);
                      playBeep(paCb ? 500 : 700, 0.06, "sine", 0.05);
                      setScrollingTicker(paCb ? "CB ACTIVE. MONITORING OVER THE AIRWAVES." : "PUBLIC ADDRESS ACTIVE. BROADCASTING VOICE DIRECT TO DECK SPEAKER.");
                    }}
                    className={`w-9 h-5 rounded-full p-0.5 transition-colors duration-200 focus:outline-none ${!power ? "bg-zinc-800 cursor-not-allowed opacity-50" : paCb ? "bg-amber-600" : "bg-zinc-700"}`}
                  >
                    <div className={`bg-black w-4 h-4 rounded-full shadow-md transform duration-250 ${paCb ? "translate-x-4" : ""} flex items-center justify-center`}>
                      <div className="w-1 h-1 bg-zinc-600 rounded-full"></div>
                    </div>
                  </button>
                </div>
              </div>

              {/* AUTOMATIC CARRIER SCAN TRIGGER */}
              <button 
                id="automatic-frequency-scanner"
                disabled={!power}
                onClick={() => {
                  setScanMode(!scanMode);
                  playBeep(900, 0.06, "sine");
                  if (!scanMode) {
                    setScrollingTicker("SCAN SYSTEM COMMENCING... LISTENING ON CHANNELS 1 TO 5.");
                  } else {
                    setScrollingTicker("CHANNEL SCAN CANCELLED BY OPERATOR CONTROLS.");
                  }
                }}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-mono border font-bold transition-all duration-300 ${!power ? "bg-zinc-850 border-zinc-800 text-zinc-600 cursor-not-allowed" : scanMode ? "bg-red-500/10 text-red-400 border-red-500/40 shadow-[0_0_10px_rgba(239,68,68,0.2)] animate-pulse" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700"}`}
              >
                <Search className={`w-3.5 h-3.5 ${scanMode ? "animate-spin" : ""}`} />
                {scanMode ? "SCANNING ACTIVE" : "AUTOSCAN BANDS"}
              </button>

            </div>

          </div>

          {/* CHANNEL SELECT BUTTON GRID */}
          <div className="mt-5 bg-zinc-900/40 p-4 rounded-xl border border-zinc-850">
            <div className="text-[10px] font-mono font-bold text-zinc-500 uppercase mb-2">QUICK CHANNEL SELECT PRESETS</div>
            <div className="grid grid-cols-5 gap-2.5">
              {CHANNELS.map((ch) => (
                <button 
                  key={ch.id}
                  disabled={!power}
                  onClick={() => {
                    setChannel(ch.id);
                    setScanMode(false);
                    playBeep(1100, 0.05, "sine");
                    setScrollingTicker(`TUNED IN TO CHANNEL ${ch.id} (${ch.frequency}). GATEWAY: ${ch.operator}.`);
                  }}
                  className={`py-2 rounded-xl text-xs font-display font-medium border flex flex-col items-center justify-center transition duration-200 ${!power ? "bg-zinc-900 border-zinc-850 text-zinc-600 cursor-not-allowed" : channel === ch.id ? "bg-amber-500 text-black border-amber-400 font-bold shadow-md" : "bg-zinc-800 hover:bg-zinc-750 text-zinc-300 border-zinc-700"}`}
                >
                  <span className="text-[10px]">CH-0{ch.id}</span>
                  <span className="text-[8px] font-mono opacity-80">{ch.frequency.split(" ")[0]}</span>
                </button>
              ))}
            </div>
          </div>

        </div>

        {/* COMPANION SIDEBAR CONTROLS: MIC, TX DISPATCH, CHATTER FEED */}
        <div className="lg:col-span-4 flex flex-col gap-6 w-full">
          
          {/* HAND MICROPHONE CONTROLLER PANEL */}
          <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-850 shadow-xl flex flex-col items-center">
            
            <div className="w-full flex items-center justify-between border-b border-zinc-800 pb-3 mb-4">
              <span className="text-xs font-mono font-bold text-zinc-400 flex items-center gap-1.5 uppercase">
                <Mic className="w-3.5 h-3.5 text-amber-500" /> CB-MT Hand Microphone
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono text-zinc-500 font-bold uppercase">MIC CAL:</span>
                <span className={`w-2 h-2 rounded-full ${micState === "recording" ? "bg-red-500 animate-ping" : "bg-zinc-700"}`}></span>
              </div>
            </div>

            {/* Handset casing graphic render with PTT Hold trigger */}
            <div className="bg-gradient-to-b from-zinc-900 to-zinc-950 w-full rounded-2xl border-2 border-zinc-800 shadow-lg p-5 flex flex-col items-center justify-center text-center">
              
              <div className="w-20 h-28 bg-[#18191c] rounded-3xl border-4 border-zinc-800 shadow-md relative flex flex-col items-center justify-between py-4 group hover:border-zinc-750 transition duration-300 mb-4 select-none">
                {/* Speaker metal grates */}
                <div className="flex flex-col gap-1 w-10">
                  <div className="h-0.5 bg-zinc-700 rounded"></div>
                  <div className="h-0.5 bg-zinc-700 rounded"></div>
                  <div className="h-0.5 bg-zinc-700 rounded"></div>
                  <div className="h-0.5 bg-zinc-700 rounded"></div>
                </div>

                {/* Push-to-Talk lateral giant lever button indicator */}
                <div className="absolute -left-1.5 top-8 w-2 h-12 bg-red-600 rounded-r-md border border-red-500 group-hover:bg-red-500 cursor-pointer"></div>

                {/* Handset icon bulb */}
                <div className={`p-2.5 rounded-full ${transmitting ? "bg-red-500/10 text-red-500 animate-pulse" : "bg-zinc-800 text-zinc-500"}`}>
                  <Mic className="w-6 h-6" />
                </div>

                <span className="text-[8px] font-mono text-zinc-500 font-black">PTT MICROPHONE</span>
              </div>

              {/* DYNAMIC TRANSCEIVE CLICK TRIGGER */}
              <button 
                id="ptt-send-action-trigger"
                onMouseDown={startPTT}
                onMouseUp={stopPTT}
                onMouseLeave={() => transmitting && stopPTT()}
                onTouchStart={(e) => { e.preventDefault(); startPTT(); }}
                onTouchEnd={(e) => { e.preventDefault(); stopPTT(); }}
                className={`w-full py-4.5 rounded-xl font-bold border transition duration-150 flex flex-col items-center justify-center gap-1 shadow-md select-none touch-none ${transmitting ? "bg-red-600 text-white border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)]" : "bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black border-amber-400 font-bold"}`}
              >
                <div className="flex items-center gap-2 text-sm uppercase tracking-wide">
                  <Sparkles className="w-4 h-4" /> 
                  {transmitting ? "HOLDING TRANSMIT (LIVE)" : "HOLD TO TRANSMIT VOICE"}
                </div>
                <span className="text-[9px] font-mono opacity-80 uppercase leading-none">Or Hold down [SPACEBAR] to talk</span>
              </button>

              {/* Last Recorded signal playback check tape deck */}
              {recordedAudioUrl && (
                <div className="mt-4 w-full bg-[#111215] border border-zinc-800 rounded-lg p-2.5 flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-1.5 text-zinc-400">
                    <SkipForward className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Last TX Recorded</span>
                  </div>
                  <button 
                    onClick={playRecordedMessageCheck}
                    disabled={playingLastTx || transmitting}
                    className="px-2.5 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 transition"
                  >
                    {playingLastTx ? (
                      <>
                        <Square className="w-3 h-3 fill-emerald-400" /> Playback...
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 fill-emerald-400" /> Test Report
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* MIC PERMISSION ERRORS */}
              {micState === "blocked" && (
                <div className="mt-3.5 text-[10px] text-zinc-400 bg-amber-500/5 p-2 rounded border border-amber-500/20 flex gap-2 items-start text-left leading-normal">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <span>Microphone blocked or not supported. You can still transmit messages instantly using the <b>Quick Dispatch</b> presets below !</span>
                </div>
              )}

            </div>

            {/* QUICK DISPATCH PANEL COMPONENT WITH CUSTOM USER HANDLE */}
            <div className="w-full mt-4 bg-zinc-900/50 p-3.5 rounded-xl border border-zinc-850">
              <div className="flex justify-between items-center mb-3">
                <span className="text-[10px] font-mono text-zinc-400 font-bold uppercase tracking-wider">Quick Text Dispatch</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono text-zinc-400">HANDLE:</span>
                  <input 
                    type="text" 
                    value={userHandle}
                    onChange={(e) => setUserHandle(e.target.value.replace(/[^a-zA-Z0-9_\s]/g, "").substring(0, 15))}
                    className="text-[9px] font-mono font-bold text-amber-500 bg-black/60 border border-zinc-800 rounded px-1.5 py-0.5 w-24 text-center focus:outline-none focus:border-amber-500"
                    placeholder="Handle"
                  />
                </div>
              </div>

              {/* CUSTOM MESSAGE DIRECT TYPED DISPATCH */}
              <div className="flex gap-2 mb-3">
                <input 
                  type="text" 
                  disabled={!power}
                  value={typedMessage}
                  onChange={(e) => setTypedMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && typedMessage.trim() && power) {
                      stopPTT();
                    }
                  }}
                  className="bg-black/60 text-xs text-zinc-100 border border-zinc-800 rounded-lg p-2 w-full focus:outline-none focus:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  placeholder={power ? "Type a dynamic message on air..." : "Power on model to type..."}
                />
                <button 
                  disabled={!power || !typedMessage.trim()}
                  onClick={() => {
                    // Trigger instant transmission
                    const words = typedMessage;
                    setTypedMessage("");
                    triggerQuickMessage(words);
                  }}
                  className="p-2 rounded-lg bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:text-amber-500 disabled:opacity-40 transition"
                  title="Send typed transmission"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>

              {/* QUICK DISPATCH RECOMMENDATIONS */}
              <div className="flex flex-col gap-1.5 text-left">
                <span className="text-[9px] font-mono text-zinc-500 uppercase">Preset Signal Requests:</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Breaker 1-9, anyone copy?",
                    "Check on speed trap report, over.",
                    "Emergency assist needed!",
                    "This is cloud team checking in.",
                    "What is your current 20, copy?"
                  ].map((preset, idx) => (
                    <button 
                      key={idx}
                      disabled={!power}
                      onClick={() => triggerQuickMessage(preset)}
                      className="px-2 py-1 rounded bg-[#15171c] hover:bg-[#1a1d24] text-[10px] text-zinc-300 font-mono border border-zinc-800 text-left hover:text-amber-500 transition truncate max-w-full disabled:opacity-50"
                    >
                      "{preset}"
                    </button>
                  ))}
                </div>
              </div>

            </div>

          </div>

          {/* TELEPRINTER / CB STATION LOG */}
          <div className="bg-zinc-950 p-5 rounded-2xl border border-zinc-850 shadow-lg flex flex-col h-[320px]">
            
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5 mb-3.5">
              <span className="text-xs font-mono font-bold text-zinc-400 uppercase flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-amber-500" /> Channel Chatter Logs
              </span>
              <button 
                onClick={() => setChatterLogs([
                  {
                    id: "clear-" + Date.now(),
                    operator: "SYSTEM",
                    text: "Radio memory logs purged.",
                    channel: channel,
                    isUser: false,
                    timestamp: "NOW",
                    signalStrength: 9
                  }
                ])}
                className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
                title="Purge channel memory logs"
              >
                <RotateCcw className="w-3 h-3" /> Clear Logs
              </button>
            </div>

            {/* Scrollable ticker terminal */}
            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5 text-xs font-mono scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
              {chatterLogs.map((log) => {
                const isSystem = log.operator === "SYSTEM";
                return (
                  <div 
                    key={log.id} 
                    className={`p-2.5 rounded-lg border text-left flex flex-col gap-1 transition ${
                      isSystem 
                        ? "bg-zinc-900/50 border-zinc-850 text-zinc-500 text-[10px]" 
                        : log.isUser 
                        ? "bg-amber-500/5 border-amber-500/20 text-amber-100" 
                        : "bg-[#0c0d10] border-zinc-850 text-zinc-300"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[9px] font-bold pb-1 border-b border-zinc-900/60 leading-none">
                      <div className="flex items-center gap-1.5">
                        <span className={log.isUser ? "text-amber-500" : "text-emerald-500"}>
                          {log.isUser ? "👤" : "📻"} {log.operator}
                        </span>
                        {!isSystem && (
                          <span className="bg-zinc-800/80 text-zinc-400 px-1.5 py-0.5 rounded text-[8px]">
                            CH-{log.channel < 10 ? "0" + log.channel : log.channel}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-zinc-500 font-normal">
                        {!isSystem && !log.isUser && (
                          <span className="text-[8px] text-amber-500/70">SIG: S{log.signalStrength}</span>
                        )}
                        <span>{log.timestamp}</span>
                      </div>
                    </div>
                    <div className="text-zinc-100 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap mt-0.5">
                      {log.text}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Dynamic band spectrum visual note footer */}
            <div className="mt-3.5 pt-2 border-t border-zinc-900 text-[10px] text-zinc-500 font-mono flex items-center justify-between card-footer">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> 
                ACTIVE CH-0{channel} FREQ
              </span>
              <span>{CHANNELS[channel - 1].label}</span>
            </div>

          </div>

        </div>

      </main>

      {/* FOOTER BRIDGING THE SPEC */}
      <footer className="w-full max-w-5xl mt-8 pt-4 border-t border-zinc-900 flex flex-col md:flex-row items-center justify-between text-xs text-zinc-500 font-mono gap-4">
        <p>© 2026 TRX CB-RADIO CORPORATION. HAM RADIO DSP INTERFACE MODEL 710.</p>
        <div className="flex gap-4">
          <a href="#automatic-frequency-scanner" className="hover:text-amber-500 transition">[VFO AUTO SCANNER]</a>
          <a href="#base-unit-chassis" className="hover:text-amber-500 transition">[MODEL DECK INPUT]</a>
          <a href="#smeter-chassis" className="hover:text-amber-500 transition">[SWR S-METER]</a>
        </div>
      </footer>

    </div>
  );
}
