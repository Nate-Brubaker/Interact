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
import * as Speech from 'expo-speech';
import { useFocusEffect } from '@react-navigation/native';
import { getSettings, INPUT_MODES } from '../lib/settings';

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

function getRolePrompt(id) {
  return {
    job_interview: 'You are a hiring manager conducting a job interview. Be professional but approachable. Ask follow-up questions based on what the candidate says.',
    first_date:    'You are on a first date at a coffee shop. Be warm, curious, and slightly playful.',
    networking:    'You are at a professional networking event and just met this person. Be friendly and interested in what they do.',
    small_talk:    'You are a stranger making small talk in a casual setting. Be friendly and easy-going.',
    new_friends:   'You are meeting someone new at a social gathering. Be warm and genuinely interested.',
    difficult:     'You are a colleague having a difficult but important conversation. Stay calm, direct, and push back a little to practice assertive communication.',
  }[id] ?? 'You are having a casual conversation.';
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

async function getOpeningLine(scenarioId) {
  const data = await fetchGPT([
    { role: 'system', content: getRolePrompt(scenarioId) + ' Keep your opening to 1-2 sentences.' },
    { role: 'user',   content: 'Start the conversation with a natural opening line. Reply with only that line.' },
  ]);
  return data.choices[0].message.content.trim();
}

async function processAudioTurn(base64Audio, ext, scenarioId, history) {
  const systemPrompt = `${getRolePrompt(scenarioId)}

You are also secretly analyzing the user's speech delivery. Return a JSON object with exactly these fields:
- "reply": your natural 1-2 sentence conversational response as the character
- "userSummary": a 6-10 word summary of what the user said
- "analysis": { "fillerWords": [array of filler words heard], "pace": "too fast"|"good"|"too slow", "confidence": 1-10, "notes": "one specific observation about their vocal delivery" }

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
    350,
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

function TypingDots() {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.stagger(120,
        dots.map(d =>
          Animated.sequence([
            Animated.timing(d, { toValue: -5, duration: 220, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
            Animated.timing(d, { toValue: 0,  duration: 220, useNativeDriver: true, easing: Easing.in(Easing.ease) }),
          ])
        )
      )
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 5, paddingVertical: 6 }}>
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#CBD5E1', transform: [{ translateY: d }] }}
        />
      ))}
    </View>
  );
}

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
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [inputMode, setInputMode] = useState(INPUT_MODES.AUTO_VAD);
  const [countdown, setCountdown] = useState(COUNTDOWN_S);
  const [responseElapsed, setResponseElapsed] = useState(0);

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
  const aiFinishedAtRef    = useRef(null);
  const speechStartRef     = useRef(null);
  const speechDetectedRef  = useRef(false);
  const silenceStartRef    = useRef(null);
  const autoStoppingRef    = useRef(false);
  const maxRecTimerRef     = useRef(null);
  const countdownTimerRef  = useRef(null);
  const responseTimerRef   = useRef(null);
  const prevAiSpeakingRef  = useRef(false);

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

  // Polling fallback for aiSpeaking
  useEffect(() => {
    if (!aiSpeaking) return;
    const iv = setInterval(async () => {
      const speaking = await Speech.isSpeakingAsync();
      if (!speaking) {
        clearInterval(iv);
        if (!aiFinishedAtRef.current) aiFinishedAtRef.current = Date.now();
        setAiSpeaking(false);
      }
    }, 250);
    return () => clearInterval(iv);
  }, [aiSpeaking]);

  // Auto-start recording when AI finishes (modes 1 & 2)
  useEffect(() => {
    const was = prevAiSpeakingRef.current;
    prevAiSpeakingRef.current = aiSpeaking;
    if (was && !aiSpeaking && phase === 'conversation' && recStatusRef.current === 'idle') {
      if (inputModeRef.current === INPUT_MODES.AUTO_VAD ||
          inputModeRef.current === INPUT_MODES.AUTO_COUNTDOWN) {
        startRecording();
      }
    }
  }, [aiSpeaking]);

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

  // Response timer (mode 3)
  useEffect(() => {
    clearInterval(responseTimerRef.current);
    if (inputMode !== INPUT_MODES.PUSH_TO_SPEAK || phase !== 'conversation') {
      setResponseElapsed(0);
      return;
    }
    if (!aiSpeaking && recStatus === 'idle') {
      setResponseElapsed(0);
      responseTimerRef.current = setInterval(() => setResponseElapsed(p => p + 1), 1000);
    } else {
      setResponseElapsed(0);
    }
    return () => clearInterval(responseTimerRef.current);
  }, [aiSpeaking, recStatus, inputMode, phase]);

  // ── Core functions ────────────────────────────────────────────────────────

  function speakAI(text) {
    aiFinishedAtRef.current = null;
    setAiSpeaking(true);
    Speech.speak(text, {
      language: 'en-US', rate: 0.92, pitch: 1.0,
      onDone:    () => { aiFinishedAtRef.current = Date.now(); setAiSpeaking(false); },
      onStopped: () => { aiFinishedAtRef.current = Date.now(); setAiSpeaking(false); },
      onError:   () => { aiFinishedAtRef.current = Date.now(); setAiSpeaking(false); },
    });
  }

  async function startConversation(s) {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      Alert.alert('Microphone access needed', 'Enable microphone permission in your device settings.');
      return;
    }
    setScenario(s);
    setPhase('conversation');
    setMessages([]);
    setGptHistory([]);
    setAnalyses([]);
    setRecStatus('idle');
    aiFinishedAtRef.current = null;
    try {
      const opening = await getOpeningLine(s.id);
      setMessages([{ role: 'ai', text: opening }]);
      setGptHistory([{ role: 'assistant', content: opening }]);
      speakAI(opening);
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
    if (inputModeRef.current === INPUT_MODES.PUSH_TO_SPEAK && aiFinishedAtRef.current) {
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
      if (aiFinishedAtRef.current) {
        const at = speechStartRef.current ?? recordingStartRef.current ?? Date.now();
        responseTimeMs = Math.max(0, at - aiFinishedAtRef.current);
      }
      const result = await processAudioTurn(base64Audio, ext, scenario.id, gptHistory);
      const { reply, userSummary, analysis } = result;
      const enrichedAnalysis = { ...analysis, responseTimeMs };
      setMessages(prev => [...prev, { role: 'user', text: userSummary }, { role: 'ai', text: reply }]);
      setGptHistory(prev => [...prev,
        { role: 'user',      content: userSummary },
        { role: 'assistant', content: reply },
      ]);
      setAnalyses(prev => [...prev, enrichedAnalysis]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      speakAI(reply);
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
    } finally {
      setRecStatus('idle');
      autoStoppingRef.current  = false;
      aiFinishedAtRef.current  = null;
    }
  }

  async function endConversation() {
    Speech.stop();
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
    if (recStatus === 'processing') {
      return (
        <View style={S.footerCenter}>
          <ActivityIndicator size="small" color="#4F46E5" />
          <Text style={S.footerLabel}>Processing...</Text>
        </View>
      );
    }

    if (inputMode === INPUT_MODES.AUTO_VAD) {
      if (aiSpeaking) return <Text style={S.footerLabel}>Jordan is speaking</Text>;
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
      return <Text style={S.footerLabel}>Waiting...</Text>;
    }

    if (inputMode === INPUT_MODES.AUTO_COUNTDOWN) {
      if (aiSpeaking) return <Text style={S.footerLabel}>Jordan is speaking</Text>;
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
      return <Text style={S.footerLabel}>Waiting...</Text>;
    }

    // Mode 3: push to speak
    const slow = responseElapsed > 6;
    return (
      <View style={S.footerCenter}>
        {recStatus === 'idle' && !aiSpeaking && responseElapsed > 0 && (
          <Text style={[S.timerNum, slow && S.timerSlow]}>{responseElapsed}s</Text>
        )}
        <View style={S.micWrap}>
          {recStatus === 'recording' && (
            <Animated.View style={[S.micRing, {
              opacity: ringAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.45, 0.1, 0] }),
              transform: [{ scale: ringAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
            }]} />
          )}
          <TouchableOpacity
            style={[S.micBtn, recStatus === 'recording' && S.micBtnActive, aiSpeaking && S.micBtnDisabled]}
            onPress={recStatus === 'idle' ? startRecording : stopRecording}
            disabled={aiSpeaking}
            activeOpacity={0.85}
          >
            <Ionicons
              name={recStatus === 'recording' ? 'stop' : 'mic'}
              size={26}
              color={aiSpeaking ? '#A5B4FC' : '#fff'}
            />
          </TouchableOpacity>
        </View>
        <Text style={S.footerLabel}>
          {aiSpeaking ? 'Jordan is speaking'
            : recStatus === 'recording' ? 'Tap to stop'
            : 'Tap to speak'}
        </Text>
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
        {messages.map((msg, i) => (
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
        ))}

        {aiSpeaking && (
          <View style={S.row}>
            <View style={[S.avatar, { backgroundColor: scenarioColor }]}>
              <Text style={S.avatarText}>J</Text>
            </View>
            <View style={S.bubbleAI}>
              <TypingDots />
            </View>
          </View>
        )}
      </ScrollView>

      <View style={S.footer}>
        {renderFooter()}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FF' },

  // Selecting
  selectContent: { padding: 20, paddingBottom: 40 },
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
  scrollContent: { padding: 16, paddingBottom: 12, gap: 10 },

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

  // Footer
  footer: {
    backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#F1F5F9',
    paddingVertical: 20, paddingHorizontal: 20, alignItems: 'center',
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
  micWrap:   { position: 'relative', alignItems: 'center', justifyContent: 'center', width: 80, height: 80 },
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
  statsContent: { padding: 20, paddingBottom: 48, alignItems: 'center' },
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
