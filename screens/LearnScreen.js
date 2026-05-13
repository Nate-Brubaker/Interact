import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../lib/theme';

const UNITS = [
  {
    id: 'unit_1',
    title: 'Starting Conversations',
    icon: 'chatbubbles-outline',
    color: '#3B82F6',
    lessons: [
      {
        id: 'l1_1', title: 'Why First Impressions Matter', duration: '3 min',
        summary: 'Research shows you form a first impression in as little as 7 seconds — and it\'s very hard to change. The good news: warm, open body language and a genuine smile do most of the heavy lifting before you say a single word.',
        insight: 'Lead with warmth before words.',
      },
      {
        id: 'l1_2', title: 'The FORD Technique', duration: '4 min',
        summary: 'FORD stands for Family, Occupation, Recreation, and Dreams. These four categories cover almost everything people love to talk about. When a conversation stalls, mentally pick one and ask an open-ended question to get it flowing again.',
        insight: 'Ask about their world — not yours.',
      },
      {
        id: 'l1_3', title: 'Breaking the Ice in Groups', duration: '5 min',
        summary: 'Joining a group mid-conversation feels awkward, but most groups welcome it. Make eye contact with the friendliest-looking person, wait for a natural pause, and offer a relevant comment — not a question, which can feel interrogative.',
        insight: 'A comment gets you in. A question puts you on the spot.',
      },
      {
        id: 'l1_4', title: 'Ending Conversations Gracefully', duration: '4 min',
        summary: 'Dragging out a goodbye or cutting it off abruptly both feel bad. The trick: signal the end before you start it. "I\'ll let you get back to it" or "Before I head off…" gives the other person a moment to mentally close the loop.',
        insight: 'Signal before you close.',
      },
    ],
  },
  {
    id: 'unit_2',
    title: 'Active Listening',
    icon: 'ear-outline',
    color: '#10B981',
    lessons: [
      {
        id: 'l2_1', title: 'The Listening Trap', duration: '3 min',
        summary: 'Most people "listen" while waiting for their turn to speak. Real listening means suspending your internal monologue and focusing entirely on what the other person is saying — including what they\'re not saying.',
        insight: 'Listen to understand, not to respond.',
      },
      {
        id: 'l2_2', title: 'Ask, Don\'t Assume', duration: '4 min',
        summary: 'Curiosity-driven questions — "What was that like for you?" — show genuine engagement. Avoid yes/no questions. The best follow-up is always a more specific version of something the person just shared.',
        insight: 'Your follow-up question is your grade.',
      },
      {
        id: 'l2_3', title: 'Reflecting & Paraphrasing', duration: '5 min',
        summary: 'After someone shares something meaningful, reflect it back: "So it sounds like you felt overlooked?" This confirms understanding and makes them feel truly heard — which is rarer than most people think.',
        insight: 'Feeling heard is the foundation of every real connection.',
      },
      {
        id: 'l2_4', title: 'Staying Present', duration: '3 min',
        summary: 'Your phone, background noise, what you\'re having for dinner — all compete for your attention. One trick: mentally narrate what the other person is saying as they say it. It forces your brain to process their words instead of your own thoughts.',
        insight: 'Presence is a choice you make every few seconds.',
      },
    ],
  },
  {
    id: 'unit_3',
    title: 'Reading Body Language',
    icon: 'body-outline',
    color: '#8B5CF6',
    locked: true,
    lessons: [
      { id: 'l3_1', title: 'What Your Posture Says', duration: '4 min', summary: '', insight: '' },
      { id: 'l3_2', title: 'Eye Contact Signals', duration: '3 min', summary: '', insight: '' },
      { id: 'l3_3', title: 'Mirroring Others', duration: '5 min', summary: '', insight: '' },
      { id: 'l3_4', title: 'Spotting Discomfort', duration: '4 min', summary: '', insight: '' },
    ],
  },
  {
    id: 'unit_4',
    title: 'Handling Awkward Moments',
    icon: 'alert-circle-outline',
    color: '#F59E0B',
    locked: true,
    lessons: [
      { id: 'l4_1', title: 'Silence Isn\'t Weird', duration: '3 min', summary: '', insight: '' },
      { id: 'l4_2', title: 'When You Say the Wrong Thing', duration: '4 min', summary: '', insight: '' },
      { id: 'l4_3', title: 'Recovering a Conversation', duration: '5 min', summary: '', insight: '' },
    ],
  },
  {
    id: 'unit_5',
    title: 'Group Dynamics',
    icon: 'people-outline',
    color: '#F43F5E',
    locked: true,
    lessons: [
      { id: 'l5_1', title: 'Finding Your Role', duration: '4 min', summary: '', insight: '' },
      { id: 'l5_2', title: 'Managing Dominant Personalities', duration: '5 min', summary: '', insight: '' },
      { id: 'l5_3', title: 'Contributing Without Interrupting', duration: '4 min', summary: '', insight: '' },
    ],
  },
];

const STORAGE_KEY = 'learn_completed';

export default function LearnScreen() {
  const { dark, colors: C } = useTheme();
  const [completed,    setCompleted]    = useState(new Set());
  const [expanded,     setExpanded]     = useState(new Set(['unit_1']));
  const [activeLesson, setActiveLesson] = useState(null);

  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(v => {
      if (v) setCompleted(new Set(JSON.parse(v)));
    });
  }, []));

  async function toggleComplete(lessonId) {
    const next = new Set(completed);
    if (next.has(lessonId)) next.delete(lessonId);
    else next.add(lessonId);
    setCompleted(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  }

  function toggleUnit(unitId) {
    const next = new Set(expanded);
    if (next.has(unitId)) next.delete(unitId);
    else next.add(unitId);
    setExpanded(next);
  }

  let nextLesson = null;
  let nextUnit   = null;
  outer: for (const unit of UNITS) {
    if (unit.locked) continue;
    for (const lesson of unit.lessons) {
      if (!completed.has(lesson.id)) { nextLesson = lesson; nextUnit = unit; break outer; }
    }
  }

  const unlockedLessons = UNITS.filter(u => !u.locked).flatMap(u => u.lessons);
  const totalDone       = unlockedLessons.filter(l => completed.has(l.id)).length;
  const totalLessons    = unlockedLessons.length;
  const overallPct      = totalLessons > 0 ? Math.round((totalDone / totalLessons) * 100) : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Overall progress */}
      <View style={[S.progressCard, { backgroundColor: C.card }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }}>
            {totalDone} of {totalLessons} lessons complete
          </Text>
          <View style={{ height: 5, borderRadius: 3, backgroundColor: dark ? '#1E293B' : '#F1F5F9', marginTop: 10, overflow: 'hidden' }}>
            <View style={{ height: '100%', width: `${overallPct}%`, backgroundColor: C.accent, borderRadius: 3 }} />
          </View>
        </View>
        <Text style={{ fontSize: 22, fontWeight: '900', color: C.accent, marginLeft: 18 }}>{overallPct}%</Text>
      </View>

      {/* Up next */}
      {nextLesson && (
        <>
          <Text style={[S.section, { color: C.textMuted, marginTop: 22 }]}>UP NEXT</Text>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setActiveLesson({ lesson: nextLesson, unit: nextUnit })}
            style={[S.continueCard, { backgroundColor: nextUnit.color }]}
          >
            <View style={S.continueRow}>
              <View style={[S.continueIconWrap, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
                <Ionicons name={nextUnit.icon} size={22} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.continueUnitLabel}>{nextUnit.title}</Text>
                <Text style={S.continueLessonTitle} numberOfLines={1}>{nextLesson.title}</Text>
              </View>
              <View style={[S.playBtn, { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
                <Ionicons name="play" size={14} color="#fff" />
              </View>
            </View>
            <Text style={S.continueMeta}>{nextLesson.duration} · Tap to start</Text>
          </TouchableOpacity>
        </>
      )}

      {/* Curriculum */}
      <Text style={[S.section, { color: C.textMuted, marginTop: 24 }]}>CURRICULUM</Text>
      {UNITS.map(unit => {
        const doneCt = unit.lessons.filter(l => completed.has(l.id)).length;
        const pct    = unit.lessons.length > 0 ? doneCt / unit.lessons.length : 0;
        const open   = expanded.has(unit.id);

        return (
          <View key={unit.id} style={[S.unitCard, { backgroundColor: C.card, marginBottom: 10, opacity: unit.locked ? 0.5 : 1 }]}>
            <TouchableOpacity
              onPress={() => !unit.locked && toggleUnit(unit.id)}
              activeOpacity={unit.locked ? 1 : 0.7}
              style={S.unitHeader}
            >
              <View style={[S.unitIcon, { backgroundColor: unit.locked ? (dark ? '#1E293B' : '#F1F5F9') : unit.color + '20' }]}>
                <Ionicons
                  name={unit.locked ? 'lock-closed-outline' : unit.icon}
                  size={18}
                  color={unit.locked ? C.textMuted : unit.color}
                />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[S.unitTitle, { color: unit.locked ? C.textMuted : C.text }]}>{unit.title}</Text>
                <Text style={{ fontSize: 11, color: C.textMuted }}>
                  {unit.locked ? 'Coming soon' : `${doneCt}/${unit.lessons.length} lessons · ${Math.round(pct * 100)}%`}
                </Text>
              </View>
              {!unit.locked && (
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={C.textMuted} />
              )}
            </TouchableOpacity>

            {!unit.locked && (
              <View style={{ paddingHorizontal: 14, paddingBottom: open ? 4 : 12 }}>
                <View style={{ height: 3, borderRadius: 2, backgroundColor: dark ? '#1E293B' : '#F1F5F9', overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${Math.round(pct * 100)}%`, backgroundColor: unit.color, borderRadius: 2 }} />
                </View>
              </View>
            )}

            {open && !unit.locked && (
              <View style={{ borderTopWidth: 1, borderTopColor: C.divider }}>
                {unit.lessons.map((lesson, idx) => {
                  const done   = completed.has(lesson.id);
                  const isNext = lesson === nextLesson;
                  return (
                    <TouchableOpacity
                      key={lesson.id}
                      onPress={() => setActiveLesson({ lesson, unit })}
                      activeOpacity={0.7}
                      style={[
                        S.lessonRow,
                        idx < unit.lessons.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.divider },
                      ]}
                    >
                      <View style={[S.lessonBullet, {
                        backgroundColor: done ? unit.color : 'transparent',
                        borderWidth: 2,
                        borderColor: done ? unit.color : (isNext ? unit.color : C.border),
                      }]}>
                        {done   && <Ionicons name="checkmark" size={11} color="#fff" />}
                        {isNext && !done && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: unit.color }} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[S.lessonTitle, { color: done ? C.textMuted : C.text }]}>{lesson.title}</Text>
                        <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>{lesson.duration}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}

      {/* Lesson modal */}
      <Modal visible={!!activeLesson} transparent animationType="slide">
        <View style={S.modalOverlay}>
          <View style={[S.modalBox, { backgroundColor: C.card }]}>
            {activeLesson && (() => {
              const done = completed.has(activeLesson.lesson.id);
              return (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                    <View style={[S.modalIcon, { backgroundColor: activeLesson.unit.color + '20' }]}>
                      <Ionicons name={activeLesson.unit.icon} size={18} color={activeLesson.unit.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: activeLesson.unit.color, letterSpacing: 0.8, marginBottom: 2 }}>
                        {activeLesson.unit.title.toUpperCase()}
                      </Text>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: C.text }}>
                        {activeLesson.lesson.title}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => setActiveLesson(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Ionicons name="close" size={22} color={C.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
                    <Text style={{ fontSize: 14, color: C.text, lineHeight: 23, marginBottom: 16 }}>
                      {activeLesson.lesson.summary}
                    </Text>
                    {!!activeLesson.lesson.insight && (
                      <View style={[S.insightBox, { backgroundColor: activeLesson.unit.color + '14', borderLeftColor: activeLesson.unit.color }]}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: activeLesson.unit.color, fontStyle: 'italic', lineHeight: 20 }}>
                          "{activeLesson.lesson.insight}"
                        </Text>
                      </View>
                    )}
                  </ScrollView>

                  <TouchableOpacity
                    onPress={() => { toggleComplete(activeLesson.lesson.id); setActiveLesson(null); }}
                    activeOpacity={0.8}
                    style={[S.doneBtn, {
                      backgroundColor: done
                        ? (dark ? '#1E293B' : '#F1F5F9')
                        : activeLesson.unit.color,
                    }]}
                  >
                    <Ionicons
                      name={done ? 'close-circle-outline' : 'checkmark-circle-outline'}
                      size={18}
                      color={done ? C.textMuted : '#fff'}
                    />
                    <Text style={{ fontSize: 14, fontWeight: '700', marginLeft: 8, color: done ? C.textMuted : '#fff' }}>
                      {done ? 'Mark as Incomplete' : 'Mark as Complete'}
                    </Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  section: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10 },

  progressCard: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },

  continueCard: {
    borderRadius: 18, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 5,
  },
  continueRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  continueIconWrap:  { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  continueUnitLabel: { fontSize: 11, color: 'rgba(255,255,255,0.65)', fontWeight: '600', marginBottom: 2 },
  continueLessonTitle: { fontSize: 15, fontWeight: '800', color: '#fff' },
  continueMeta:      { fontSize: 11, color: 'rgba(255,255,255,0.55)' },
  playBtn:           { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  unitCard: {
    borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
    marginBottom: 10,
  },
  unitHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  unitIcon:   { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  unitTitle:  { fontSize: 14, fontWeight: '700' },

  lessonRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  lessonBullet: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  lessonTitle:  { fontSize: 13, fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalBox:     { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 38 },
  modalIcon:    { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  insightBox:   { borderLeftWidth: 3, paddingLeft: 12, paddingVertical: 10, borderRadius: 4, marginBottom: 8 },
  doneBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, padding: 14, marginTop: 16 },
});
