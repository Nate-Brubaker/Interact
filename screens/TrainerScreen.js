import { useState, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Animated, Alert, SafeAreaView,
} from 'react-native';
import {
  useAudioRecorder,
  requestRecordingPermissionsAsync, setAudioModeAsync,
} from 'expo-audio';

const WAV_RECORDING_OPTIONS = {
  extension: '.wav',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  android: {
    outputFormat: 'default',
    audioEncoder: 'default',
  },
  ios: {
    outputFormat: 'lpcm',
    audioQuality: 96,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/wav',
    bitsPerSecond: 256000,
  },
};
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';

const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();

// ─── Scenario types ───────────────────────────────────────────────────────────

const SCENARIOS = [
  { id: 'job_interview',  label: 'Job Interview',       icon: '💼', desc: 'Answer tough interview questions' },
  { id: 'first_date',     label: 'First Date',          icon: '🌹', desc: 'Keep a natural flowing conversation' },
  { id: 'networking',     label: 'Networking Event',    icon: '🤝', desc: 'Meet professionals and make connections' },
  { id: 'small_talk',     label: 'Small Talk',          icon: '💬', desc: 'Chat with a stranger' },
  { id: 'new_friends',    label: 'Making Friends',      icon: '👋', desc: 'Meet someone new at a social gathering' },
  { id: 'difficult',      label: 'Difficult Convo',     icon: '⚡', desc: 'Practice assertive communication' },
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
  // Strip markdown code fences and normalize smart quotes
  let s = raw
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .replace(/[“”]/g, '"')
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
        content: `These are per-turn speech analyses from a "${scenarioLabel}" practice conversation:\n${JSON.stringify(analyses)}\n\nReturn a JSON object with:\n- "grade": letter grade A+ to F\n- "gradeDesc": one sentence describing the grade\n- "totalFillers": number\n- "topFillers": top 2-3 filler words as a string (e.g. "um, like")\n- "pace": overall pace summary string\n- "avgConfidence": number 1-10 rounded to 1 decimal\n- "strongestMoment": string\n- "improvements": array of exactly 2 strings\n- "overallAssessment": 2-sentence paragraph\n\nReturn ONLY valid JSON.`,
      },
    ],
    'gpt-4o',
    500,
  );
  const raw = data.choices[0].message.content.trim();
  try {
    return extractJSON(raw);
  } catch (e) {
    throw new Error('Could not parse stats: ' + e.message + '\n\nRaw: ' + raw.slice(0, 200));
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TrainerScreen() {
  const [phase, setPhase] = useState('selecting'); // selecting | conversation | analyzing | stats
  const [scenario, setScenario] = useState(null);
  const [messages, setMessages] = useState([]);   // [{role:'ai'|'user', text}]
  const [gptHistory, setGptHistory] = useState([]); // [{role, content}] for API context
  const [analyses, setAnalyses] = useState([]);
  const [stats, setStats] = useState(null);
  const [recStatus, setRecStatus] = useState('idle'); // idle | recording | processing
  const [aiSpeaking, setAiSpeaking] = useState(false);

  const recorder = useAudioRecorder(WAV_RECORDING_OPTIONS);
  const scrollRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef(null);
  const recordingStartRef = useRef(null);

  useEffect(() => {
    if (recStatus === 'recording') {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    }
  }, [recStatus]);

  function speakAI(text, onDone) {
    setAiSpeaking(true);
    Speech.speak(text, {
      language: 'en-US', rate: 0.92, pitch: 1.0,
      onDone: () => { setAiSpeaking(false); onDone?.(); },
      onStopped: () => { setAiSpeaking(false); onDone?.(); },
    });
  }

  async function startConversation(s) {
    setScenario(s);
    setPhase('conversation');
    setMessages([]);
    setGptHistory([]);
    setAnalyses([]);
    setRecStatus('idle');

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
    if (aiSpeaking) Speech.stop();
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      Alert.alert('Microphone access needed', 'Enable microphone permission in your device settings.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    recordingStartRef.current = Date.now();
    setRecStatus('recording');
  }

  async function stopRecording() {
    const duration = Date.now() - (recordingStartRef.current ?? Date.now());
    setRecStatus('processing');
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });

      if (duration < 1200) {
        setRecStatus('idle');
        return;
      }

      const uri = recorder.uri;
      if (!uri) throw new Error('No audio recorded.');

      const base64Audio = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });
      const ext = uri.split('.').pop()?.toLowerCase() ?? 'm4a';

      const result = await processAudioTurn(base64Audio, ext, scenario.id, gptHistory);
      const { reply, userSummary, analysis } = result;

      const userMsg = { role: 'user', text: userSummary };
      const aiMsg   = { role: 'ai',   text: reply };

      setMessages(prev => [...prev, userMsg, aiMsg]);
      setGptHistory(prev => [
        ...prev,
        { role: 'user',      content: userSummary },
        { role: 'assistant', content: reply },
      ]);
      setAnalyses(prev => [...prev, analysis]);

      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      speakAI(reply);
    } catch (e) {
      Alert.alert('Something went wrong', e.message);
    } finally {
      setRecStatus('idle');
    }
  }

  async function endConversation() {
    Speech.stop();
    if (analyses.length === 0) {
      setPhase('selecting');
      return;
    }
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
  }

  // ── Render phases ────────────────────────────────────────────────────────

  if (phase === 'selecting') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.selectContent}>
        <Text style={styles.selectTitle}>Choose a Scenario</Text>
        <Text style={styles.selectSubtitle}>Pick what you want to practice</Text>
        {SCENARIOS.map(s => (
          <TouchableOpacity key={s.id} style={styles.scenarioCard} onPress={() => startConversation(s)} activeOpacity={0.8}>
            <Text style={styles.scenarioIcon}>{s.icon}</Text>
            <View style={styles.scenarioText}>
              <Text style={styles.scenarioLabel}>{s.label}</Text>
              <Text style={styles.scenarioDesc}>{s.desc}</Text>
            </View>
            <Text style={styles.scenarioArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  }

  if (phase === 'analyzing') {
    return (
      <View style={styles.centerScreen}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={styles.analyzingText}>Analyzing your conversation...</Text>
      </View>
    );
  }

  if (phase === 'stats' && stats) {
    const gradeColor = stats.grade?.startsWith('A') ? '#22C55E'
      : stats.grade?.startsWith('B') ? '#4F46E5'
      : stats.grade?.startsWith('C') ? '#F97316'
      : '#EF4444';

    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.statsContent}>
        <Text style={styles.statsHeading}>Session Complete</Text>
        <Text style={styles.statsScenario}>{scenario?.label}</Text>

        <View style={[styles.gradeCircle, { borderColor: gradeColor }]}>
          <Text style={[styles.gradeText, { color: gradeColor }]}>{stats.grade}</Text>
        </View>
        <Text style={styles.gradeDesc}>{stats.gradeDesc}</Text>

        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{stats.totalFillers ?? 0}</Text>
            <Text style={styles.statLabel}>Filler Words</Text>
            {stats.topFillers ? <Text style={styles.statSub}>"{stats.topFillers}"</Text> : null}
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{stats.avgConfidence ?? '—'}</Text>
            <Text style={styles.statLabel}>Confidence</Text>
            <Text style={styles.statSub}>out of 10</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>
              {stats.pace?.toLowerCase().includes('fast') ? '⚡'
                : stats.pace?.toLowerCase().includes('slow') ? '🐢' : '✓'}
            </Text>
            <Text style={styles.statLabel}>Pace</Text>
            <Text style={styles.statSub}>{stats.pace}</Text>
          </View>
        </View>

        {stats.strongestMoment && (
          <View style={styles.calloutCard}>
            <Text style={styles.calloutLabel}>STRONGEST MOMENT</Text>
            <Text style={styles.calloutText}>{stats.strongestMoment}</Text>
          </View>
        )}

        {stats.improvements?.length > 0 && (
          <View style={styles.improvementsCard}>
            <Text style={styles.calloutLabel}>WORK ON</Text>
            {stats.improvements.map((item, i) => (
              <Text key={i} style={styles.improvementItem}>• {item}</Text>
            ))}
          </View>
        )}

        {stats.overallAssessment && (
          <Text style={styles.overallText}>{stats.overallAssessment}</Text>
        )}

        <View style={styles.statsButtons}>
          <TouchableOpacity style={styles.btnSecondary} onPress={() => startConversation(scenario)}>
            <Text style={styles.btnSecondaryText}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnPrimary} onPress={reset}>
            <Text style={styles.btnPrimaryText}>New Scenario</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // ── Conversation phase ───────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.convHeader}>
        <Text style={styles.convTitle}>{scenario?.icon} {scenario?.label}</Text>
        <TouchableOpacity style={styles.endButton} onPress={endConversation}>
          <Text style={styles.endButtonText}>End</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {messages.map((msg, i) => (
          <View key={i} style={[styles.row, msg.role === 'user' && styles.rowUser]}>
            {msg.role === 'ai' && (
              <View style={styles.avatar}><Text style={styles.avatarText}>J</Text></View>
            )}
            <View style={msg.role === 'ai' ? styles.bubbleAI : styles.bubbleUser}>
              {msg.role === 'user' && <Text style={styles.speechLabel}>YOU</Text>}
              <Text style={[styles.bubbleText, msg.role === 'user' && styles.bubbleTextUser]}>
                {msg.text}
              </Text>
            </View>
          </View>
        ))}

        {aiSpeaking && (
          <View style={styles.row}>
            <View style={styles.avatar}><Text style={styles.avatarText}>J</Text></View>
            <View style={styles.bubbleAI}>
              <Text style={styles.typingDots}>● ● ●</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {recStatus === 'processing' ? (
          <View style={styles.processingWrap}>
            <ActivityIndicator size="large" color="#4F46E5" />
            <Text style={styles.footerLabel}>Listening...</Text>
          </View>
        ) : (
          <>
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                style={[
                  styles.micButton,
                  recStatus === 'recording' && styles.micButtonActive,
                  aiSpeaking && styles.micButtonDisabled,
                ]}
                onPress={recStatus === 'idle' ? startRecording : stopRecording}
                disabled={aiSpeaking}
                activeOpacity={0.85}
              >
                <Text style={styles.micIcon}>🎤</Text>
              </TouchableOpacity>
            </Animated.View>
            <Text style={styles.footerLabel}>
              {aiSpeaking ? 'Jordan is speaking...'
                : recStatus === 'recording' ? 'Tap to stop'
                : 'Tap to speak'}
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  // Selection
  selectContent: { padding: 20, paddingBottom: 40 },
  selectTitle: { fontSize: 26, fontWeight: '800', color: '#111827', marginBottom: 4 },
  selectSubtitle: { fontSize: 15, color: '#6B7280', marginBottom: 24 },
  scenarioCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  scenarioIcon: { fontSize: 28, marginRight: 14 },
  scenarioText: { flex: 1 },
  scenarioLabel: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 2 },
  scenarioDesc: { fontSize: 13, color: '#6B7280' },
  scenarioArrow: { fontSize: 22, color: '#C7D2FE', fontWeight: '300' },

  // Conversation
  convHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  convTitle: { fontSize: 17, fontWeight: '700', color: '#111827' },
  endButton: {
    backgroundColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6,
  },
  endButtonText: { color: '#EF4444', fontWeight: '700', fontSize: 14 },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 8, gap: 10 },

  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rowUser: { justifyContent: 'flex-end' },
  avatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#4F46E5',
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  bubbleAI: {
    flex: 1, backgroundColor: '#fff', borderRadius: 18, borderBottomLeftRadius: 4,
    paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  bubbleUser: {
    maxWidth: '78%', backgroundColor: '#4F46E5',
    borderRadius: 18, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 10,
  },
  bubbleText: { fontSize: 15, color: '#111827', lineHeight: 22 },
  bubbleTextUser: { color: '#fff' },
  speechLabel: { fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.6)', letterSpacing: 0.8, marginBottom: 3 },
  typingDots: { fontSize: 10, color: '#9CA3AF', letterSpacing: 4 },

  footer: {
    alignItems: 'center', paddingVertical: 24,
    borderTopWidth: 1, borderTopColor: '#E5E7EB', backgroundColor: '#fff', gap: 10,
  },
  processingWrap: { alignItems: 'center', gap: 10 },
  micButton: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: '#4F46E5',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#4F46E5', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },
  micButtonActive: { backgroundColor: '#EF4444', shadowColor: '#EF4444' },
  micButtonDisabled: { backgroundColor: '#C7D2FE', shadowOpacity: 0 },
  micIcon: { fontSize: 30 },
  footerLabel: { fontSize: 13, color: '#6B7280', fontWeight: '500' },

  // Analyzing
  centerScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  analyzingText: { fontSize: 16, color: '#6B7280', fontWeight: '500' },

  // Stats
  statsContent: { padding: 20, paddingBottom: 48, alignItems: 'center' },
  statsHeading: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 4 },
  statsScenario: { fontSize: 14, color: '#6B7280', marginBottom: 24 },
  gradeCircle: {
    width: 100, height: 100, borderRadius: 50, borderWidth: 4,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  gradeText: { fontSize: 38, fontWeight: '800' },
  gradeDesc: { fontSize: 15, color: '#6B7280', marginBottom: 28, textAlign: 'center' },
  statsGrid: { flexDirection: 'row', gap: 12, marginBottom: 20, width: '100%' },
  statBox: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 14, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  statValue: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 4 },
  statLabel: { fontSize: 11, fontWeight: '600', color: '#6B7280', textAlign: 'center' },
  statSub: { fontSize: 11, color: '#9CA3AF', textAlign: 'center', marginTop: 2 },
  calloutCard: {
    backgroundColor: '#EEF2FF', borderRadius: 14, padding: 16, width: '100%', marginBottom: 12,
  },
  improvementsCard: {
    backgroundColor: '#FFF7ED', borderRadius: 14, padding: 16, width: '100%', marginBottom: 12,
  },
  calloutLabel: { fontSize: 10, fontWeight: '700', color: '#6B7280', letterSpacing: 0.8, marginBottom: 8 },
  calloutText: { fontSize: 14, color: '#374151', lineHeight: 20 },
  improvementItem: { fontSize: 14, color: '#374151', lineHeight: 22 },
  overallText: { fontSize: 14, color: '#6B7280', lineHeight: 22, textAlign: 'center', marginBottom: 28 },
  statsButtons: { flexDirection: 'row', gap: 12, width: '100%' },
  btnPrimary: {
    flex: 1, backgroundColor: '#4F46E5', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnSecondary: {
    flex: 1, backgroundColor: '#E0E7FF', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center',
  },
  btnSecondaryText: { color: '#4F46E5', fontWeight: '700', fontSize: 15 },
});
