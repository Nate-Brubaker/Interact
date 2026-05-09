import { useState, useEffect, useRef } from 'react';
import {
  View, Text, SectionList, TouchableOpacity,
  StyleSheet, ActivityIndicator, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { CHALLENGES } from '../data/challenges';

const DIFFICULTY = {
  Easy:   { color: '#22C55E', bg: '#F0FDF4' },
  Medium: { color: '#F97316', bg: '#FFF7ED' },
  Hard:   { color: '#EF4444', bg: '#FEF2F2' },
};

const SECTIONS = [
  { title: 'Easy',   data: CHALLENGES.filter(c => c.difficulty === 'Easy') },
  { title: 'Medium', data: CHALLENGES.filter(c => c.difficulty === 'Medium') },
  { title: 'Hard',   data: CHALLENGES.filter(c => c.difficulty === 'Hard') },
];

export default function ChallengesScreen() {
  const [completedIds, setCompletedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(null);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const listAnim     = useRef(new Animated.Value(0)).current;

  useEffect(() => { fetchCompleted(); }, []);

  async function fetchCompleted() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from('completed_challenges')
      .select('challenge_id')
      .eq('user_id', user.id);
    if (data) setCompletedIds(new Set(data.map(r => r.challenge_id)));
    setLoading(false);
  }

  const totalXP   = CHALLENGES.filter(c => completedIds.has(c.id)).reduce((s, c) => s + c.xp, 0);
  const pct       = CHALLENGES.length > 0 ? completedIds.size / CHALLENGES.length : 0;

  useEffect(() => {
    if (!loading) {
      Animated.parallel([
        Animated.timing(progressAnim, { toValue: pct, duration: 900, useNativeDriver: false }),
        Animated.timing(listAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start();
    }
  }, [loading, pct]);

  async function handleComplete(challengeId) {
    setCompleting(challengeId);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('completed_challenges')
      .insert({ user_id: user.id, challenge_id: challengeId });
    if (!error) setCompletedIds(prev => new Set([...prev, challengeId]));
    setCompleting(null);
  }

  function renderSectionHeader({ section }) {
    const { color } = DIFFICULTY[section.title];
    const done = section.data.filter(c => completedIds.has(c.id)).length;
    return (
      <View style={S.sectionHeader}>
        <View style={[S.sectionDot, { backgroundColor: color }]} />
        <Text style={[S.sectionTitle, { color }]}>{section.title.toUpperCase()}</Text>
        <Text style={S.sectionCount}>{done}/{section.data.length}</Text>
      </View>
    );
  }

  function renderChallenge({ item, section }) {
    const done = completedIds.has(item.id);
    const { color, bg } = DIFFICULTY[section.title];
    return (
      <View style={[S.card, done && S.cardDone]}>
        <View style={[S.cardAccent, { backgroundColor: color }]} />
        <View style={S.cardBody}>
          <View style={S.cardTop}>
            <Text style={[S.cardTitle, done && S.cardTitleDone]} numberOfLines={1}>
              {item.title}
            </Text>
            <View style={[S.xpBadge, { backgroundColor: bg }]}>
              <Text style={[S.xpText, { color }]}>+{item.xp} XP</Text>
            </View>
          </View>
          <Text style={S.cardDesc} numberOfLines={2}>{item.description}</Text>
          {done ? (
            <View style={S.doneRow}>
              <Ionicons name="checkmark-circle" size={14} color={color} />
              <Text style={[S.doneLabel, { color }]}>Completed</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[S.completeBtn, { backgroundColor: color }]}
              onPress={() => handleComplete(item.id)}
              disabled={completing === item.id}
              activeOpacity={0.8}
            >
              {completing === item.id
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={S.completeBtnText}>Mark Complete</Text>}
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return (
    <View style={S.container}>
      <Animated.View style={{ opacity: listAnim }}>
        <SectionList
          sections={SECTIONS}
          keyExtractor={item => item.id}
          renderItem={renderChallenge}
          renderSectionHeader={renderSectionHeader}
          stickySectionHeadersEnabled={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={S.listContent}
          ListHeaderComponent={
            <View style={S.statsCard}>
              <View style={S.statsRow}>
                <View>
                  <Text style={S.statsXP}>{totalXP}</Text>
                  <Text style={S.statsXPLabel}>XP earned</Text>
                </View>
                <View style={S.statsDivider} />
                <View style={S.statsRight}>
                  <Text style={S.statsCount}>
                    {completedIds.size}
                    <Text style={S.statsTotal}>/{CHALLENGES.length}</Text>
                  </Text>
                  <Text style={S.statsXPLabel}>completed</Text>
                </View>
              </View>
              <View style={S.progressTrack}>
                <Animated.View style={[
                  S.progressFill,
                  { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
                ]} />
              </View>
              <Text style={S.progressPct}>{Math.round(pct * 100)}% complete</Text>
            </View>
          }
        />
      </Animated.View>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FF' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, paddingBottom: 110 },

  statsCard: {
    backgroundColor: '#4F46E5',
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
  },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  statsXP:  { fontSize: 30, fontWeight: '800', color: '#fff' },
  statsXPLabel: { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  statsDivider: { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 20 },
  statsRight: {},
  statsCount: { fontSize: 30, fontWeight: '800', color: '#fff' },
  statsTotal: { fontSize: 18, fontWeight: '400', color: 'rgba(255,255,255,0.55)' },
  progressTrack: {
    height: 6, backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 3, overflow: 'hidden', marginBottom: 8,
  },
  progressFill: { height: '100%', backgroundColor: '#fff', borderRadius: 3 },
  progressPct:  { fontSize: 12, color: 'rgba(255,255,255,0.65)' },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 10, marginTop: 4, paddingHorizontal: 2,
  },
  sectionDot:   { width: 7, height: 7, borderRadius: 4, marginRight: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, flex: 1 },
  sectionCount: { fontSize: 12, color: '#94A3B8', fontWeight: '500' },

  card: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderRadius: 14, marginBottom: 8, overflow: 'hidden',
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardDone:  { opacity: 0.5 },
  cardAccent: { width: 3 },
  cardBody:  { flex: 1, padding: 14 },
  cardTop:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A', flex: 1 },
  cardTitleDone: { textDecorationLine: 'line-through', color: '#94A3B8' },
  cardDesc:  { fontSize: 13, color: '#64748B', lineHeight: 19, marginBottom: 12 },

  xpBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  xpText:  { fontSize: 11, fontWeight: '700' },

  doneRow:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  doneLabel: { fontSize: 13, fontWeight: '600' },

  completeBtn: {
    alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 8, minWidth: 44, alignItems: 'center',
  },
  completeBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
