import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../lib/theme';
import { UNITS } from '../constants/lessons';

const STORAGE_KEY = 'learn_completed';

export default function LearnScreen() {
  const { dark, colors: C } = useTheme();
  const navigation = useNavigation();
  const [completed, setCompleted] = useState(new Set());
  const [expanded,  setExpanded]  = useState(new Set(['unit_1']));

  useFocusEffect(useCallback(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(v => {
      if (v) setCompleted(new Set(JSON.parse(v)));
    });
  }, []));

  function toggleUnit(unitId) {
    const next = new Set(expanded);
    if (next.has(unitId)) next.delete(unitId);
    else next.add(unitId);
    setExpanded(next);
  }

  function openLesson(lesson, unit) {
    navigation.navigate('LessonDetail', { lessonId: lesson.id, unitId: unit.id });
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
            onPress={() => openLesson(nextLesson, nextUnit)}
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
          <View key={unit.id} style={[S.unitCard, { backgroundColor: C.card, opacity: unit.locked ? 0.5 : 1 }]}>
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
                      onPress={() => openLesson(lesson, unit)}
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
  continueRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  continueIconWrap:   { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  continueUnitLabel:  { fontSize: 11, color: 'rgba(255,255,255,0.65)', fontWeight: '600', marginBottom: 2 },
  continueLessonTitle: { fontSize: 15, fontWeight: '800', color: '#fff' },
  continueMeta:       { fontSize: 11, color: 'rgba(255,255,255,0.55)' },
  playBtn:            { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

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
});
