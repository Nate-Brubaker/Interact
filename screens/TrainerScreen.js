import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch,
  ActivityIndicator, Animated, Alert, SafeAreaView, Easing, Modal, PanResponder, Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder, useAudioRecorderState,
  requestRecordingPermissionsAsync, setAudioModeAsync,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { getSettings, saveSettings, INPUT_MODES, INTENSITIES, LANGUAGES, SESSION_LENGTHS, FOCUS_AREAS } from '../lib/settings';
import { useTheme, DARK } from '../lib/theme';
import { getProfile, calculateAge } from '../lib/profile';
import { saveSession, getSessions } from '../lib/sessions';

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

const SPEECH_DB      = -35;
const SILENCE_DB     = -42;
const SILENCE_MS     = 1500;
const MIN_SPEECH_MS  = 500;  // must speak for this long before silence detection activates
const MAX_RECORD_MS  = 60000;
const COUNTDOWN_S    = 20;

const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();

// ─── Scenarios ────────────────────────────────────────────────────────────────

const SCENARIOS = [
  { id: 'job_interview', label: 'Job Interview',    desc: 'Answer tough interview questions',        icon: 'briefcase-outline',  color: '#6366F1' },
  { id: 'networking',    label: 'Networking Event', desc: 'Meet professionals and make connections', icon: 'people-outline',     color: '#10B981' },
  { id: 'small_talk',    label: 'Small Talk',       desc: 'Chat comfortably with a stranger',        icon: 'chatbubble-outline', color: '#F59E0B' },
  { id: 'new_friends',   label: 'Making Friends',   desc: 'Meet someone new at a social gathering',  icon: 'person-add-outline', color: '#3B82F6' },
  { id: 'difficult',     label: 'Difficult Convo',  desc: 'Practice assertive communication',        icon: 'flash-outline',      color: '#EF4444' },
];

const FIRST_MEETING_SCENARIOS = new Set(['networking', 'small_talk', 'new_friends']);

function getRolePrompt(id) {
  return {
    job_interview: `You are Marcus, a senior engineering manager at a mid-size tech company. You've interviewed hundreds of candidates and have little patience for vague, rehearsed, or buzzword-heavy answers. You're not mean, but you're direct — if an answer is weak you say so. You interrupt or redirect if someone starts rambling. You have high standards and the candidate needs to earn your respect.`,
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

function buildBehaviorContext(settings) {
  if (!settings) return '';
  let ctx = '';

  const intensity = settings.intensity ?? INTENSITIES.STANDARD;
  if (intensity === INTENSITIES.RELAXED) {
    ctx += '\nBe patient and forgiving. Give the user time to think. Acknowledge genuine strengths before pointing out weaknesses. Avoid being overly critical.';
  } else if (intensity === INTENSITIES.STANDARD) {
    ctx += '\nHave balanced standards. Call out weak or vague answers directly without sugarcoating.';
  } else if (intensity === INTENSITIES.CHALLENGING) {
    ctx += '\nBe extremely critical and demanding. Aggressively challenge every weak or vague answer — do not let anything slide. Call out weaknesses directly.';
  } else if (intensity === INTENSITIES.REALISTIC) {
    ctx += '\nBe extremely demanding with very high standards. React completely naturally — no coaching commentary whatsoever. Just be the person in this scenario, a tough one.';
  }

  if (settings.language === LANGUAGES.SPANISH) {
    ctx += '\nConduct the entire conversation in Spanish only.';
  } else if (settings.language === LANGUAGES.FRENCH) {
    ctx += '\nConduct the entire conversation in French only.';
  }

  if (settings.focusArea) {
    const areaMap = { confidence: 'confidence', clarity: 'clarity and articulation', energy: 'energy and enthusiasm', specificity: 'specificity and use of concrete examples', activeListening: 'active listening' };
    ctx += `\nPay particular attention to the user's ${areaMap[settings.focusArea] ?? settings.focusArea}. React more visibly when it is strong or weak.`;
  }

  return ctx;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

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

async function getOpeningLine(scenarioId, profile, settings) {
  const system = getRolePrompt(scenarioId) + buildProfileContext(scenarioId, profile) + buildBehaviorContext(settings);
  const data = await fetchGPT([
    { role: 'system', content: system },
    { role: 'user',   content: 'Open the conversation naturally in 1-2 sentences. Sound like a real person — not scripted. End with a direct question so the other person knows what to respond to. Reply with only that opening.' },
  ], 'gpt-4o', 120);
  return data.choices[0].message.content.trim();
}

async function processAudioTurn(base64Audio, ext, scenarioId, history, profile, settings) {
  const systemPrompt = `${getRolePrompt(scenarioId)}${buildProfileContext(scenarioId, profile)}${buildBehaviorContext(settings)}

Stay in character at all times. You are also secretly scoring the user's speech delivery.

Return a JSON object with EXACTLY these fields — no extra fields, no prose outside the JSON:
- "unclear": true ONLY if the audio is physically inaudible or totally unintelligible. If you can make out any words, set this to false. If true, all other fields are null.
- "endConversation": true if the user is being offensive/rude to you, OR if they are clearly not engaging (repeating one word, saying random letters, gibberish, one-syllable non-answers two turns in a row). If true, write a short in-character goodbye that fits the situation and set analysis fields to null.
- "reply": Respond as your character — a real, specific human, not a generic assistant. Use contractions, incomplete thoughts, natural reactions. React to what they ACTUALLY said — don't be generic. If their answer is weak, vague, or off-topic, say so bluntly. If it's good, acknowledge it briefly then push further. Do NOT be encouraging for bad answers. Do NOT always end with a question — sometimes a short reaction is enough and a follow-up comes naturally. Vary your sentence length. (null if unclear)
- "userTranscript": exact verbatim transcription of what the user said (null if unclear)
- "userSummary": 6-10 word summary of what the user said (null if unclear)
- "analysis": { "fillerWords": [array of filler words used], "pace": "too fast"|"good"|"too slow", "confidence": 1-10, "confidenceNote": "one sentence — why this confidence score, quote specific words or tone", "clarity": 1-10, "clarityNote": "one sentence — why this clarity score, e.g. mumbling, trailing off, clear articulation", "energy": 1-10, "energyNote": "one sentence — why this energy score, reference their vocal tone/pace/engagement", "specificity": 1-10, "specificityNote": "one sentence — why this specificity score, quote or reference what was vague or specific", "activeListening": 1-10, "activeListeningNote": "one sentence — did they respond to what was actually asked or give a generic answer, be specific" } (null if unclear)

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
    600,
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
          JSON.stringify(analyses.map(a => ({
            fillerWords:        Array.isArray(a?.fillerWords) ? a.fillerWords : [],
            pace:               a?.pace ?? null,
            confidence:         a?.confidence ?? null,
            confidenceNote:     a?.confidenceNote ?? null,
            clarity:            a?.clarity ?? null,
            clarityNote:        a?.clarityNote ?? null,
            energy:             a?.energy ?? null,
            energyNote:         a?.energyNote ?? null,
            specificity:        a?.specificity ?? null,
            specificityNote:    a?.specificityNote ?? null,
            activeListening:    a?.activeListening ?? null,
            activeListeningNote:a?.activeListeningNote ?? null,
            responseTimeMs:     a?.responseTimeMs ?? null,
            userSummary:        typeof a?.userSummary === 'string' ? a.userSummary : null,
          }))) +
          `\n\nEach turn may include "responseTimeMs" — ms the user took to respond after the AI finished. ` +
          `Under 3000ms = quick, 3000-6000ms = normal, over 6000ms = slow.\n\n` +
          `Return a JSON object with:\n` +
          `- "grade": letter grade A+ to F\n` +
          `- "gradeDesc": one sentence describing the grade\n` +
          `- "totalFillers": number\n` +
          `- "topFillers": top 2-3 filler words as a string (e.g. "um, like")\n` +
          `- "pace": overall pace summary string\n` +
          `- "avgConfidence": number 1-10 rounded to 1 decimal\n` +
          `- "avgClarity": number 1-10 rounded to 1 decimal — how clear and easy to understand\n` +
          `- "avgEnergy": number 1-10 rounded to 1 decimal — vocal engagement, not monotone\n` +
          `- "avgSpecificity": number 1-10 rounded to 1 decimal — concrete examples vs vague answers\n` +
          `- "avgActiveListening": number 1-10 rounded to 1 decimal — responded to what was actually said vs generic answers\n` +
          `- "firstImpression": number 1-10 — strength of the user's very first response only\n` +
          `- "firstImpressionNote": one sentence — specific reasoning for the firstImpression score, reference what they actually said in turn 1\n` +
          `- "statBreakdowns": object with keys "confidence","clarity","energy","specificity","activeListening","firstImpression". Each value is an array of 1-3 NOTABLE moments only — skip average/unremarkable turns. Each item: { "moment": "specific description of what happened and why it affected the score", "quality": "good"|"poor", "suggestion": "a better alternative phrase they could have used — ONLY include this field for poor word-choice moments, omit otherwise" }\n` +
          `- "avgResponseTime": average response time in seconds (1 decimal), or null if no data\n` +
          `- "responsivenessNote": one sentence about how quickly they responded\n` +
          `- "strongestMoment": string\n` +
          `- "improvements": array of exactly 2 strings\n` +
          `- "overallAssessment": 2-sentence paragraph\n\n` +
          `Return ONLY valid JSON.`,
      },
    ],
    'gpt-4o',
    1400,
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
  const { colors: C } = useTheme();
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
            backgroundColor: C.accent,
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

// ─── Training settings sheet helpers ─────────────────────────────────────────

const makeTSStyles = (C) => StyleSheet.create({
  label:       { fontSize: 10, fontWeight: '700', color: C.textMuted, letterSpacing: 1.1, marginTop: 22, marginBottom: 10 },
  card:        { flexDirection: 'row', alignItems: 'center', backgroundColor: C.cardAlt, borderRadius: 12, padding: 12, borderWidth: 1.5, borderColor: 'transparent', gap: 10 },
  cardSel:     { borderColor: C.accent, backgroundColor: C.accentBg },
  dot:         { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: C.borderMid, alignItems: 'center', justifyContent: 'center' },
  dotSel:      { borderColor: C.accent },
  dotInner:    { width: 7, height: 7, borderRadius: 4, backgroundColor: C.accent },
  cardText:    { fontSize: 13, fontWeight: '600', color: C.text },
  cardTextSel: { color: C.accent },
  cardDesc:    { fontSize: 11, color: C.textMuted, marginTop: 1 },
  badge:       { backgroundColor: C.accentBg, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  badgeText:   { fontSize: 9, fontWeight: '700', color: C.accent, letterSpacing: 0.5 },
  chip:        { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 20, backgroundColor: C.cardAlt, borderWidth: 1.5, borderColor: C.border },
  chipSel:     { backgroundColor: C.accentBg, borderColor: C.accent },
  chipText:    { fontSize: 12, fontWeight: '600', color: C.textSec },
  chipTextSel: { color: C.accent },
  toggleRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 },
  toggleDesc:  { fontSize: 11, color: C.textMuted },
});

function TSRadio({ label, options, selected, onChange }) {
  const { colors: C } = useTheme();
  const TS = useMemo(() => makeTSStyles(C), [C]);
  return (
    <View>
      {label ? <Text style={TS.label}>{label}</Text> : null}
      <View style={{ gap: 5 }}>
        {options.map(opt => {
          const sel = selected === opt.id;
          return (
            <TouchableOpacity key={String(opt.id)} style={[TS.card, sel && TS.cardSel]} onPress={() => onChange(opt.id)} activeOpacity={0.7}>
              <View style={[TS.dot, sel && TS.dotSel]}>
                {sel && <View style={TS.dotInner} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[TS.cardText, sel && TS.cardTextSel]}>{opt.label}</Text>
                {opt.desc ? <Text style={TS.cardDesc}>{opt.desc}</Text> : null}
              </View>
              {opt.badge ? <View style={TS.badge}><Text style={TS.badgeText}>{opt.badge}</Text></View> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function TSChips({ label, options, selected, onChange, single }) {
  const { colors: C } = useTheme();
  const TS = useMemo(() => makeTSStyles(C), [C]);
  return (
    <View>
      {label ? <Text style={TS.label}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {options.map(opt => {
          const sel = single ? selected === opt.id : (selected ?? []).includes(opt.id);
          return (
            <TouchableOpacity key={String(opt.id ?? 'none')} style={[TS.chip, sel && TS.chipSel]} onPress={() => onChange(opt.id)} activeOpacity={0.7}>
              <Text style={[TS.chipText, sel && TS.chipTextSel]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function TSToggle({ label, desc, value, onChange }) {
  const { dark, colors: C } = useTheme();
  const TS = useMemo(() => makeTSStyles(C), [C]);
  return (
    <View style={TS.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={TS.toggleLabel}>{label}</Text>
        {desc ? <Text style={TS.toggleDesc}>{desc}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: dark ? '#52525B' : '#71717A', true: DARK.accentLight }} thumbColor='#ffffff' />
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TrainerScreen() {
  const { dark, colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C, dark), [C, dark]);

  const [profileAvatarUri, setProfileAvatarUri] = useState(null);
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
  const [selectedStat, setSelectedStat] = useState(null);
  const [fillerCount, setFillerCount] = useState(0);
  const [trainSettingsOpen, setTrainSettingsOpen] = useState(false);
  const [trainSettings, setTrainSettings] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [sessionDetailOpen, setSessionDetailOpen] = useState(false);
  const [sessionDetailData, setSessionDetailData] = useState(null);

  const insets      = useSafeAreaInsets();
  const recorder    = useAudioRecorder(WAV_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 150);
  const scrollRef   = useRef(null);

  // Animation refs
  const cardAnims    = useRef(SCENARIOS.map(() => new Animated.Value(0))).current;
  const headerAnim   = useRef(new Animated.Value(0)).current;
  const gradeAnim    = useRef(new Animated.Value(0)).current;
  const statsAnims   = useRef(Array.from({ length: 9 }, () => new Animated.Value(0))).current;
  const ringAnim     = useRef(new Animated.Value(0)).current;
  const ringLoopRef  = useRef(null);
  const modalY          = useRef(new Animated.Value(600)).current;
  const dismissRef      = useRef(null);
  const closeModalRef   = useRef(null);
  const modalPan        = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderMove: (_, g) => { modalY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 80 || g.vy > 0.5) {
        Animated.timing(modalY, { toValue: 800, duration: 220, useNativeDriver: true })
          .start(() => dismissRef.current?.());
      } else {
        Animated.spring(modalY, { toValue: 0, tension: 65, friction: 11, useNativeDriver: true }).start();
      }
    },
  })).current;

  // Separate refs for session detail sheet (so stat breakdown modal can open on top without conflict)
  const sessionModalY    = useRef(new Animated.Value(600)).current;
  const sessionDismissRef = useRef(null);
  const sessionCloseRef   = useRef(null);
  const sessionModalPan   = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderMove: (_, g) => { if (g.dy > 0) sessionModalY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 80 || g.vy > 0.5) {
        Animated.timing(sessionModalY, { toValue: 800, duration: 220, useNativeDriver: true })
          .start(() => sessionDismissRef.current?.());
      } else {
        Animated.spring(sessionModalY, { toValue: 0, tension: 65, friction: 11, useNativeDriver: true }).start();
      }
    },
  })).current;
  const breakdownStatsRef   = useRef(null);
  const breakdownModalY     = useRef(new Animated.Value(600)).current;
  const breakdownDismissRef = useRef(null);
  const breakdownCloseRef   = useRef(null);
  const breakdownModalPan   = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderMove: (_, g) => { if (g.dy > 0) breakdownModalY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 80 || g.vy > 0.5) {
        Animated.timing(breakdownModalY, { toValue: 800, duration: 220, useNativeDriver: true })
          .start(() => breakdownDismissRef.current?.());
      } else {
        Animated.spring(breakdownModalY, { toValue: 0, tension: 65, friction: 11, useNativeDriver: true }).start();
      }
    },
  })).current;

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
  const settingsRef        = useRef(null);
  const turnCountRef       = useRef(0);
  const analysesRef        = useRef([]);

  // Mirror refs
  const inputModeRef  = useRef(INPUT_MODES.AUTO_VAD);
  const recStatusRef  = useRef('idle');
  useEffect(() => { inputModeRef.current = inputMode; }, [inputMode]);
  useEffect(() => { recStatusRef.current = recStatus; }, [recStatus]);

  // Drive the stat breakdown sheet open/close via useEffect so it works
  // reliably on Android (onShow is not dependable for transparent modals)
  useEffect(() => {
    if (selectedStat !== null) {
      breakdownDismissRef.current = () => { setSelectedStat(null); breakdownModalY.setValue(600); };
      breakdownCloseRef.current   = () => {
        Animated.timing(breakdownModalY, { toValue: 600, duration: 280, useNativeDriver: true })
          .start(() => breakdownDismissRef.current?.());
      };
      breakdownModalY.setValue(600);
      Animated.spring(breakdownModalY, { toValue: 0, tension: 65, friction: 11, useNativeDriver: true }).start();
    }
  }, [selectedStat]);

  useFocusEffect(
    useCallback(() => {
      getSettings().then(s => setInputMode(s.inputMode));
      AsyncStorage.getItem('profile_avatar_uri').then(uri => { if (uri) setProfileAvatarUri(uri); });
    }, [])
  );

  // Load recent sessions whenever selecting screen is shown
  useEffect(() => {
    if (phase === 'selecting') {
      getSessions()
        .then(data => { console.log('sessions loaded:', data.length); setRecentSessions(data); })
        .catch(e => console.error('getSessions:', e));
    }
  }, [phase]);

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
        // Don't trigger silence stop until user has spoken for at least MIN_SPEECH_MS —
        // prevents a brief noise from immediately stopping the recording
        const spokenMs = speechStartRef.current ? Date.now() - speechStartRef.current : 0;
        if (spokenMs < MIN_SPEECH_MS) return;
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

  // ── Stat breakdown sheet (shared between live stats and session history) ────

  function renderStatBreakdownModal() {
    return (
      <Modal
        visible={selectedStat !== null}
        transparent
        animationType="none"
        onRequestClose={() => breakdownCloseRef.current?.()}
      >
        <View style={S.modalOverlay}>
          <Animated.View style={[
            StyleSheet.absoluteFill,
            { backgroundColor: '#000', opacity: breakdownModalY.interpolate({ inputRange: [0, 600], outputRange: [0.45, 0], extrapolate: 'clamp' }) },
          ]} pointerEvents="none" />
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => breakdownCloseRef.current?.()} />
          <Animated.View style={[S.modalSheet, { transform: [{ translateY: breakdownModalY.interpolate({ inputRange: [0, 800], outputRange: [0, 800], extrapolateLeft: 'clamp' }) }] }]}>
            <View style={S.modalHandleArea} {...breakdownModalPan.panHandlers}>
              <View style={S.modalHandle} />
            </View>
            <Text style={S.modalTitle}>
              {{ confidence: 'Confidence', clarity: 'Clarity', energy: 'Energy', specificity: 'Specificity', activeListening: 'Active Listening', firstImpression: 'First Impression' }[selectedStat]}
            </Text>
            <Text style={S.modalSub}>Notable moments from your conversation</Text>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              {(() => {
                const moments = breakdownStatsRef.current?.statBreakdowns?.[selectedStat] ?? [];
                if (!moments.length) return <Text style={S.turnNotes}>No notable moments recorded.</Text>;
                return moments.map((m, i) => (
                  <View key={i} style={[S.turnRow, { borderLeftColor: m.quality === 'good' ? '#22C55E' : '#EF4444' }]}>
                    <View style={[S.scoreBadge, { backgroundColor: m.quality === 'good' ? (dark ? 'rgba(34,197,94,0.15)' : '#F0FDF4') : (dark ? 'rgba(239,68,68,0.15)' : '#FEF2F2'), alignSelf: 'flex-start', marginBottom: 6 }]}>
                      <Text style={[S.scoreText, { color: m.quality === 'good' ? '#22C55E' : '#EF4444' }]}>
                        {m.quality === 'good' ? 'Strong' : 'Weak'}
                      </Text>
                    </View>
                    <Text style={S.turnTranscript}>{m.moment}</Text>
                    {m.suggestion ? (
                      <View style={S.suggestionBox}>
                        <Text style={S.suggestionLabel}>TRY INSTEAD</Text>
                        <Text style={S.suggestionText}>"{m.suggestion}"</Text>
                      </View>
                    ) : null}
                  </View>
                ));
              })()}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    );
  }

  // ── Session detail sheet ──────────────────────────────────────────────────

  function renderSessionDetailModal() {
    if (!sessionDetailData) return null;
    const sesh = sessionDetailData;
    const sd   = sesh.stats_json ?? {};
    const sc   = SCENARIOS.find(s => s.id === sesh.scenario_id)
      ?? { id: sesh.scenario_id, label: sesh.scenario_label, color: '#94A3B8', icon: 'chatbubble-outline' };
    const grade = sesh.grade ?? sd.grade;
    const gc    = grade?.startsWith('A') ? '#22C55E'
      : grade?.startsWith('B') ? C.accent
      : grade?.startsWith('C') ? '#F97316' : '#EF4444';

    return (
      <Modal
        visible={sessionDetailOpen}
        transparent
        animationType="none"
        onRequestClose={() => sessionCloseRef.current?.()}
        onShow={() => {
          sessionDismissRef.current = () => { setSessionDetailOpen(false); setSelectedStat(null); sessionModalY.setValue(600); };
          sessionCloseRef.current   = () => {
            Animated.timing(sessionModalY, { toValue: 600, duration: 280, useNativeDriver: true })
              .start(() => sessionDismissRef.current?.());
          };
          sessionModalY.setValue(600);
          Animated.spring(sessionModalY, { toValue: 0, tension: 65, friction: 11, useNativeDriver: true }).start();
        }}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: sessionModalY.interpolate({ inputRange: [0, 600], outputRange: [0.4, 0], extrapolate: 'clamp' }) }]}
            pointerEvents="none"
          />
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => sessionCloseRef.current?.()} />
          <Animated.View style={[S.tsSheet, { transform: [{ translateY: sessionModalY.interpolate({ inputRange: [0, 800], outputRange: [0, 800], extrapolateLeft: 'clamp' }) }] }]}>
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 6 }} {...sessionModalPan.panHandlers}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: C.border }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, marginBottom: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 19, fontWeight: '800', color: C.text }}>{sc.label}</Text>
                <Text style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                  {formatDate(sesh.created_at)}{sesh.turn_count ? ` · ${sesh.turn_count} turns` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => sessionCloseRef.current?.()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={C.textSec} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ backgroundColor: C.bg }} contentContainerStyle={[S.statsContent, { paddingTop: 8 }]}>
              <View style={[S.gradeCircle, { borderColor: gc }]}>
                <Text style={[S.gradeText, { color: gc }]}>{grade ?? '—'}</Text>
              </View>
              {sd.gradeDesc ? <Text style={S.gradeDesc}>{sd.gradeDesc}</Text> : null}

              {[
                [
                  { key: 'confidence',      value: sesh.avg_confidence       ?? '—', label: 'Confidence' },
                  { key: 'clarity',         value: sesh.avg_clarity          ?? '—', label: 'Clarity' },
                  { key: 'energy',          value: sesh.avg_energy           ?? '—', label: 'Energy' },
                ],
                [
                  { key: 'specificity',     value: sesh.avg_specificity      ?? '—', label: 'Specificity' },
                  { key: 'activeListening', value: sesh.avg_active_listening ?? '—', label: 'Active Listening' },
                  { key: 'firstImpression', value: sd.firstImpression        ?? '—', label: 'First Impression' },
                ],
              ].map((row, ri) => (
                <View key={ri} style={S.statsGrid}>
                  {row.map(item => (
                    <TouchableOpacity
                      key={item.key}
                      style={S.statBox}
                      activeOpacity={0.7}
                      onPress={() => { breakdownStatsRef.current = sd; setSelectedStat(item.key); }}
                    >
                      <Text style={S.statValue}>{item.value}</Text>
                      <Text style={S.statLabel}>{item.label}</Text>
                      <Text style={S.statSub}>out of 10</Text>
                      <View style={S.statTapHint}>
                        <Ionicons name="information-circle-outline" size={12} color="#CBD5E1" />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              ))}

              <View style={S.statsGrid}>
                {[
                  { value: sd.totalFillers ?? sesh.total_fillers ?? 0, label: 'Filler Words', sub: sd.topFillers ? `"${sd.topFillers}"` : null },
                  {
                    value: sd.pace?.toLowerCase().includes('fast') ? 'Fast'
                      : sd.pace?.toLowerCase().includes('slow') ? 'Slow' : 'Good',
                    label: 'Pace', sub: null,
                  },
                ].map((item, i) => (
                  <View key={i} style={[S.statBox, { flex: 1 }]}>
                    <Text style={S.statValue}>{item.value}</Text>
                    <Text style={S.statLabel}>{item.label}</Text>
                    {item.sub ? <Text style={S.statSub}>{item.sub}</Text> : null}
                  </View>
                ))}
              </View>

              {(sesh.avg_response_time != null) && (
                <View style={S.responseCard}>
                  <Text style={S.calloutLabel}>RESPONSE SPEED</Text>
                  <Text style={[S.responseTime, { color: sesh.avg_response_time > 6 ? '#EF4444' : '#22C55E' }]}>
                    {sesh.avg_response_time}s avg
                  </Text>
                  {sd.responsivenessNote ? <Text style={S.calloutText}>{sd.responsivenessNote}</Text> : null}
                </View>
              )}

              {sd.strongestMoment ? (
                <View style={S.calloutCard}>
                  <Text style={S.calloutLabel}>STRONGEST MOMENT</Text>
                  <Text style={S.calloutText}>{sd.strongestMoment}</Text>
                </View>
              ) : null}

              {sd.improvements?.length > 0 && (
                <View style={S.improvementsCard}>
                  <Text style={[S.calloutLabel, { color: '#F97316' }]}>WORK ON</Text>
                  {sd.improvements.map((item, i) => (
                    <View key={i} style={S.improvRow}>
                      <View style={S.improvDot} />
                      <Text style={S.improvText}>{item}</Text>
                    </View>
                  ))}
                </View>
              )}

              {sd.overallAssessment ? (
                <Text style={S.overallText}>{sd.overallAssessment}</Text>
              ) : null}
            </ScrollView>
          </Animated.View>
        </View>
        {/* Breakdown overlay inside this Modal to avoid Android nested-Modal stacking */}
        {selectedStat !== null && (
          <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]} pointerEvents="box-none">
            <Animated.View
              style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: breakdownModalY.interpolate({ inputRange: [0, 600], outputRange: [0.45, 0], extrapolate: 'clamp' }) }]}
              pointerEvents="none"
            />
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => breakdownCloseRef.current?.()} />
            <Animated.View style={[S.modalSheet, { transform: [{ translateY: breakdownModalY.interpolate({ inputRange: [0, 800], outputRange: [0, 800], extrapolateLeft: 'clamp' }) }] }]}>
              <View style={S.modalHandleArea} {...breakdownModalPan.panHandlers}>
                <View style={S.modalHandle} />
              </View>
              <Text style={S.modalTitle}>
                {{ confidence: 'Confidence', clarity: 'Clarity', energy: 'Energy', specificity: 'Specificity', activeListening: 'Active Listening', firstImpression: 'First Impression' }[selectedStat]}
              </Text>
              <Text style={S.modalSub}>Notable moments from your conversation</Text>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
                {(() => {
                  const moments = breakdownStatsRef.current?.statBreakdowns?.[selectedStat] ?? [];
                  if (!moments.length) return <Text style={S.turnNotes}>No notable moments recorded.</Text>;
                  return moments.map((m, i) => (
                    <View key={i} style={[S.turnRow, { borderLeftColor: m.quality === 'good' ? '#22C55E' : '#EF4444' }]}>
                      <View style={[S.scoreBadge, { backgroundColor: m.quality === 'good' ? (dark ? 'rgba(34,197,94,0.15)' : '#F0FDF4') : (dark ? 'rgba(239,68,68,0.15)' : '#FEF2F2'), alignSelf: 'flex-start', marginBottom: 6 }]}>
                        <Text style={[S.scoreText, { color: m.quality === 'good' ? '#22C55E' : '#EF4444' }]}>
                          {m.quality === 'good' ? 'Strong' : 'Weak'}
                        </Text>
                      </View>
                      <Text style={S.turnTranscript}>{m.moment}</Text>
                      {m.suggestion ? (
                        <View style={S.suggestionBox}>
                          <Text style={S.suggestionLabel}>TRY INSTEAD</Text>
                          <Text style={S.suggestionText}>"{m.suggestion}"</Text>
                        </View>
                      ) : null}
                    </View>
                  ));
                })()}
              </ScrollView>
            </Animated.View>
          </View>
        )}
      </Modal>
    );
  }

  // ── Training settings ─────────────────────────────────────────────────────

  function openTrainSettings() {
    getSettings().then(s => {
      setTrainSettings(s);
      setTrainSettingsOpen(true);
    });
  }

  function updateTrainSetting(key, value) {
    const next = { ...trainSettings, [key]: value };
    setTrainSettings(next);
    saveSettings({ [key]: value });
    if (settingsRef.current) settingsRef.current = { ...settingsRef.current, [key]: value };
    if (key === 'inputMode') { setInputMode(value); inputModeRef.current = value; }
  }

  function renderTrainSettingsModal() {
    return (
      <Modal
        visible={trainSettingsOpen}
        transparent
        animationType="none"
        onRequestClose={() => closeModalRef.current?.()}
        onShow={() => {
          dismissRef.current    = () => { setTrainSettingsOpen(false); modalY.setValue(600); };
          closeModalRef.current = () => {
            Animated.timing(modalY, { toValue: 600, duration: 280, useNativeDriver: true })
              .start(() => dismissRef.current?.());
          };
          modalY.setValue(600);
          Animated.spring(modalY, { toValue: 0, tension: 65, friction: 11, useNativeDriver: true }).start();
        }}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: modalY.interpolate({ inputRange: [0, 600], outputRange: [0.4, 0], extrapolate: 'clamp' }) }]}
            pointerEvents="none"
          />
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => closeModalRef.current?.()} />
          <Animated.View style={[S.tsSheet, { transform: [{ translateY: modalY.interpolate({ inputRange: [0, 800], outputRange: [0, 800], extrapolateLeft: 'clamp' }) }] }]}>
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 6 }} {...modalPan.panHandlers}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: C.border }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 4 }}>
              <Text style={{ fontSize: 19, fontWeight: '800', color: C.text }}>Training Settings</Text>
              <TouchableOpacity onPress={() => closeModalRef.current?.()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={C.textSec} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 44 }}>
              {trainSettings && (
                <>
                  <TSRadio
                    label="INPUT MODE"
                    options={[
                      { id: INPUT_MODES.AUTO_VAD,       label: 'Auto — Silence Detection', badge: 'Default' },
                      { id: INPUT_MODES.AUTO_COUNTDOWN, label: 'Auto-start + Countdown' },
                      { id: INPUT_MODES.PUSH_TO_SPEAK,  label: 'Push to Speak' },
                    ]}
                    selected={trainSettings.inputMode}
                    onChange={v => updateTrainSetting('inputMode', v)}
                  />
                  <TSRadio
                    label="INTENSITY"
                    options={[
                      { id: INTENSITIES.RELAXED,     label: 'Relaxed',     desc: 'Patient and forgiving. Highlights strengths.' },
                      { id: INTENSITIES.STANDARD,    label: 'Standard',    desc: 'Balanced. Calls out weak answers directly.', badge: 'Default' },
                      { id: INTENSITIES.CHALLENGING, label: 'Challenging', desc: 'Very critical. High standards, no sugarcoating.' },
                      { id: INTENSITIES.REALISTIC,   label: 'Realistic',   desc: 'Extreme difficulty. No coaching hints at all.' },
                    ]}
                    selected={trainSettings.intensity}
                    onChange={v => updateTrainSetting('intensity', v)}
                  />
                  <TSRadio
                    label="SESSION LENGTH"
                    options={[
                      { id: SESSION_LENGTHS.SHORT,     label: 'Short',     desc: '5 turns, then auto-ends.' },
                      { id: SESSION_LENGTHS.MEDIUM,    label: 'Medium',    desc: '10 turns, then auto-ends.' },
                      { id: SESSION_LENGTHS.UNLIMITED, label: 'Unlimited', desc: 'End whenever you want.', badge: 'Default' },
                    ]}
                    selected={trainSettings.sessionLength}
                    onChange={v => updateTrainSetting('sessionLength', v)}
                  />
                  <TSChips
                    label="LANGUAGE"
                    options={[
                      { id: LANGUAGES.ENGLISH, label: 'English' },
                      { id: LANGUAGES.SPANISH, label: 'Spanish' },
                      { id: LANGUAGES.FRENCH,  label: 'French' },
                    ]}
                    selected={trainSettings.language}
                    onChange={v => updateTrainSetting('language', v)}
                    single
                  />
                  <TSChips
                    label="FOCUS AREA"
                    options={[{ id: null, label: 'None' }, ...FOCUS_AREAS]}
                    selected={trainSettings.focusArea}
                    onChange={v => updateTrainSetting('focusArea', v)}
                    single
                  />
                  <Text style={{ fontSize: 10, fontWeight: '700', color: C.textMuted, letterSpacing: 1.1, marginTop: 22, marginBottom: 10 }}>FEEDBACK</Text>
                  <TSToggle
                    label="Post-turn Scores"
                    desc="Score card after each response."
                    value={trainSettings.postTurnFeedback}
                    onChange={v => updateTrainSetting('postTurnFeedback', v)}
                  />
                  <View style={{ height: 1, backgroundColor: C.divider }} />
                  <TSToggle
                    label="Live Filler Counter"
                    desc="Running count of filler words."
                    value={trainSettings.showFillerCounter}
                    onChange={v => updateTrainSetting('showFillerCounter', v)}
                  />
                </>
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    );
  }

  // ── Core functions ────────────────────────────────────────────────────────

  function scheduleAutoStart() {
    clearTimeout(autoStartTimerRef.current);
    autoStartTimerRef.current = setTimeout(() => {
      if (recStatusRef.current === 'idle') startRecording();
    }, 600);
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
    setFillerCount(0);
    analysesRef.current = [];
    turnCountRef.current = 0;
    try {
      const [loadedProfile, loadedSettings] = await Promise.all([getProfile(), getSettings()]);
      profileRef.current = loadedProfile;
      settingsRef.current = loadedSettings;
      setInputMode(loadedSettings.inputMode);
      const opening = await getOpeningLine(s.id, profileRef.current, settingsRef.current);
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
    if (settingsRef.current?.hapticFeedback) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
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
    if (settingsRef.current?.hapticFeedback) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
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
      const result = await processAudioTurn(base64Audio, ext, scenario.id, gptHistory, profileRef.current, settingsRef.current);

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
      const enrichedAnalysis = { ...analysis, responseTimeMs, userSummary, userTranscript };

      // Keep analysesRef in sync for session-length check inside the typewriter closure
      const newAnalyses = [...analysesRef.current, enrichedAnalysis];
      analysesRef.current = newAnalyses;
      setAnalyses(newAnalyses);

      turnCountRef.current++;
      const currentTurn = turnCountRef.current;

      // Accumulate filler words
      const fillerDelta = analysis?.fillerWords?.length ?? 0;
      if (fillerDelta > 0) setFillerCount(prev => prev + fillerDelta);

      // Build message list for this turn
      const turnMsgs = [{ role: 'user', text: userSummary }];
      if (settingsRef.current?.postTurnFeedback && analysis) {
        turnMsgs.push({ role: 'feedback', analysis });
      }
      turnMsgs.push({ role: 'ai', text: '' });
      setMessages(prev => [...prev, ...turnMsgs]);

      setGptHistory(prev => [...prev,
        { role: 'user',      content: userTranscript ?? userSummary },
        { role: 'assistant', content: reply },
      ]);
      setResponseElapsed(0);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      typewriteLastMessage(reply, () => {
        setRecStatus('idle');
        if (shouldEnd) {
          setEarlyEnded(true);
          return;
        }
        // Session length auto-end
        const maxTurns = settingsRef.current?.sessionLength;
        if (maxTurns && maxTurns > 0 && currentTurn >= maxTurns) {
          endConversation(newAnalyses);
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

  async function endConversation(explicitAnalyses) {
    clearTimeout(autoStartTimerRef.current);
    clearTimeout(maxRecTimerRef.current);
    clearInterval(countdownTimerRef.current);
    clearInterval(responseTimerRef.current);
    if (recStatusRef.current === 'recording') {
      await recorder.stop().catch(() => {});
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    }
    const analysesToUse = explicitAnalyses ?? analyses;
    if (analysesToUse.length === 0) { setPhase('selecting'); return; }
    setPhase('analyzing');
    try {
      const result = await generateStats(scenario.id, analysesToUse);
      setStats(result);
      setPhase('stats');
      saveSession({
        scenarioId:    scenario.id,
        scenarioLabel: scenario.label,
        turnCount:     turnCountRef.current,
        stats:         result,
      }).catch(e => Alert.alert('Session not saved', e?.message ?? String(e)));
    } catch (e) {
      Alert.alert('Could not generate stats', e.message);
      setPhase('selecting');
    }
  }

  function reset() {
    headerAnim.setValue(0);
    cardAnims.forEach(a => a.setValue(0));
    setPhase('selecting');
    setScenario(null);
    setMessages([]);
    setGptHistory([]);
    setAnalyses([]);
    setStats(null);
    setRecStatus('idle');
    setEarlyEnded(false);
    setFillerCount(0);
    setSelectedStat(null);
    analysesRef.current = [];
    turnCountRef.current = 0;
  }

  // ── Render: selecting ─────────────────────────────────────────────────────

  if (phase === 'selecting') {
    return (
      <>
        <ScrollView style={S.container} contentContainerStyle={S.selectContent} showsVerticalScrollIndicator={false}>
          <Animated.View style={{
            opacity: headerAnim,
            transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View>
                <Text style={S.selectTitle}>Choose a Scenario</Text>
                <Text style={S.selectSub}>Pick what you want to practice</Text>
              </View>
              <TouchableOpacity onPress={openTrainSettings} style={S.gearBtn} activeOpacity={0.75}>
                <Ionicons name="settings-outline" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>
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

          {recentSessions.length > 0 && (
            <View style={{ marginTop: 28 }}>
              <Text style={S.recentHeading}>RECENT SESSIONS</Text>
              {recentSessions.slice(0, 5).map(session => {
                const sc  = SCENARIOS.find(s => s.id === session.scenario_id);
                const col = sc?.color ?? '#94A3B8';
                const gc  = session.grade?.startsWith('A') ? '#22C55E'
                  : session.grade?.startsWith('B') ? C.accent
                  : session.grade?.startsWith('C') ? '#F97316' : '#EF4444';
                const metaParts = [
                  session.avg_confidence   != null ? `${session.avg_confidence} conf`   : null,
                  session.avg_clarity      != null ? `${session.avg_clarity} clar`      : null,
                  session.avg_energy       != null ? `${session.avg_energy} enrg`       : null,
                  session.turn_count       != null ? `${session.turn_count} turns`      : null,
                ].filter(Boolean);
                return (
                  <TouchableOpacity
                    key={session.id}
                    style={S.recentCard}
                    activeOpacity={0.7}
                    onPress={() => { setSessionDetailData(session); setSessionDetailOpen(true); }}
                  >
                    <View style={[S.recentAccent, { backgroundColor: col }]} />
                    <View style={S.recentBody}>
                      <View style={S.recentTop}>
                        <Text style={S.recentScenario}>{session.scenario_label}</Text>
                        <View style={[S.recentGradeBadge, { backgroundColor: gc + '18' }]}>
                          <Text style={[S.recentGradeText, { color: gc }]}>{session.grade ?? '—'}</Text>
                        </View>
                        <Text style={S.recentDate}>{formatDate(session.created_at)}</Text>
                      </View>
                      {metaParts.length > 0 && (
                        <Text style={S.recentMeta}>{metaParts.join(' · ')}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </ScrollView>
        {renderSessionDetailModal()}
        {renderTrainSettingsModal()}
      </>
    );
  }

  // ── Render: analyzing ─────────────────────────────────────────────────────

  if (phase === 'analyzing') {
    return (
      <View style={S.centerScreen}>
        <ActivityIndicator size="large" color={C.accent} />
        <Text style={S.analyzingText}>Analyzing your conversation...</Text>
      </View>
    );
  }

  // ── Render: stats ─────────────────────────────────────────────────────────

  if (phase === 'stats' && stats) {
    const gradeColor =
      stats.grade?.startsWith('A') ? '#22C55E' :
      stats.grade?.startsWith('B') ? C.accent :
      stats.grade?.startsWith('C') ? '#F97316' : '#EF4444';

    const sa = i => ({
      opacity: statsAnims[i],
      transform: [{ translateY: statsAnims[i].interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
    });

    return (
      <>
      <ScrollView style={S.container} contentContainerStyle={S.statsContent} showsVerticalScrollIndicator={false}>
        <Text style={S.statsHeading}>Session Complete</Text>
        <Text style={S.statsScenario}>{scenario?.label}</Text>

        <Animated.View style={[S.gradeCircle, { borderColor: gradeColor }, {
          transform: [{ scale: gradeAnim }], opacity: gradeAnim,
        }]}>
          <Text style={[S.gradeText, { color: gradeColor }]}>{stats.grade}</Text>
        </Animated.View>
        <Text style={S.gradeDesc}>{stats.gradeDesc}</Text>

        {[
          [
            { key: 'confidence',      value: stats.avgConfidence ?? '—',      label: 'Confidence' },
            { key: 'clarity',         value: stats.avgClarity ?? '—',         label: 'Clarity' },
            { key: 'energy',          value: stats.avgEnergy ?? '—',          label: 'Energy' },
          ],
          [
            { key: 'specificity',     value: stats.avgSpecificity ?? '—',     label: 'Specificity' },
            { key: 'activeListening', value: stats.avgActiveListening ?? '—', label: 'Active Listening' },
            { key: 'firstImpression', value: stats.firstImpression ?? '—',    label: 'First Impression' },
          ],
        ].map((row, ri) => (
          <Animated.View key={ri} style={[S.statsGrid, sa(ri)]}>
            {row.map(item => (
              <TouchableOpacity key={item.key} style={S.statBox} onPress={() => { breakdownStatsRef.current = stats; setSelectedStat(item.key); }} activeOpacity={0.7}>
                <Text style={S.statValue}>{item.value}</Text>
                <Text style={S.statLabel}>{item.label}</Text>
                <Text style={S.statSub}>out of 10</Text>
                <View style={S.statTapHint}>
                  <Ionicons name="information-circle-outline" size={12} color="#CBD5E1" />
                </View>
              </TouchableOpacity>
            ))}
          </Animated.View>
        ))}

        <Animated.View style={[S.statsGrid, sa(2)]}>
          {[
            { value: stats.totalFillers ?? 0, label: 'Filler Words', sub: stats.topFillers ? `"${stats.topFillers}"` : null },
            {
              value: stats.pace?.toLowerCase().includes('fast') ? 'Fast'
                : stats.pace?.toLowerCase().includes('slow') ? 'Slow' : 'Good',
              label: 'Pace', sub: null,
            },
          ].map((item, i) => (
            <View key={i} style={[S.statBox, { flex: 1 }]}>
              <Text style={S.statValue}>{item.value}</Text>
              <Text style={S.statLabel}>{item.label}</Text>
              {item.sub ? <Text style={S.statSub}>{item.sub}</Text> : null}
            </View>
          ))}
        </Animated.View>

        {stats.avgResponseTime != null && (
          <Animated.View style={[S.responseCard, sa(3)]}>
            <Text style={S.calloutLabel}>RESPONSE SPEED</Text>
            <Text style={[S.responseTime, { color: stats.avgResponseTime > 6 ? '#EF4444' : '#22C55E' }]}>
              {stats.avgResponseTime}s avg
            </Text>
            {stats.responsivenessNote ? <Text style={S.calloutText}>{stats.responsivenessNote}</Text> : null}
          </Animated.View>
        )}

        {stats.strongestMoment ? (
          <Animated.View style={[S.calloutCard, sa(4)]}>
            <Text style={S.calloutLabel}>STRONGEST MOMENT</Text>
            <Text style={S.calloutText}>{stats.strongestMoment}</Text>
          </Animated.View>
        ) : null}

        {stats.improvements?.length > 0 && (
          <Animated.View style={[S.improvementsCard, sa(5)]}>
            <Text style={[S.calloutLabel, { color: '#F97316' }]}>WORK ON</Text>
            {stats.improvements.map((item, i) => (
              <View key={i} style={S.improvRow}>
                <View style={S.improvDot} />
                <Text style={S.improvText}>{item}</Text>
              </View>
            ))}
          </Animated.View>
        )}

        {stats.overallAssessment ? (
          <Animated.View style={sa(6)}>
            <Text style={S.overallText}>{stats.overallAssessment}</Text>
          </Animated.View>
        ) : null}

        <Animated.View style={[S.statsButtons, sa(7)]}>
          <TouchableOpacity style={S.btnSecondary} onPress={() => startConversation(scenario)}>
            <Text style={S.btnSecondaryText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.btnPrimary} onPress={reset}>
            <Text style={S.btnPrimaryText}>New Scenario</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
      {renderStatBreakdownModal()}
      </>
    );
  }

  // ── Render: conversation ──────────────────────────────────────────────────

  const scenarioColor = scenario ? (SCENARIOS.find(s => s.id === scenario.id)?.color ?? C.accent) : C.accent;

  function renderFooter() {
    if (earlyEnded) return null;

    if (recStatus === 'processing') {
      return (
        <View style={S.footerCenter}>
          <ActivityIndicator size="small" color={C.accent} />
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
      if (recStatus === 'processing') return <Text style={S.footerLabel}>Processing…</Text>;
      if (recStatus === 'idle') return <Text style={S.footerLabel}>Starting…</Text>;
      return null;
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
    <>
    <SafeAreaView style={S.container}>
      <View style={S.convHeader}>
        <View style={S.convHeaderLeft}>
          <View style={[S.scenarioDot, { backgroundColor: scenarioColor }]} />
          <Text style={S.convTitle}>{scenario?.label}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TouchableOpacity onPress={openTrainSettings} style={S.gearBtn} activeOpacity={0.75}>
            <Ionicons name="settings-outline" size={18} color="#64748B" />
          </TouchableOpacity>
          <TouchableOpacity style={S.endBtn} onPress={() => endConversation()}>
            <Text style={S.endBtnText}>End</Text>
          </TouchableOpacity>
        </View>
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
          if (msg.role === 'feedback') {
            const a = msg.analysis;
            return (
              <FadeSlide key={i} fromRight={false} delay={0}>
                <View style={S.feedbackPill}>
                  {[
                    { label: 'Conf',    value: a?.confidence },
                    { label: 'Clarity', value: a?.clarity },
                    { label: 'Energy',  value: a?.energy },
                    { label: 'Spec',    value: a?.specificity },
                  ].map(st => st.value != null ? (
                    <View key={st.label} style={S.feedbackStat}>
                      <Text style={S.feedbackLabel}>{st.label}</Text>
                      <Text style={S.feedbackValue}>{st.value}</Text>
                    </View>
                  ) : null)}
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
                {msg.role === 'user' && (
                  profileAvatarUri
                    ? <Image source={{ uri: profileAvatarUri }} style={S.userAvatar} />
                    : <View style={[S.userAvatar, { backgroundColor: C.accent + '33', alignItems: 'center', justifyContent: 'center' }]}>
                        <Ionicons name="person" size={18} color={C.accent} />
                      </View>
                )}
              </View>
            </FadeSlide>
          );
        })}

      </ScrollView>

      {!earlyEnded && (
        <View style={[S.footer, { bottom: 90 }]}>
          {settingsRef.current?.showFillerCounter && fillerCount > 0 && (
            <View style={S.fillerPill}>
              <Text style={S.fillerText}>{fillerCount} filler{fillerCount !== 1 ? 's' : ''}</Text>
            </View>
          )}
          {renderFooter()}
        </View>
      )}
    </SafeAreaView>
    {renderTrainSettingsModal()}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (C, dark) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  selectContent: { padding: 20, paddingBottom: 110 },
  selectTitle: { fontSize: 26, fontWeight: '800', color: C.text, marginBottom: 4 },
  selectSub:   { fontSize: 14, color: C.textSec, marginBottom: 28 },
  scenarioCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.card,
    borderRadius: 16, marginBottom: 10, overflow: 'hidden',
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  scenarioAccent:   { width: 3, alignSelf: 'stretch' },
  scenarioIconWrap: { width: 40, height: 40, borderRadius: 12, margin: 14, alignItems: 'center', justifyContent: 'center' },
  scenarioBody:  { flex: 1, paddingVertical: 16, paddingRight: 4 },
  scenarioLabel: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 2 },
  scenarioDesc:  { fontSize: 12, color: C.textMuted },

  convHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.divider,
  },
  convHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scenarioDot: { width: 8, height: 8, borderRadius: 4 },
  convTitle:   { fontSize: 16, fontWeight: '700', color: C.text },
  endBtn:      { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: '#FEF2F2' },
  endBtnText:  { color: '#EF4444', fontWeight: '600', fontSize: 13 },

  scroll:        { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 180, gap: 10 },

  row:     { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowUser: { justifyContent: 'flex-end' },
  avatar:     { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  userAvatar: { width: 46, height: 46, borderRadius: 23, marginBottom: 2 },
  bubbleAI: {
    flex: 1, backgroundColor: C.card, borderRadius: 18, borderBottomLeftRadius: 4,
    paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  bubbleUser: {
    maxWidth: '76%', backgroundColor: C.accent,
    borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10,
  },
  bubbleText:     { fontSize: 15, color: C.text, lineHeight: 22 },
  bubbleTextUser: { color: '#fff' },
  youLabel: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.8, marginBottom: 3 },

  infoPill: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center',
    gap: 6, backgroundColor: C.bgAlt, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
  },
  infoPillText: { fontSize: 13, color: C.textMuted, fontWeight: '500' },

  footer:      { position: 'absolute', left: 0, right: 0, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  footerCenter: { alignItems: 'center', gap: 8 },
  footerLabel:  { fontSize: 13, color: C.textMuted, fontWeight: '500' },

  ghostBtn:     { marginTop: 4, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20, backgroundColor: C.accentBg },
  ghostBtnText: { color: C.accent, fontWeight: '600', fontSize: 13 },

  countdownNum:    { fontSize: 48, fontWeight: '800', color: C.accent, lineHeight: 56 },
  countdownUrgent: { color: '#EF4444' },
  submitBtn:       { marginTop: 4, paddingHorizontal: 28, paddingVertical: 10, borderRadius: 12, backgroundColor: C.accent },
  submitBtnText:   { color: '#fff', fontWeight: '700', fontSize: 15 },

  timerNum:  { fontSize: 38, fontWeight: '800', color: C.accent, lineHeight: 44 },
  timerSlow: { color: '#EF4444' },
  micWrap:   { position: 'relative', alignItems: 'center', justifyContent: 'center', width: 70, height: 70 },
  micRing:   { position: 'absolute', width: 72, height: 72, borderRadius: 36, backgroundColor: '#EF4444' },
  micBtn: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: C.accent,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.accent, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  micBtnActive:   { backgroundColor: '#EF4444', shadowColor: '#EF4444' },
  micBtnDisabled: { backgroundColor: C.accentLight, shadowOpacity: 0, elevation: 0 },

  centerScreen:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: C.bg },
  analyzingText: { fontSize: 15, color: C.textSec, fontWeight: '500' },

  statsContent:  { padding: 20, paddingBottom: 110, alignItems: 'center' },
  statsHeading:  { fontSize: 24, fontWeight: '800', color: C.text, marginBottom: 4 },
  statsScenario: { fontSize: 13, color: C.textMuted, marginBottom: 28 },
  gradeCircle: {
    width: 104, height: 104, borderRadius: 52, borderWidth: 4,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12, backgroundColor: C.card,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  gradeText: { fontSize: 40, fontWeight: '800' },
  gradeDesc: { fontSize: 14, color: C.textSec, marginBottom: 24, textAlign: 'center', lineHeight: 20 },

  statsGrid: { flexDirection: 'row', gap: 10, marginBottom: 10, width: '100%' },
  statBox: {
    flex: 1, backgroundColor: C.card, borderRadius: 14, padding: 14, alignItems: 'center',
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  statValue:   { fontSize: 22, fontWeight: '800', color: C.text, marginBottom: 4 },
  statLabel:   { fontSize: 11, fontWeight: '600', color: C.textSec, textAlign: 'center' },
  statSub:     { fontSize: 10, color: C.textMuted, textAlign: 'center', marginTop: 2 },
  statTapHint: { position: 'absolute', top: 8, right: 8 },

  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40, maxHeight: '75%',
  },
  modalHandleArea: { alignItems: 'center', paddingVertical: 12 },
  modalHandle:     { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border },
  modalTitle: { fontSize: 20, fontWeight: '800', color: C.text, marginBottom: 4 },
  modalSub:   { fontSize: 13, color: C.textMuted, marginBottom: 20 },

  turnRow:       { borderLeftWidth: 3, borderLeftColor: C.accentBg, paddingLeft: 12, paddingVertical: 10, marginBottom: 16 },
  scoreBadge:    { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  scoreText:     { fontSize: 11, fontWeight: '700' },
  turnTranscript:{ fontSize: 14, color: C.text, lineHeight: 20, marginBottom: 6 },
  turnNotes:     { fontSize: 12, color: C.textSec, fontStyle: 'italic', lineHeight: 17 },

  suggestionBox:   { backgroundColor: dark ? 'rgba(34,197,94,0.12)' : '#F0FDF4', borderRadius: 10, padding: 10, marginTop: 4 },
  suggestionLabel: { fontSize: 9, fontWeight: '700', color: '#22C55E', letterSpacing: 1, marginBottom: 4 },
  suggestionText:  { fontSize: 13, color: dark ? '#86EFAC' : '#166534', lineHeight: 19, fontStyle: 'italic' },

  responseCard: { backgroundColor: C.card, borderRadius: 14, padding: 16, width: '100%', marginBottom: 10, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  responseTime: { fontSize: 28, fontWeight: '800', marginBottom: 4 },

  calloutCard:      { backgroundColor: C.accentBg, borderRadius: 14, padding: 16, width: '100%', marginBottom: 10 },
  improvementsCard: { backgroundColor: C.card, borderRadius: 14, padding: 16, width: '100%', marginBottom: 10, borderWidth: 1, borderColor: C.border },
  calloutLabel: { fontSize: 10, fontWeight: '700', color: C.textMuted, letterSpacing: 1, marginBottom: 8 },
  calloutText:  { fontSize: 14, color: C.text, lineHeight: 20 },

  improvRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  improvDot:  { width: 5, height: 5, borderRadius: 3, backgroundColor: '#F97316', marginTop: 7 },
  improvText: { flex: 1, fontSize: 14, color: C.text, lineHeight: 20 },

  overallText: { fontSize: 14, color: C.textSec, lineHeight: 22, textAlign: 'center', marginBottom: 24, marginTop: 4 },

  feedbackPill: {
    flexDirection: 'row', alignSelf: 'center', gap: 12, backgroundColor: C.bgAlt,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: C.divider,
  },
  feedbackStat:  { alignItems: 'center', minWidth: 36 },
  feedbackLabel: { fontSize: 9, fontWeight: '700', color: C.textMuted, letterSpacing: 0.5, marginBottom: 2 },
  feedbackValue: { fontSize: 14, fontWeight: '800', color: C.accent },

  fillerPill: { backgroundColor: '#FEF3C7', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 8 },
  fillerText: { fontSize: 12, fontWeight: '600', color: '#D97706' },

  gearBtn: { padding: 7, borderRadius: 10, backgroundColor: C.bgAlt },

  tsSheet: {
    backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 12,
  },

  statsButtons:     { flexDirection: 'row', gap: 10, width: '100%' },
  btnPrimary:       { flex: 1, backgroundColor: C.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnPrimaryText:   { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary:     { flex: 1, backgroundColor: C.accentBg, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnSecondaryText: { color: C.accent, fontWeight: '700', fontSize: 15 },

  recentHeading:    { fontSize: 11, fontWeight: '700', color: C.textMuted, letterSpacing: 1.2, marginBottom: 10 },
  recentCard:       { flexDirection: 'row', backgroundColor: C.card, borderRadius: 12, marginBottom: 8, overflow: 'hidden', shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  recentAccent:     { width: 3, alignSelf: 'stretch' },
  recentBody:       { flex: 1, paddingVertical: 10, paddingHorizontal: 12 },
  recentTop:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  recentScenario:   { fontSize: 13, fontWeight: '700', color: C.text, flex: 1 },
  recentGradeBadge: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  recentGradeText:  { fontSize: 11, fontWeight: '800' },
  recentDate:       { fontSize: 11, color: C.textMuted },
  recentMeta:       { fontSize: 11, color: C.textMuted },
});
