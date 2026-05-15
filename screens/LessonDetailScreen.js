import { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Animated, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme';
import { UNITS } from '../constants/lessons';
import { CHALLENGES } from '../constants/challenges';
import { useData } from '../lib/DataContext';
import { markChallengeComplete } from '../lib/api';

const STORAGE_KEY  = 'learn_completed';
const STEPS = [
  { key: 'learn',     label: 'Learn',     icon: 'book-outline' },
  { key: 'quiz',      label: 'Quiz',      icon: 'help-circle-outline' },
  { key: 'practice',  label: 'Practice',  icon: 'mic-outline' },
  { key: 'challenge', label: 'Challenge', icon: 'trophy-outline' },
];

export default function LessonDetailScreen({ route, navigation }) {
  const { lessonId, unitId } = route.params;
  const { colors: C, dark } = useTheme();
  const insets = useSafeAreaInsets();
  const { completedIds, reload } = useData();

  const unit   = UNITS.find(u => u.id === unitId);
  const lesson = unit?.lessons.find(l => l.id === lessonId);

  const totalCards = lesson?.content?.length ?? 0;
  const totalQ     = lesson?.quiz?.length    ?? 0;

  const [step,        setStep]        = useState(0);
  const [cardIndex,   setCardIndex]   = useState(0);
  const [qIndex,      setQIndex]      = useState(0);
  const [quizAnswers, setQuizAnswers] = useState(() => Array(totalQ).fill(null));
  const [quizDone,    setQuizDone]    = useState(false);
  const [completing,  setCompleting]  = useState(false);

  const fadeAnim   = useRef(new Animated.Value(1)).current;
  const progressKey = `lesson_progress_${lessonId}`;

  // Restore saved progress on mount
  useEffect(() => {
    AsyncStorage.getItem(progressKey).then(raw => {
      if (!raw) return;
      try {
        const s = JSON.parse(raw);
        if (s.step      != null) setStep(s.step);
        if (s.cardIndex != null) setCardIndex(s.cardIndex);
        if (s.qIndex    != null) setQIndex(s.qIndex);
        if (s.quizDone)          setQuizDone(true);
        if (Array.isArray(s.quizAnswers) && s.quizAnswers.length === totalQ) {
          setQuizAnswers(s.quizAnswers);
        }
      } catch {}
    });
  }, []);

  // Advance to challenge step when returning from LessonTrainer with success
  useEffect(() => {
    if (route.params?.practiceCompleted) {
      setStep(3);
      navigation.setParams({ practiceCompleted: undefined });
    }
  }, [route.params?.practiceCompleted]);

  if (!unit || !lesson) return null;

  const challenge     = CHALLENGES.find(c => c.id === lesson.challengeId);
  const challengeDone = challenge ? completedIds.has(challenge.id) : false;
  const unitColor     = unit.color;

  function fadeTransition(cb) {
    Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      cb();
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  }

  function nextStep() {
    fadeTransition(() => setStep(s => s + 1));
  }

  async function handleBack() {
    try {
      await AsyncStorage.setItem(progressKey, JSON.stringify({ step, cardIndex, qIndex, quizAnswers, quizDone }));
    } catch {}
    navigation.goBack();
  }

  // ── Learn ──────────────────────────────────────────────────────────────────

  function nextCard() {
    if (cardIndex < totalCards - 1) fadeTransition(() => setCardIndex(i => i + 1));
    else nextStep();
  }

  function prevCard() {
    if (cardIndex > 0) fadeTransition(() => setCardIndex(i => i - 1));
  }

  // ── Quiz ───────────────────────────────────────────────────────────────────

  function selectAnswer(idx) {
    if (quizAnswers[qIndex] !== null) return;
    setQuizAnswers(prev => { const n = [...prev]; n[qIndex] = idx; return n; });
  }

  function nextQuestion() {
    if (qIndex < totalQ - 1) fadeTransition(() => setQIndex(i => i + 1));
    else setQuizDone(true);
  }

  function prevQuestion() {
    if (qIndex > 0) fadeTransition(() => setQIndex(i => i - 1));
    else fadeTransition(() => setStep(0));
  }

  // ── Complete lesson ────────────────────────────────────────────────────────

  async function completeLesson() {
    const raw  = await AsyncStorage.getItem(STORAGE_KEY);
    const done = new Set(raw ? JSON.parse(raw) : []);
    done.add(lesson.id);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...done]));
    await AsyncStorage.removeItem(progressKey);
    navigation.goBack();
  }

  async function handleAcceptChallenge() {
    if (!challenge || challengeDone || completing) return;
    setCompleting(true);
    try {
      await markChallengeComplete(challenge.id);
      await reload();
    } catch {}
    setCompleting(false);
  }

  // ── Step progress bar ──────────────────────────────────────────────────────

  function StepBar() {
    return (
      <View style={[S.stepBar, { backgroundColor: C.card }]}>
        {STEPS.map((s, i) => {
          const active = i === step;
          const done   = i < step;
          return (
            <View key={s.key} style={S.stepItem}>
              <View style={[
                S.stepDot,
                { backgroundColor: done ? unitColor : active ? unitColor + '22' : C.bgAlt,
                  borderWidth: active ? 2 : 0, borderColor: unitColor },
              ]}>
                {done
                  ? <Ionicons name="checkmark" size={12} color="#fff" />
                  : <Ionicons name={s.icon} size={12} color={active ? unitColor : C.textMuted} />}
              </View>
              <Text style={{ fontSize: 9, fontWeight: '600', color: active ? unitColor : done ? unitColor : C.textMuted, marginTop: 3 }}>
                {s.label}
              </Text>
              {i < STEPS.length - 1 && (
                <View style={[S.stepLine, { backgroundColor: done ? unitColor : C.border }]} />
              )}
            </View>
          );
        })}
      </View>
    );
  }

  // ── LEARN ──────────────────────────────────────────────────────────────────

  function LearnStep() {
    const card = lesson.content[cardIndex];
    return (
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={S.stepContent} showsVerticalScrollIndicator={false}>
          <View style={[S.illustration, { backgroundColor: card.color + '18' }]}>
            <View style={[S.illustrationInner, { backgroundColor: card.color + '30' }]}>
              <Ionicons name={card.icon} size={64} color={card.color} />
            </View>
          </View>

          <View style={S.dotRow}>
            {lesson.content.map((_, i) => (
              <View key={i} style={[S.dot, { backgroundColor: i === cardIndex ? unitColor : C.border }]} />
            ))}
          </View>

          <Text style={[S.cardHeading, { color: C.text }]}>{card.heading}</Text>
          <Text style={[S.cardBody, { color: C.textSec }]}>{card.body}</Text>

          {cardIndex === totalCards - 1 && lesson.insight && (
            <View style={[S.insightBox, { backgroundColor: unitColor + '14', borderLeftColor: unitColor }]}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: unitColor, fontStyle: 'italic', lineHeight: 22 }}>
                "{lesson.insight}"
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={[S.navRow, { backgroundColor: C.bg }]}>
          <TouchableOpacity
            onPress={prevCard}
            disabled={cardIndex === 0}
            style={[S.navBtn, { backgroundColor: C.card, opacity: cardIndex === 0 ? 0.3 : 1 }]}
          >
            <Ionicons name="arrow-back" size={18} color={C.text} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={nextCard}
            style={[S.navBtnPrimary, { backgroundColor: unitColor, flex: 1, justifyContent: 'center' }]}
          >
            <Text style={S.navBtnLabel}>{cardIndex < totalCards - 1 ? 'Next' : 'Start Quiz'}</Text>
            <Ionicons name="arrow-forward" size={16} color="#fff" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }

  // ── QUIZ ───────────────────────────────────────────────────────────────────

  function QuizStep() {
    if (quizDone) {
      const quizScore = quizAnswers.filter((a, i) => a === lesson.quiz[i]?.correct).length;
      const perfect   = quizScore === totalQ;
      return (
        <Animated.View style={{ flex: 1, opacity: fadeAnim, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <View style={[S.scoreCircle, { borderColor: perfect ? '#22C55E' : unitColor }]}>
            <Text style={[S.scoreNum, { color: perfect ? '#22C55E' : unitColor }]}>{quizScore}/{totalQ}</Text>
            <Text style={{ fontSize: 12, color: C.textMuted, fontWeight: '600' }}>CORRECT</Text>
          </View>
          <Text style={[S.cardHeading, { color: C.text, textAlign: 'center', marginTop: 24 }]}>
            {perfect ? 'Perfect score!' : quizScore >= totalQ / 2 ? 'Nice work!' : 'Keep practicing!'}
          </Text>
          <Text style={[S.cardBody, { color: C.textMuted, textAlign: 'center' }]}>
            {perfect ? 'You nailed every question. On to practice.' : 'You can always revisit this lesson to review the concepts.'}
          </Text>
          <TouchableOpacity onPress={nextStep} style={[S.navBtnPrimary, { backgroundColor: unitColor, alignSelf: 'stretch', justifyContent: 'center', marginTop: 32 }]}>
            <Text style={S.navBtnLabel}>Continue to Practice</Text>
            <Ionicons name="arrow-forward" size={16} color="#fff" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </Animated.View>
      );
    }

    const q             = lesson.quiz[qIndex];
    const currentAnswer = quizAnswers[qIndex];
    const answered      = currentAnswer !== null;
    const LETTERS       = ['A', 'B', 'C', 'D'];

    return (
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={S.stepContent} showsVerticalScrollIndicator={false}>
          <View style={[S.quizHeader, { backgroundColor: unitColor + '14' }]}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: unitColor, letterSpacing: 1 }}>
              QUESTION {qIndex + 1} OF {totalQ}
            </Text>
          </View>

          <Text style={[S.questionText, { color: C.text }]}>{q.question}</Text>

          <View style={{ gap: 10, marginTop: 8 }}>
            {q.options.map((opt, i) => {
              const isCorrect  = i === q.correct;
              const isSelected = i === currentAnswer;
              let bg = C.card, border = C.border, textColor = C.text;

              if (answered) {
                if (isCorrect)       { bg = '#22C55E18'; border = '#22C55E'; textColor = '#22C55E'; }
                else if (isSelected) { bg = '#EF444418'; border = '#EF4444'; textColor = '#EF4444'; }
              } else if (isSelected) {
                bg = unitColor + '18'; border = unitColor;
              }

              return (
                <TouchableOpacity
                  key={i}
                  onPress={() => selectAnswer(i)}
                  activeOpacity={answered ? 1 : 0.7}
                  style={[S.optionBtn, { backgroundColor: bg, borderColor: border }]}
                >
                  <View style={[S.optionLetter, { backgroundColor: answered && isCorrect ? '#22C55E' : answered && isSelected ? '#EF4444' : unitColor + '18' }]}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: answered && (isCorrect || isSelected) ? '#fff' : unitColor }}>
                      {LETTERS[i]}
                    </Text>
                  </View>
                  <Text style={[S.optionText, { color: textColor }]}>{opt}</Text>
                  {answered && isCorrect  && <Ionicons name="checkmark-circle" size={18} color="#22C55E" />}
                  {answered && isSelected && !isCorrect && <Ionicons name="close-circle" size={18} color="#EF4444" />}
                </TouchableOpacity>
              );
            })}
          </View>

          {answered && (
            <View style={[S.feedbackBox, {
              backgroundColor: currentAnswer === q.correct ? '#22C55E14' : '#EF444414',
              borderColor: currentAnswer === q.correct ? '#22C55E' : '#EF4444',
            }]}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: currentAnswer === q.correct ? '#22C55E' : '#EF4444' }}>
                {currentAnswer === q.correct ? '✓ Correct!' : '✗ Not quite'}
              </Text>
              <Text style={{ fontSize: 13, color: C.textSec, marginTop: 4, lineHeight: 20 }}>
                The correct answer is: {q.options[q.correct]}
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={[S.navRow, { backgroundColor: C.bg }]}>
          <TouchableOpacity
            onPress={prevQuestion}
            style={[S.navBtn, { backgroundColor: C.card }]}
          >
            <Ionicons name="arrow-back" size={18} color={C.text} />
          </TouchableOpacity>
          {answered && (
            <TouchableOpacity onPress={nextQuestion} style={[S.navBtnPrimary, { backgroundColor: unitColor, flex: 1, justifyContent: 'center' }]}>
              <Text style={S.navBtnLabel}>{qIndex < totalQ - 1 ? 'Next Question' : 'See Results'}</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>
    );
  }

  // ── PRACTICE ───────────────────────────────────────────────────────────────

  function PracticeStep() {
    const p = lesson.practice;
    return (
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={S.stepContent} showsVerticalScrollIndicator={false}>
          <View style={[S.illustration, { backgroundColor: unitColor + '14' }]}>
            <View style={[S.illustrationInner, { backgroundColor: unitColor + '28' }]}>
              <Ionicons name="mic-outline" size={64} color={unitColor} />
            </View>
          </View>

          <Text style={[S.cardHeading, { color: C.text }]}>Put It Into Practice</Text>
          <Text style={[S.cardBody, { color: C.textSec }]}>
            Have a short conversation and try what you just learned. Here is your goal:
          </Text>

          <View style={[S.focusBox, { backgroundColor: unitColor + '12', borderLeftColor: unitColor }]}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: unitColor, marginBottom: 6, letterSpacing: 0.5 }}>YOUR GOAL</Text>
            <Text style={{ fontSize: 14, color: C.textSec, lineHeight: 22, fontWeight: '500' }}>{p.focus}</Text>
          </View>
        </ScrollView>

        <View style={[S.navRow, { backgroundColor: C.bg, gap: 10 }]}>
          <TouchableOpacity
            onPress={() => navigation.navigate('LessonTrainer', { lessonId: lesson.id, unitId: unit.id })}
            style={[S.navBtnPrimary, { backgroundColor: unitColor, flex: 1, justifyContent: 'center' }]}
          >
            <Ionicons name="mic-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
            <Text style={S.navBtnLabel}>Start Practice</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={nextStep} style={[S.navBtn, { backgroundColor: C.card }]}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: C.textMuted }}>Skip</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }

  // ── CHALLENGE ──────────────────────────────────────────────────────────────

  function ChallengeStep() {
    if (!challenge) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <TouchableOpacity onPress={completeLesson} style={[S.navBtnPrimary, { backgroundColor: unitColor }]}>
            <Text style={S.navBtnLabel}>Complete Lesson</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const DIFF_COLOR = { Easy: '#22C55E', Medium: '#F97316', Hard: '#EF4444' };
    const dc = DIFF_COLOR[challenge.difficulty] ?? unitColor;

    return (
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={S.stepContent} showsVerticalScrollIndicator={false}>
          <View style={[S.illustration, { backgroundColor: dc + '14' }]}>
            <View style={[S.illustrationInner, { backgroundColor: dc + '28' }]}>
              <Ionicons name={challenge.icon} size={64} color={dc} />
            </View>
          </View>

          <Text style={[S.sectionLabel, { color: C.textMuted }]}>YOUR CHALLENGE</Text>
          <Text style={[S.cardHeading, { color: C.text }]}>{challenge.title}</Text>
          <Text style={[S.cardBody, { color: C.textSec }]}>{challenge.description}</Text>

          <View style={[S.challengeMeta, { backgroundColor: C.card }]}>
            <View style={[S.diffBadge, { backgroundColor: dc + '18' }]}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: dc }}>{challenge.difficulty}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="star" size={13} color="#F59E0B" />
              <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }}>{challenge.xp} XP</Text>
            </View>
            <View style={[S.tagBadge, { backgroundColor: C.bgAlt }]}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: C.textMuted }}>{challenge.tag}</Text>
            </View>
          </View>

          {challengeDone && (
            <View style={[S.doneBox, { backgroundColor: '#22C55E14', borderColor: '#22C55E' }]}>
              <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#22C55E', marginLeft: 8 }}>Challenge already completed</Text>
            </View>
          )}
        </ScrollView>

        <View style={[S.navRow, { backgroundColor: C.bg, gap: 10 }]}>
          {!challengeDone && (
            <TouchableOpacity
              onPress={handleAcceptChallenge}
              disabled={completing}
              style={[S.navBtn, { backgroundColor: dc + '18', borderWidth: 1.5, borderColor: dc + '55', flex: 1, justifyContent: 'center' }]}
            >
              {completing
                ? <ActivityIndicator size="small" color={dc} />
                : <>
                    <Ionicons name="trophy-outline" size={15} color={dc} style={{ marginRight: 6 }} />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: dc }}>Mark Done</Text>
                  </>}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={completeLesson}
            style={[S.navBtnPrimary, { backgroundColor: unitColor, flex: 1, justifyContent: 'center' }]}
          >
            <Ionicons name="checkmark-circle-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
            <Text style={S.navBtnLabel}>Complete Lesson</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }

  // ── Root render ────────────────────────────────────────────────────────────

  return (
    <View style={[S.root, { backgroundColor: C.bg }]}>
      <View style={[S.lessonHeader, { backgroundColor: unitColor, paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={handleBack} style={S.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={22} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
        <Text style={S.lessonUnit}>{unit.title.toUpperCase()}</Text>
        <Text style={S.lessonTitle} numberOfLines={2}>{lesson.title}</Text>
        <Text style={S.lessonDuration}>{lesson.duration}</Text>
      </View>

      <StepBar />

      {step === 0 && <LearnStep />}
      {step === 1 && <QuizStep />}
      {step === 2 && <PracticeStep />}
      {step === 3 && <ChallengeStep />}
    </View>
  );
}

const S = StyleSheet.create({
  root: { flex: 1 },

  lessonHeader:   { paddingHorizontal: 20, paddingBottom: 20 },
  backBtn:        { marginBottom: 10, alignSelf: 'flex-start' },
  lessonUnit:     { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.6)', letterSpacing: 1.2, marginBottom: 4 },
  lessonTitle:    { fontSize: 22, fontWeight: '900', color: '#fff', lineHeight: 28 },
  lessonDuration: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4, fontWeight: '500' },

  stepBar:  { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 12, alignItems: 'flex-start' },
  stepItem: { flex: 1, alignItems: 'center', position: 'relative' },
  stepDot:  { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepLine: { position: 'absolute', top: 14, left: '50%', width: '100%', height: 2 },

  stepContent: { padding: 20, paddingBottom: 16 },

  illustration:      { borderRadius: 24, height: 200, alignItems: 'center', justifyContent: 'center', marginBottom: 24, overflow: 'hidden' },
  illustrationInner: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center' },

  dotRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 20 },
  dot:    { width: 7, height: 7, borderRadius: 4 },

  cardHeading: { fontSize: 22, fontWeight: '900', lineHeight: 28, marginBottom: 12 },
  cardBody:    { fontSize: 15, lineHeight: 24, marginBottom: 16 },
  insightBox:  { borderLeftWidth: 3, paddingLeft: 14, paddingVertical: 12, borderRadius: 4, marginTop: 8 },
  sectionLabel:{ fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 },

  navRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, paddingBottom: 90 },
  navBtn:        { height: 50, borderRadius: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  navBtnPrimary: { height: 50, borderRadius: 14, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' },
  navBtnLabel:   { fontSize: 15, fontWeight: '700', color: '#fff' },

  quizHeader:   { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start', marginBottom: 16 },
  questionText: { fontSize: 18, fontWeight: '800', lineHeight: 26, marginBottom: 20 },
  optionBtn:    { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1.5, padding: 14 },
  optionLetter: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  optionText:   { flex: 1, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  feedbackBox:  { borderWidth: 1.5, borderRadius: 12, padding: 14, marginTop: 16 },

  scoreCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  scoreNum:    { fontSize: 36, fontWeight: '900' },

  focusBox: { borderLeftWidth: 3, paddingLeft: 14, paddingVertical: 12, borderRadius: 4, marginBottom: 8 },

  challengeMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 14, marginBottom: 16 },
  diffBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  tagBadge:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  doneBox:       { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 12, padding: 14 },
});
