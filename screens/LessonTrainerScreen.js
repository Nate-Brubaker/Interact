import { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated,
  ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useAudioRecorder, useAudioRecorderState,
  requestRecordingPermissionsAsync, setAudioModeAsync,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme } from '../lib/theme';
import { UNITS } from '../constants/lessons';

const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim();
const WAV_OPTIONS = { extension: '.wav', sampleRate: 16000, numberOfChannels: 1, bitRate: 128000 };

async function fetchGPT(messages, model = 'gpt-4o', maxTokens = 150) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function extractJSON(raw) {
  let s = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  const start = s.search(/[{[]/);
  const end   = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

// phases: loading | conversation | processing | grading | pass | fail
export default function LessonTrainerScreen({ route, navigation }) {
  const { lessonId, unitId } = route.params;
  const { colors: C, dark } = useTheme();
  const insets = useSafeAreaInsets();

  const unit   = UNITS.find(u => u.id === unitId);
  const lesson = unit?.lessons.find(l => l.id === lessonId);

  const [phase,     setPhase]     = useState('loading');
  const [aiText,    setAiText]    = useState('');
  const [recStatus, setRecStatus] = useState('idle');
  const [turnCount, setTurnCount] = useState(0);
  const [feedback,  setFeedback]  = useState('');

  const gptHistory = useRef([]);
  const recorder   = useAudioRecorder(WAV_OPTIONS);
  useAudioRecorderState(recorder, 100);
  const pulseAnim   = useRef(new Animated.Value(1)).current;
  const pulseLoop   = useRef(null);
  const mountedRef  = useRef(true);
  const timerRef    = useRef(null);
  const unitColor   = unit?.color ?? '#6366F1';

  useEffect(() => {
    mountedRef.current = true;
    init();
    return () => {
      mountedRef.current = false;
      pulseLoop.current?.stop();
      clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (recStatus === 'recording') {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.35, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 600, useNativeDriver: true }),
        ])
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      pulseAnim.setValue(1);
    }
  }, [recStatus]);

  async function init() {
    setPhase('loading');
    setAiText('');
    setTurnCount(0);
    setFeedback('');
    gptHistory.current = [];

    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      Alert.alert('Microphone access needed', 'Please enable microphone access in Settings.');
      navigation.goBack();
      return;
    }
    try {
      const data = await fetchGPT([
        { role: 'system', content: lesson.trainerPrompt },
        { role: 'user',   content: 'Start the conversation. One or two sentences only. End with something they can respond to.' },
      ], 'gpt-4o', 120);
      const opening = data.choices[0].message.content.trim();
      gptHistory.current = [{ role: 'assistant', content: opening }];
      setAiText(opening);
      setPhase('conversation');
    } catch {
      Alert.alert('Could not connect', 'Check your connection and try again.');
      navigation.goBack();
    }
  }

  async function startRecording() {
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecStatus('recording');
    } catch (e) {
      Alert.alert('Recording failed', e.message);
    }
  }

  async function stopRecording() {
    setRecStatus('processing');
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error('No audio captured.');
      const base64Audio = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const ext = uri.split('.').pop()?.toLowerCase() ?? 'wav';

      const systemPrompt = `${lesson.trainerPrompt}

After responding, evaluate the user's message. Return a JSON object with exactly five fields:
- "reply": your 1-2 sentence in-character response.
- "userTranscript": verbatim transcription of what the user said. If inaudible, set to null and reply "Sorry, I couldn't quite hear that - could you say that again?"
- "goalMet": true if the user genuinely demonstrated the skill goal in this turn or a previous one. Be generous - a sincere attempt counts. Set this as soon as it is clearly met, even on the first turn.
- "feedback": if goalMet is true, one sentence under 15 words saying exactly what they did well. No em dashes. Otherwise null.
- "cutOff": true if the user is being rude or hostile, OR if after 2 or more exchanges it is clear they are not going to demonstrate the skill (e.g. the goal is to ask questions but they have only talked about themselves every turn). Voice-only judgment. Awkwardness does not count.
- "cutOffFeedback": if cutOff is true, one blunt sentence on what to try differently. No em dashes. Otherwise null.

Return only valid JSON.`;

      const data = await fetchGPT([
        { role: 'system', content: systemPrompt },
        ...gptHistory.current,
        {
          role: 'user',
          content: [
            { type: 'input_audio', input_audio: { data: base64Audio, format: ext } },
            { type: 'text', text: 'Respond to what I just said.' },
          ],
        },
      ], 'gpt-4o-audio-preview', 200);

      const raw = data.choices[0].message.content.trim();
      let reply = raw;
      let newTurnCount = turnCount;
      try {
        const parsed = extractJSON(raw);
        reply = parsed.reply ?? raw;
        if (parsed.userTranscript) {
          gptHistory.current = [
            ...gptHistory.current,
            { role: 'user',      content: parsed.userTranscript },
            { role: 'assistant', content: reply },
          ];
          newTurnCount = turnCount + 1;
          setTurnCount(newTurnCount);
        }
        if (parsed.cutOff) {
          if (!mountedRef.current) return;
          setFeedback(parsed.cutOffFeedback ?? 'Try again with a different approach.');
          setRecStatus('idle');
          setPhase('fail');
          return;
        }
        if (parsed.goalMet) {
          if (!mountedRef.current) return;
          setFeedback(parsed.feedback ?? 'Nice effort on that one.');
          setRecStatus('idle');
          setPhase('pass');
          return;
        }
      } catch {
        gptHistory.current = [...gptHistory.current, { role: 'assistant', content: reply }];
      }

      setAiText(reply);
      setRecStatus('idle');
    } catch {
      setRecStatus('idle');
      Alert.alert('Processing failed', 'Try speaking again.');
    }
  }

  function handleMicPress() {
    if (recStatus === 'idle')      startRecording();
    else if (recStatus === 'recording') stopRecording();
  }

  function handleContinue() {
    navigation.navigate('LessonDetail', { lessonId, unitId, practiceCompleted: true });
  }

  if (!lesson || !unit) return null;

  const micColor = recStatus === 'recording' ? '#EF4444' : unitColor;

  // ── Grading ──────────────────────────────────────────────────────────────────

  if (phase === 'grading') {
    return (
      <View style={[S.root, { backgroundColor: C.bg, paddingTop: insets.top }]}>
        <View style={S.resultContainer}>
          <ActivityIndicator size="large" color={unitColor} />
          <Text style={[S.resultSubtitle, { color: C.textMuted, marginTop: 20 }]}>Reviewing your conversation...</Text>
        </View>
      </View>
    );
  }

  // ── Pass ──────────────────────────────────────────────────────────────────────

  if (phase === 'pass') {
    return (
      <View style={[S.root, { backgroundColor: C.bg, paddingTop: insets.top }]}>
        <View style={S.resultContainer}>
          <View style={[S.resultCircle, { backgroundColor: '#22C55E18', borderColor: '#22C55E55' }]}>
            <Ionicons name="checkmark-circle" size={64} color="#22C55E" />
          </View>
          <Text style={[S.resultTitle, { color: C.text }]}>Nice work!</Text>
          <Text style={[S.resultSubtitle, { color: C.textMuted }]}>{feedback}</Text>
          <TouchableOpacity onPress={handleContinue} style={[S.resultBtn, { backgroundColor: unitColor }]}>
            <Text style={S.resultBtnLabel}>Continue</Text>
            <Ionicons name="arrow-forward" size={16} color="#fff" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Fail ──────────────────────────────────────────────────────────────────────

  if (phase === 'fail') {
    return (
      <View style={[S.root, { backgroundColor: C.bg, paddingTop: insets.top }]}>
        <View style={S.resultContainer}>
          <View style={[S.resultCircle, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B55' }]}>
            <Ionicons name="refresh-circle" size={64} color="#F59E0B" />
          </View>
          <Text style={[S.resultTitle, { color: C.text }]}>Not quite</Text>
          <Text style={[S.resultSubtitle, { color: C.textMuted }]}>{feedback}</Text>
          <TouchableOpacity onPress={init} style={[S.resultBtn, { backgroundColor: unitColor }]}>
            <Ionicons name="refresh" size={16} color="#fff" style={{ marginRight: 6 }} />
            <Text style={S.resultBtnLabel}>Try Again</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleContinue} style={{ marginTop: 16 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: C.textMuted }}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Conversation ──────────────────────────────────────────────────────────────

  return (
    <View style={[S.root, { backgroundColor: dark ? '#0A0F1E' : '#F0F4FF' }]}>
      {/* Header */}
      <View style={[S.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => { clearTimeout(timerRef.current); navigation.goBack(); }} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-down" size={24} color={dark ? '#94A3B8' : '#64748B'} />
        </TouchableOpacity>
        <View style={[S.titlePill, { backgroundColor: unitColor + '20' }]}>
          <Text style={[S.titleLabel, { color: unitColor }]} numberOfLines={1}>{lesson.title}</Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      {/* Goal banner */}
      <View style={[S.goalBanner, { backgroundColor: unitColor + '10', borderColor: unitColor + '30' }]}>
        <Text style={[S.goalText, { color: dark ? '#94A3B8' : '#475569' }]} numberOfLines={3}>
          {lesson.practice.focus}
        </Text>
      </View>

      {/* Message area */}
      <View style={S.messageArea}>
        {phase === 'loading' && <ActivityIndicator size="large" color={unitColor} />}
        {recStatus === 'processing' && (
          <View style={{ alignItems: 'center', gap: 14 }}>
            <ActivityIndicator size="large" color={unitColor} />
            <Text style={[S.statusText, { color: dark ? '#94A3B8' : '#64748B' }]}>Listening...</Text>
          </View>
        )}
        {phase === 'conversation' && recStatus !== 'processing' && aiText !== '' && (
          <View style={[S.aiMessageBubble, { backgroundColor: dark ? '#1E293B' : '#fff' }]}>
            <View style={[S.aiDot, { backgroundColor: unitColor }]} />
            <Text style={[S.aiMessageText, { color: C.text }]}>{aiText}</Text>
          </View>
        )}
      </View>

      {/* Instruction */}
      {phase === 'conversation' && recStatus !== 'processing' && (
        <Text style={[S.instructionText, { color: dark ? '#64748B' : '#94A3B8' }]}>
          {recStatus === 'idle' ? 'Tap to speak' : 'Tap to send'}
        </Text>
      )}

      {/* Mic + Done */}
      <View style={[S.micArea, { paddingBottom: insets.bottom + 32 }]}>
        {phase === 'conversation' && (
          <>
            <TouchableOpacity onPress={handleMicPress} activeOpacity={0.8} disabled={recStatus === 'processing'}>
              <Animated.View style={[S.micRing, {
                backgroundColor: micColor + '18',
                transform: [{ scale: pulseAnim }],
              }]}>
                <View style={[S.micButton, { backgroundColor: recStatus === 'processing' ? unitColor + '60' : micColor }]}>
                  <Ionicons name={recStatus === 'recording' ? 'stop' : 'mic'} size={32} color="#fff" />
                </View>
              </Animated.View>
            </TouchableOpacity>

          </>
        )}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  root:   { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 },

  titlePill:  { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, maxWidth: '60%' },
  titleLabel: { fontSize: 12, fontWeight: '700' },

  goalBanner: { marginHorizontal: 20, borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  goalText:   { fontSize: 12, fontWeight: '500', lineHeight: 18 },

  messageArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },

  aiMessageBubble: {
    borderRadius: 20, padding: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
    maxWidth: '100%',
  },
  aiDot:        { width: 8, height: 8, borderRadius: 4, marginBottom: 10 },
  aiMessageText: { fontSize: 20, fontWeight: '600', lineHeight: 30 },

  statusText:     { fontSize: 16, fontWeight: '500' },
  instructionText: { textAlign: 'center', fontSize: 13, fontWeight: '600', marginBottom: 12 },

  micArea:   { alignItems: 'center', paddingTop: 12, gap: 20 },
  micRing:   { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center' },
  micButton: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  resultContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  resultCircle:    { width: 120, height: 120, borderRadius: 60, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  resultTitle:     { fontSize: 28, fontWeight: '900', marginBottom: 10 },
  resultSubtitle:  { fontSize: 16, textAlign: 'center', lineHeight: 24, marginBottom: 36 },
  resultBtn:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 32, paddingVertical: 16, borderRadius: 16 },
  resultBtnLabel:  { fontSize: 16, fontWeight: '700', color: '#fff' },
});
