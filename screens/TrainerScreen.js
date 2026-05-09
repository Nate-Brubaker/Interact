import { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated, Alert, SafeAreaView, Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder, useAudioRecorderState,
  requestRecordingPermissionsAsync, setAudioModeAsync,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSettings, INPUT_MODES } from '../lib/settings';
import { getProfile, calculateAge } from '../lib/profile';

const WAV_RECORDING_OPTIONS = {
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  isMeteringEnabled: true,
  android: { outputFormat: 'default', audioEncoder: 'default' },
  ios: {
    outputFormat: 'lpcm',
    audioQuality: 96,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/wav', bitsPerSecond: 256000 },
};

const SPEECH_DB    = -35;
const SILENCE_DB   = -42;
const SILENCE_MS   = 1800;
const MAX_RECORD_MS = 60000;
const COUNTDOWN_S  = 20;

const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();

// ─── Scenarios ────────────────────────────────────────────────────────────────

const SCENARIOS = [
  { id: 'job_interview', label: 'Job Interview',    desc: 'Answer tough interview questions',        icon: 'briefcase-outline',  color: '#6366F1' },
  { id: 'first_date',    label: 'First Date',       desc: 'Keep a natural, flowing conversation',    icon: 'heart-outline',      color: '#EC4899' },
  { id: 'networking',    label: 'Networking Event', desc: 'Meet professionals and make connections', icon: 'people-outline',     color: '#10B981' },
  { id: 'small_talk',    label: 'Small Talk',       desc: 'Chat comfortably with a stranger',        icon: 'chatbubble-outline', color: '#F59E0B' },
  { id: 'new_friends',   label: 'Making Friends',   desc: 'Meet someone new at a social gathering',  icon: 'person-add-outline', color: '#3B82F6' },
  { id: 'difficult',     label: 'Difficult Convo',  desc: 'Practice assertive communication',        icon: 'flash-outline',      color: '#EF4444' },
];

const FIRST_MEETING_SCENARIOS = new Set(['first_date', 'networking', 'small_talk', 'new_friends']);

function getRolePrompt(id) {
  return {
    job_interview: `You are Marcus, a no-nonsense senior engineering manager at a mid-size tech company. You've interviewed hundreds of candidates and have little patience for vague, rehearsed, or buzzword-heavy answers. You're not mean, but you're direct — if an answer is weak you say so. You interrupt or redirect if someone starts rambling. You have high standards and the candidate needs to earn your respect.`,
    first_date:    `You are Jamie, on a first date at a coffee shop. You're genuinely interested but not a pushover — if the conversation gets boring or one-sided you'll say so. You're witty, a little sarcastic, and quick to call out awkward silences or weird comments. You want the date to go well but you're not going to fake it.`,
    networking:    `You are Dana, a product director at a startup. You're at a networking event and have about five minutes before you need to move on. You're friendly but busy — if someone is wasting your time with small talk you'll steer it somewhere useful. You respect people who are direct and know what they want.`,
    small_talk:    `You are a regular person — let's say Alex — waiting in line or sitting nearby somewhere. You're open to chatting but have normal human reactions: if someone is weird or dull you'll give short answers and mentally check out. If the conversation is good you'll open up.`,
    new_friends:   `You are Sam, meeting someone new at a friend's party. You're warm but not a golden retriever — you won't just agree with everything. If someone is being awkward or weird you'll notice and react like a normal person would. You want to actually connect, not just exchange pleasantries.`,
    difficult:     `You are a colleague named Chris who needs to have a hard conversation — maybe about a missed deadline, a conflict, or a performance issue. You stay calm but you're firm. You don't accept non-answers or deflection. If the other person tries to dodge the issue or gets defensive, you push back clearly.`,
  }[id] ?? 'You are having a casual conversation. Be a real human — imperfect, direct, and honest.';
}

function buildProfileContext(scenarioId, profile) {
  if (!profile) return '';
  if (FIRST_MEETING_SCENARIOS.has(scenarioId)) {
    return `\nYou don't know this person's name yet — ask for it naturally early in the conversation if the opportunity arises. Do NOT use "[Name]" or any placeholder.`;
  }
  if (!profile.firstName) return '';
  const age = calculateAge(profile.dob);
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  return `\nThe person you're speaking with is ${name}${age ? `, ${age} years old` : ''}. Use their name naturally where it fits — don't overdo it.`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractJSON(raw) {
  let s = raw
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .replace(/[""]/g, '"')
    .trim();
  const start = s.search(/[{[]/);
  const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchGPT(messages, model = 'gpt-4o', maxTokens = 200) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI ${res.status}: ${err?.error?.message ?? 'unknown error'}`);
  }
  return res.json();
}

async function getOpeningLine(scenarioId, profile) {
  const system = getRolePrompt(scenarioId) + buildProfileContext(scenarioId, profile);
  const data = await fetchGPT([
    { role: 'system', content: system },
    { role: 'user',   content: 'Open the conversation naturally in 1-2 sentences. Sound like a real person — not scripted. End with a direct question so the other person knows what to respond to. Reply with only that opening.' },
  ], 'gpt-4o', 120);
  return data.choices[0].message.content.trim();
}

async function processAudioTurn(base64Audio, ext, scenarioId, history, profile) {
  const systemPrompt = `${getRolePrompt(scenarioId)}${buildProfileContext(scenarioId, profile)}

Stay in character at all times. You are also secretly scoring the user's speech delivery.

Return a JSON object with EXACTLY these fields — no extra fields, no prose outside the JSON:
- "unclear": true ONLY if the audio is physically inaudible or totally unintelligible. If you can make out any words, set this to false. If true, all other fields are null.
- "endConversation": true if the user is being offensive/rude to you, OR if they are clearly not engaging (repeating one word, saying random letters, gibberish, one-syllable non-answers two turns in a row). If true, write a short in-character goodbye that fits the situation and set analysis fields to null.
- "reply": Respond as your character — a real, specific human, not a generic assistant. Use contractions, incomplete thoughts, natural reactions. React to what they ACTUALLY said — don't be generic. If their answer is weak, vague, or off-topic, say so bluntly. If it's good, acknowledge it briefly then push further. Do NOT be encouraging for bad answers. Do NOT always end with a question — sometimes a short reaction is enough and a follow-up comes naturally. Vary your sentence length. (null if unclear)
- "userTranscript": exact verbatim transcription of what the user said (null if unclear)
- "userSummary": 6-10 word summary of what the user said (null if unclear)
- "analysis": { "fillerWords": [array of filler words used], "pace": "too fast"|"good"|"too slow", "confidence": 1-10, "notes": "one blunt, specific observation about their delivery" } (null if unclear)

Return ONLY valid JSON. No extra text.`;

  const data = await fetchGPT(
    [
      { role: 'system', content: systemPrompt },
      ...history,
      {
        role: 'user',
        content: [
          { type: 'input_audio', input_audio: { data: base64Audio, format: ext } },
          { type: 'text', text: 'Respond to what I just said.' },
        ],
      },
    ],
    'gpt-4o-audio-preview',
    450,
  );

  const raw = data.choices[0].message.content.trim();
  try {
    return extractJSON(raw);
  } catch {
    return { reply: raw, userSummary: 'spoke', analysis: { fillerWords: [], pace: 'good', confidence: 7, notes: '' } };
  }
}

async function generateStats(scenarioId, analyses) {
  const scenarioLabel = SCENARIOS.find(s => s.id === scenarioId)?.label ?? scenarioId;
  const data = await fetchGPT(
    [
      {
        role: 'user',
        content:
          `These are per-turn speech analyses from a "${scenarioLabel}" practice conversation:\n` +
          JSON.stringify(analyses) +
          `\n\nEach turn may include "responseTimeMs" — ms the user took to respond after the AI finished. ` +
          `Under 3000ms = quick, 3000-6000ms = normal, over 6000ms = slow.\n\n` +
          `Return a JSON object with:\n` +
          `- "grade": letter grade A+ to F\n` +
          `- "gradeDesc": one sentence describing the grade\n` +
          `- "totalFillers": number\n` +
          `- "topFillers": top 2-3 filler words as a string (e.g. "um, like")\n` +
          `- "pace": overall pace summary string\n` +
          `- "avgConfidence": number 1-10 rounded to 1 decimal\n` +
          `- "avgResponseTime": average response time in seconds (1 decimal), or null if no data\n` +
          `- "responsivenessNote": one sentence about how quickly they responded\n` +
          `- "strongestMoment": string\n` +
          `- "improvements": array of exactly 2 strings\n` +
          `- "overallAssessment": 2-sentence paragraph\n\n` +
          `Return ONLY valid JSON.`,
      },
    ],
    'gpt-4o',
    600,
  );
  const raw = data.choices[0].message.content.trim();
  try {
    return extractJSON(raw);
  } catch (e) {
    throw new Error('Could not parse stats: ' + e.message + '\n\nRaw: ' + raw.slice(0, 200));
  }
}

// ─── Small animated components ────────────────────────────────────────────────

function WaveBars({ active }) {
  const bars = useRef([0.3, 0.75, 0.5, 0.9, 0.4].map(v => new Animated.Value(v))).current;
  const loopsRef = useRef([]);
  useEffect(() => {
    loopsRef.current.forEach(l => l?.stop());
    if (active) {
      loopsRef.current = bars.map((bar, i) => {
        const dur = 300 + i * 65;
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(bar, { toValue: 1,    duration: dur, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
            Animated.timing(bar, { toValue: 0.08, duration: dur, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          ])
        );
        loop.start();
        return loop;
      });
    } else {
      loopsRef.current = [];
      bars.forEach((bar, i) =>
        Animated.spring(bar, { toValue: [0.3, 0.75, 0.5, 0.9, 0.4][i], useNativeDriver: true }).start()
      );
    }
  }, [active]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 48 }}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={{
            width: 4, height: 36, borderRadius: 2,
            backgroundColor: '#4F46E5',
            transform: [{ scaleY: bar }],
          }}
        />
      ))}
    </View>
  );
}

function FadeSlide({ fromRight, delay = 0, children }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1, useNativeDriver: true,
      tension: 60, friction: 10, delay,
    }).start();
  }, []);
  return (
    <Animated.View style={{
      opacity: anim,
      transform: [{
        translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [fromRight ? 18 : -18, 0] }),
      }],
    }}>
      {children}
    </Animated.View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TrainerScreen() {
  const [phase, setPhase] = useState('selecting');
  const [scenario, setScenario] = useState(null);
  const [messages, setMessages] = useState([]);
  const [gptHistory, setGptHistory] = useState([]);
  const [analyses, setAnalyses] = useState([]);
  const [stats, setStats] = useState(null);
  const [recStatus, setRecStatus] = useState('idle');
  const [inputMode, setInputMode] = useState(INPUT_MODES.AUTO_VAD);
  const [countdown, setCountdown] = useState(COUNTDOWN_S);
  const [responseElapsed, setResponseElapsed] = useState(0);
  const [earlyEnded, setEarlyEnded] = useState(false);

  const insets      = useSafeAreaInsets();
  const recorder    = useAudioRecorder(WAV_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 150);
  const scrollRef   = useRef(null);

  // Animation refs
  const cardAnims    = useRef(SCENARIOS.map(() => new Animated.Value(0))).current;
  const headerAnim   = useRef(new Animated.Value(0)).current;
  const gradeAnim    = useRef(new Animated.Value(0)).current;
  const statsAnims   = useRef(Array.from({ length: 6 }, () => new Animated.Value(0))).current;
  const ringAnim     = useRef(new Animated.Value(0)).current;
  const ringLoopRef  = useRef(null);

  // Recording timing refs
  const recordingStartRef  = useRef(null);
  const responseShownAtRef = useRef(null); // when AI text appears (for mode 3 timer)
  const speechStartRef     = useRef(null); // when user taps mic (mode 3)
  const speechDetectedRef  = useRef(false);
  const silenceStartRef    = useRef(null);
  const autoStoppingRef    = useRef(false);
  const maxRecTimerRef     = useRef(null);
  const countdownTimerRef  = useRef(null);
  const responseTimerRef   = useRef(null);
  const autoStartTimerRef  = useRef(null);
  const typewriterRef      = useRef(null);
  const profileRef         = useRef(null);

  // Mirror refs
  const inputModeRef  = useRef(INPUT_MODES.AUTO_VAD);
  const recStatusRef  = useRef('idle');
  useEffect(() => { inputModeRef.current = inputMode; }, [inputMode]);
  useEffect(() => { recStatusRef.current = recStatus; }, [recStatus]);

  useFocusEffect(
    useCallback(() => {
      getSettings().then(s => setInputMode(s.inputMode));
    }, [])
  );

  // Scenario card entrance
  useEffect(() => {
    if (phase === 'selecting') {
      headerAnim.setValue(0);
      cardAnims.forEach(a => a.setValue(0));
      Animated.sequence([
        Animated.timing(headerAnim, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.stagger(55, cardAnims.map(a =>
          Animated.spring(a, { toValue: 1, tension: 55, friction: 9, useNativeDriver: true })
        )),
      ]).start();
    }
  }, [phase]);

  // Stats entrance
  useEffect(() => {
    if (phase === 'stats') {
      gradeAnim.setValue(0);
      statsAnims.forEach(a => a.setValue(0));
      Animated.sequence([
        Animated.spring(gradeAnim, { toValue: 1, tension: 40, friction: 6, useNativeDriver: true }),
        Animated.stagger(70, statsAnims.map(a =>
          Animated.spring(a, { toValue: 1, tension: 55, friction: 9, useNativeDriver: true })
        )),
      ]).start();
    }
  }, [phase]);

  // Mic ring pulse (mode 3 recording)
  useEffect(() => {
    ringLoopRef.current?.stop();
    if (recStatus === 'recording' && inputMode === INPUT_MODES.PUSH_TO_SPEAK) {
      ringAnim.setValue(0);
      ringLoopRef.current = Animated.loop(
        Animated.timing(ringAnim, {
          toValue: 1, duration: 900,
          useNativeDriver: true, easing: Easing.out(Easing.ease),
        })
      );
      ringLoopRef.current.start();
    } else {
      ringAnim.setValue(0);
    }
    return () => ringLoopRef.current?.stop();
  }, [recStatus, inputMode]);

  // VAD silence detection (mode 1)
  useEffect(() => {
    if (inputModeRef.current !== INPUT_MODES.AUTO_VAD) return;
    if (recStatusRef.current !== 'recording') return;
    const db = recorderState.metering ?? -160;
    if (!speechDetectedRef.current && db > SPEECH_DB) {
      speechDetectedRef.current = true;
      speechStartRef.current = Date.now();
      silenceStartRef.current = null;
    }
    if (speechDetectedRef.current) {
      if (db < SILENCE_DB) {
        if (!silenceStartRef.current) silenceStartRef.current = Date.now();
        else if (Date.now() - silenceStartRef.current > SILENCE_MS && !autoStoppingRef.current) {
          autoStoppingRef.current = true;
          stopRecording();
        }
      } else {
        silenceStartRef.current = null;
      }
    }
  }, [recorderState.metering]);

  // Countdown (mode 2)
  useEffect(() => {
    if (inputMode !== INPUT_MODES.AUTO_COUNTDOWN || recStatus !== 'recording') {
      clearInterval(countdownTimerRef.current);
      return;
    }
    setCountdown(COUNTDOWN_S);
    countdownTimerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownTimerRef.current);
          if (!autoStoppingRef.current) { autoStoppingRef.current = true; stopRecording(); }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(countdownTimerRef.current);
  }, [recStatus, inputMode]);

  // Response timer (mode 3) — counts up while user is idle after seeing AI text
  useEffect(() => {
    clearInterval(responseTimerRef.current);
    if (inputMode !== INPUT_MODES.PUSH_TO_SPEAK || phase !== 'conversation' || recStatus !== 'idle') {
      if (recStatus !== 'idle') setResponseElapsed(0);
      return;
    }
    responseTimerRef.current = setInterval(() => setResponseElapsed(p => p + 1), 1000);
    return () => clearInterval(responseTimerRef.current);
  }, [recStatus, inputMode, phase]);

  // ── Core functions ────────────────────────────────────────────────────────

  function scheduleAutoStart() {
    clearTimeout(autoStartTimerRef.current);
    autoStartTimerRef.current = setTimeout(() => {
      if (recStatusRef.current === 'idle') startRecording();
    }, 1500);
  }

  function typewriteLastMessage(fullText, onDone) {
    clearTimeout(typewriterRef.current);
    let idx = 0;
    const step = () => {
      idx++;
      setMessages(prev => {
        if (!prev.length) return prev;
        const copy = [...prev];
        copy[copy.length - 1] = { ...copy[copy.length - 1], text: fullText.slice(0, idx) };
        return copy;
      });
      if (idx < fullText.length) typewriterRef.current = setTimeout(step, 10);
      else onDone?.();
    };
    step();
  }

  async function startConversation(s) {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      Alert.alert('Microphone access needed', 'Enable microphone permission in your device settings.');
      return;
    }
    clearTimeout(autoStartTimerRef.current);
    setScenario(s);
    setPhase('conversation');
    setMessages([]);
    setGptHistory([]);
    setAnalyses([]);
    setRecStatus('idle');
    setResponseElapsed(0);
    setEarlyEnded(false);
    try {
      profileRef.current = await getProfile();
      const opening = await getOpeningLine(s.id, profileRef.current);
      setMessages([{ role: 'ai', text: '' }]);
      setGptHistory([{ role: 'assistant', content: opening }]);
      setRecStatus('typing');
      typewriteLastMessage(opening, () => {
        setRecStatus('idle');
        responseShownAtRef.current = Date.now();
        if (inputModeRef.current === INPUT_MODES.AUTO_VAD ||
            inputModeRef.current === INPUT_MODES.AUTO_COUNTDOWN) {
          scheduleAutoStart();
        }
      });
    } catch (e) {
      Alert.alert('Could not start conversation', e.message);
      setPhase('selecting');
    }
  }

  async function startRecording() {
    if (recStatusRef.current !== 'idle') return;
    speechDetectedRef.current = false;
    silenceStartRef.current   = null;
    autoStoppingRef.current   = false;
    speechStartRef.current    = null;
    if (inputModeRef.current === INPUT_MODES.PUSH_TO_SPEAK) {
      speechStartRef.current = Date.now();
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingStartRef.current = Date.now();
      setRecStatus('recording');
      maxRecTimerRef.current = setTimeout(() => {
        if (!autoStoppingRef.current && recStatusRef.current === 'recording') {
          autoStoppingRef.current = true;
          stopRecording();
        }
      }, MAX_RECORD_MS);
    } catch (e) {
      Alert.alert('Could not start recording', e.message);
    }
  }

  async function stopRecording() {
    clearTimeout(maxRecTimerRef.current);
    clearInterval(countdownTimerRef.current);
    const duration = Date.now() - (recordingStartRef.current ?? Date.now());
    setRecStatus('processing');
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      if (duration < 1200) { setRecStatus('idle'); autoStoppingRef.current = false; return; }
      const uri = recorder.uri;
      if (!uri) throw new Error('No audio recorded.');
      const base64Audio = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const ext = uri.split('.').pop()?.toLowerCase() ?? 'wav';
      let responseTimeMs = null;
      if (responseShownAtRef.current && speechStartRef.current) {
        responseTimeMs = Math.max(0, speechStartRef.current - responseShownAtRef.current);
      }
      const result = await processAudioTurn(base64Audio, ext, scenario.id, gptHistory, profileRef.current);

      if (result.unclear) {
        setMessages(prev => [...prev, { role: 'info', text: "Couldn't hear that clearly — please speak up and try again." }]);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
        setRecStatus('idle');
        if (inputModeRef.current === INPUT_MODES.AUTO_VAD ||
            inputModeRef.current === INPUT_MODES.AUTO_COUNTDOWN) {
          scheduleAutoStart();
        }
        return;
      }

      const { reply, userTranscript, userSummary, analysis, endConversation: shouldEnd } = result;
      const enrichedAnalysis = { ...analysis, responseTimeMs };
      setMessages(prev => [...prev, { role: 'user', text: userSummary }, { role: 'ai', text: '' }]);
      setGptHistory(prev => [...prev,
        { role: 'user',      content: userTranscript ?? userSummary },
        { role: 'assistant', content: reply },
      ]);
      setAnalyses(prev => [...prev, enrichedAnalysis]);
      setResponseElapsed(0);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      typewriteLastMessage(reply, () => {
        setRecStatus('idle');
        if (shouldEnd) {
          setEarlyEnded(true);
          return;
        }
        responseShownAtRef.current = Date.now();
        if (inputModeRef.current === INPUT_MODES.AUTO_VAD ||
            inputModeRef.current === INPUT_MODES.AUTO_COUNTDOWN) {
          scheduleAutoStart();
        }
      });
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
      setRecStatus('idle');
    } finally {
      autoStoppingRef.current = false;
      speechStartRef.current  = null;
    }
  }

  async function endConversation() {
    clearTimeout(autoStartTimerRef.current);
    clearTimeout(maxRecTimerRef.current);
    clearInterval(countdownTimerRef.current);
    clearInterval(responseTimerRef.current);
    if (recStatusRef.current === 'recording') {
      await recorder.stop().catch(() => {});
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    }
    if (analyses.length === 0) { setPhase('selecting'); return; }
    setPhase('analyzing');
    try {
      const result = await generateStats(scenario.id, analyses);
      setStats(result);
      setPhase('stats');
    } catch (e) {
      Alert.alert('Could not generate stats', e.message);
      setPhase('selecting');
    }
  }

  function reset() {
    setPhase('selecting');
    setScenario(null);
    setMessages([]);
    setGptHistory([]);
    setAnalyses([]);
    setStats(null);
    setRecStatus('idle');
    setEarlyEnded(false);
  }

  // ── Render: selecting ─────────────────────────────────────────────────────

  if (phase === 'selecting') {
    return (
      <ScrollView style={S.container} contentContainerStyle={S.selectContent} showsVerticalScrollIndicator={false}>
        <Animated.View style={{
          opacity: headerAnim,
          transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
        }}>
          <Text style={S.selectTitle}>Choose a Scenario</Text>
          <Text style={S.selectSub}>Pick what you want to practice</Text>
        </Animated.View>

        {SCENARIOS.map((s, i) => (
          <Animated.View key={s.id} style={{
            opacity: cardAnims[i],
            transform: [{ translateY: cardAnims[i].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          }}>
            <TouchableOpacity style={S.scenarioCard} onPress={() => startConversation(s)} activeOpacity={0.7}>
              <View style={[S.scenarioAccent, { backgroundColor: s.color }]} />
              <View style={[S.scenarioIconWrap, { backgroundColor: s.color + '18' }]}>
                <Ionicons name={s.icon} size={20} color={s.color} />
              </View>
              <View style={S.scenarioBody}>
                <Text style={S.scenarioLabel}>{s.label}</Text>
                <Text style={S.scenarioDesc}>{s.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
            </TouchableOpacity>
          </Animated.View>
        ))}
      </ScrollView>
    );
  }

  // ── Render: analyzing ─────────────────────────────────────────────────────

  if (phase === 'analyzing') {
    return (
      <View style={S.centerScreen}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={S.analyzingText}>Analyzing your conversation...</Text>
      </View>
    );
  }

  // ── Render: stats ─────────────────────────────────────────────────────────

  if (phase === 'stats' && stats) {
    const gradeColor =
      stats.grade?.startsWith('A') ? '#22C55E' :
      stats.grade?.startsWith('B') ? '#4F46E5' :
      stats.grade?.startsWith('C') ? '#F97316' : '#EF4444';

    const sa = i => ({
      opacity: statsAnims[i],
      transform: [{ translateY: statsAnims[i].interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
    });

    return (
      <ScrollView style={S.container} contentContainerStyle={S.statsContent} showsVerticalScrollIndicator={false}>
        <Text style={S.statsHeading}>Session Complete</Text>
        <Text style={S.statsScenario}>{scenario?.label}</Text>

        <Animated.View style={[S.gradeCircle, { borderColor: gradeColor }, {
          transform: [{ scale: gradeAnim }], opacity: gradeAnim,
        }]}>
          <Text style={[S.gradeText, { color: gradeColor }]}>{stats.grade}</Text>
        </Animated.View>
        <Text style={S.gradeDesc}>{stats.gradeDesc}</Text>

        <Animated.View style={[S.statsGrid, sa(0)]}>
          {[
            { value: stats.totalFillers ?? 0, label: 'Filler Words', sub: stats.topFillers ? `"${stats.topFillers}"` : null },
            { value: stats.avgConfidence ?? '—', label: 'Confidence', sub: 'out of 10' },
            {
              value: stats.pace?.toLowerCase().includes('fast') ? 'Fast'
                : stats.pace?.toLowerCase().includes('slow') ? 'Slow' : 'Good',
              label: 'Pace',
              sub: null,
            },
          ].map((item, i) => (
            <View key={i} style={S.statBox}>
              <Text style={S.statValue}>{item.value}</Text>
              <Text style={S.statLabel}>{item.label}</Text>
              {item.sub ? <Text style={S.statSub}>{item.sub}</Text> : null}
            </View>
          ))}
        </Animated.View>

        {stats.avgResponseTime != null && (
          <Animated.View style={[S.responseCard, sa(1)]}>
            <Text style={S.calloutLabel}>RESPONSE SPEED</Text>
            <Text style={[S.responseTime, { color: stats.avgResponseTime > 6 ? '#EF4444' : '#22C55E' }]}>
              {stats.avgResponseTime}s avg
            </Text>
            {stats.responsivenessNote ? <Text style={S.calloutText}>{stats.responsivenessNote}</Text> : null}
          </Animated.View>
        )}

        {stats.strongestMoment ? (
          <Animated.View style={[S.calloutCard, sa(2)]}>
            <Text style={S.calloutLabel}>STRONGEST MOMENT</Text>
            <Text style={S.calloutText}>{stats.strongestMoment}</Text>
          </Animated.View>
        ) : null}

        {stats.improvements?.length > 0 && (
          <Animated.View style={[S.improvementsCard, sa(3)]}>
            <Text style={S.calloutLabel}>WORK ON</Text>
            {stats.improvements.map((item, i) => (
              <View key={i} style={S.improvRow}>
                <View style={S.improvDot} />
                <Text style={S.improvText}>{item}</Text>
              </View>
            ))}
          </Animated.View>
        )}

        {stats.overallAssessment ? (
          <Animated.View style={sa(4)}>
            <Text style={S.overallText}>{stats.overallAssessment}</Text>
          </Animated.View>
        ) : null}

        <Animated.View style={[S.statsButtons, sa(5)]}>
          <TouchableOpacity style={S.btnSecondary} onPress={() => startConversation(scenario)}>
            <Text style={S.btnSecondaryText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.btnPrimary} onPress={reset}>
            <Text style={S.btnPrimaryText}>New Scenario</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    );
  }

  // ── Render: conversation ──────────────────────────────────────────────────

  const scenarioColor = scenario ? (SCENARIOS.find(s => s.id === scenario.id)?.color ?? '#4F46E5') : '#4F46E5';

  function renderFooter() {
    if (earlyEnded) return null;

    if (recStatus === 'processing') {
      return (
        <View style={S.footerCenter}>
          <ActivityIndicator size="small" color="#4F46E5" />
          <Text style={S.footerLabel}>Processing...</Text>
        </View>
      );
    }

    if (inputMode === INPUT_MODES.AUTO_VAD) {
      if (recStatus === 'recording') {
        return (
          <View style={S.footerCenter}>
            <WaveBars active />
            <Text style={S.footerLabel}>Listening</Text>
            <TouchableOpacity style={S.ghostBtn} onPress={() => {
              if (!autoStoppingRef.current) { autoStoppingRef.current = true; stopRecording(); }
            }}>
              <Text style={S.ghostBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        );
      }
      return <Text style={S.footerLabel}>{recStatus === 'processing' ? 'Processing…' : 'Get ready…'}</Text>;
    }

    if (inputMode === INPUT_MODES.AUTO_COUNTDOWN) {
      if (recStatus === 'recording') {
        const urgent = countdown <= 5;
        return (
          <View style={S.footerCenter}>
            <Text style={[S.countdownNum, urgent && S.countdownUrgent]}>{countdown}</Text>
            <Text style={S.footerLabel}>seconds remaining</Text>
            <TouchableOpacity style={S.submitBtn} onPress={() => {
              if (!autoStoppingRef.current) { autoStoppingRef.current = true; stopRecording(); }
            }}>
              <Text style={S.submitBtnText}>Submit</Text>
            </TouchableOpacity>
          </View>
        );
      }
      return <Text style={S.footerLabel}>{recStatus === 'processing' ? 'Processing…' : 'Get ready…'}</Text>;
    }

    // Mode 3: push to speak
    const isTyping = recStatus === 'typing';
    return (
      <View style={S.footerCenter}>
        <View style={S.micWrap}>
          {recStatus === 'recording' && (
            <Animated.View style={[S.micRing, {
              opacity: ringAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.45, 0.1, 0] }),
              transform: [{ scale: ringAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
            }]} />
          )}
          <TouchableOpacity
            style={[S.micBtn, recStatus === 'recording' && S.micBtnActive, isTyping && S.micBtnDisabled]}
            onPress={recStatus === 'idle' ? startRecording : recStatus === 'recording' ? stopRecording : null}
            activeOpacity={isTyping ? 1 : 0.85}
            disabled={isTyping}
          >
            <Ionicons
              name={recStatus === 'recording' ? 'stop' : 'mic'}
              size={26}
              color="#fff"
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={S.container}>
      <View style={S.convHeader}>
        <View style={S.convHeaderLeft}>
          <View style={[S.scenarioDot, { backgroundColor: scenarioColor }]} />
          <Text style={S.convTitle}>{scenario?.label}</Text>
        </View>
        <TouchableOpacity style={S.endBtn} onPress={endConversation}>
          <Text style={S.endBtnText}>End</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={S.scroll}
        contentContainerStyle={S.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {messages.map((msg, i) => {
          if (msg.role === 'info') {
            return (
              <FadeSlide key={i} fromRight={false} delay={0}>
                <View style={S.infoPill}>
                  <Ionicons name="alert-circle-outline" size={14} color="#94A3B8" />
                  <Text style={S.infoPillText}>{msg.text}</Text>
                </View>
              </FadeSlide>
            );
          }
          return (
            <FadeSlide key={i} fromRight={msg.role === 'user'} delay={0}>
              <View style={[S.row, msg.role === 'user' && S.rowUser]}>
                {msg.role === 'ai' && (
                  <View style={[S.avatar, { backgroundColor: scenarioColor }]}>
                    <Text style={S.avatarText}>J</Text>
                  </View>
                )}
                <View style={msg.role === 'ai' ? S.bubbleAI : S.bubbleUser}>
                  {msg.role === 'user' && <Text style={S.youLabel}>YOU</Text>}
                  <Text style={[S.bubbleText, msg.role === 'user' && S.bubbleTextUser]}>
                    {msg.text}
                  </Text>
                </View>
              </View>
            </FadeSlide>
          );
        })}

      </ScrollView>

      {!earlyEnded && (
        <View style={[S.footer, { bottom: 90 }]}>
          {renderFooter()}
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FF' },

  // Selecting
  selectContent: { padding: 20, paddingBottom: 110 },
  selectTitle: { fontSize: 26, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  selectSub:   { fontSize: 14, color: '#64748B', marginBottom: 28 },
  scenarioCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 16, marginBottom: 10, overflow: 'hidden',
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  scenarioAccent: { width: 3, alignSelf: 'stretch' },
  scenarioIconWrap: {
    width: 40, height: 40, borderRadius: 12, margin: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  scenarioBody: { flex: 1, paddingVertical: 16, paddingRight: 4 },
  scenarioLabel: { fontSize: 15, fontWeight: '700', color: '#0F172A', marginBottom: 2 },
  scenarioDesc:  { fontSize: 12, color: '#94A3B8' },

  // Conversation
  convHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  convHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scenarioDot: { width: 8, height: 8, borderRadius: 4 },
  convTitle:   { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  endBtn:      { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: '#FEF2F2' },
  endBtnText:  { color: '#EF4444', fontWeight: '600', fontSize: 13 },

  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 180, gap: 10 },

  row:     { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowUser: { justifyContent: 'flex-end' },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  bubbleAI: {
    flex: 1, backgroundColor: '#fff', borderRadius: 18, borderBottomLeftRadius: 4,
    paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  bubbleUser: {
    maxWidth: '76%', backgroundColor: '#4F46E5',
    borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10,
  },
  bubbleText:     { fontSize: 15, color: '#0F172A', lineHeight: 22 },
  bubbleTextUser: { color: '#fff' },
  youLabel: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.8, marginBottom: 3 },

  infoPill: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center',
    gap: 6, backgroundColor: '#F1F5F9', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  infoPillText: { fontSize: 13, color: '#94A3B8', fontWeight: '500' },

  // Footer
  footer: {
    position: 'absolute', left: 0, right: 0,
    paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center',
  },
  footerCenter: { alignItems: 'center', gap: 8 },
  footerLabel:  { fontSize: 13, color: '#94A3B8', fontWeight: '500' },

  // Wave / auto modes
  ghostBtn:     { marginTop: 4, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: '#EEF2FF' },
  ghostBtnText: { color: '#4F46E5', fontWeight: '600', fontSize: 13 },

  countdownNum:   { fontSize: 48, fontWeight: '800', color: '#4F46E5', lineHeight: 56 },
  countdownUrgent:{ color: '#EF4444' },
  submitBtn:      { marginTop: 4, paddingHorizontal: 28, paddingVertical: 10, borderRadius: 12, backgroundColor: '#4F46E5' },
  submitBtnText:  { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Mode 3
  timerNum:  { fontSize: 38, fontWeight: '800', color: '#4F46E5', lineHeight: 44 },
  timerSlow: { color: '#EF4444' },
  micWrap:   { position: 'relative', alignItems: 'center', justifyContent: 'center', width: 70, height: 70 },
  micRing: {
    position: 'absolute',
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#EF4444',
  },
  micBtn: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: '#4F46E5',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#4F46E5', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  micBtnActive:   { backgroundColor: '#EF4444', shadowColor: '#EF4444' },
  micBtnDisabled: { backgroundColor: '#C7D2FE', shadowOpacity: 0, elevation: 0 },

  // Analyzing
  centerScreen:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: '#F8F9FF' },
  analyzingText: { fontSize: 15, color: '#64748B', fontWeight: '500' },

  // Stats
  statsContent: { padding: 20, paddingBottom: 110, alignItems: 'center' },
  statsHeading: { fontSize: 24, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  statsScenario:{ fontSize: 13, color: '#94A3B8', marginBottom: 28 },
  gradeCircle: {
    width: 104, height: 104, borderRadius: 52, borderWidth: 4,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  gradeText: { fontSize: 40, fontWeight: '800' },
  gradeDesc: { fontSize: 14, color: '#64748B', marginBottom: 24, textAlign: 'center', lineHeight: 20 },

  statsGrid: { flexDirection: 'row', gap: 10, marginBottom: 10, width: '100%' },
  statBox: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center',
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  statValue: { fontSize: 22, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  statLabel: { fontSize: 11, fontWeight: '600', color: '#64748B', textAlign: 'center' },
  statSub:   { fontSize: 10, color: '#94A3B8', textAlign: 'center', marginTop: 2 },

  responseCard: {
    backgroundColor: '#F0FDF4', borderRadius: 14, padding: 16,
    width: '100%', marginBottom: 10, alignItems: 'center',
  },
  responseTime: { fontSize: 28, fontWeight: '800', marginBottom: 4 },

  calloutCard: {
    backgroundColor: '#EEF2FF', borderRadius: 14, padding: 16, width: '100%', marginBottom: 10,
  },
  improvementsCard: {
    backgroundColor: '#FFF7ED', borderRadius: 14, padding: 16, width: '100%', marginBottom: 10,
  },
  calloutLabel: { fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 1, marginBottom: 8 },
  calloutText:  { fontSize: 14, color: '#334155', lineHeight: 20 },

  improvRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  improvDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: '#F97316', marginTop: 7 },
  improvText: { flex: 1, fontSize: 14, color: '#334155', lineHeight: 20 },

  overallText: { fontSize: 14, color: '#64748B', lineHeight: 22, textAlign: 'center', marginBottom: 24, marginTop: 4 },

  statsButtons: { flexDirection: 'row', gap: 10, width: '100%' },
  btnPrimary:     { flex: 1, backgroundColor: '#4F46E5', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary:     { flex: 1, backgroundColor: '#EEF2FF', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnSecondaryText: { color: '#4F46E5', fontWeight: '700', fontSize: 15 },
});
