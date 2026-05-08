import { useState, useEffect } from 'react';
import {
  View, Text, SectionList, TouchableOpacity,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { CHALLENGES } from '../data/challenges';

const DIFFICULTY = {
  Easy:   { color: '#22C55E', bg: '#F0FDF4' },
  Medium: { color: '#F97316', bg: '#FFF7ED' },
  Hard:   { color: '#EF4444', bg: '#FEF2F2' },
};

const SECTIONS = [
  { title: 'Easy',   xp: 10, data: CHALLENGES.filter(c => c.difficulty === 'Easy') },
  { title: 'Medium', xp: 25, data: CHALLENGES.filter(c => c.difficulty === 'Medium') },
  { title: 'Hard',   xp: 50, data: CHALLENGES.filter(c => c.difficulty === 'Hard') },
];

export default function ChallengesScreen() {
  const [completedIds, setCompletedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(null);

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

  async function handleComplete(challengeId) {
    setCompleting(challengeId);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('completed_challenges')
      .insert({ user_id: user.id, challenge_id: challengeId });
    if (!error) setCompletedIds(prev => new Set([...prev, challengeId]));
    setCompleting(null);
  }

  const totalXP = CHALLENGES
    .filter(c => completedIds.has(c.id))
    .reduce((sum, c) => sum + c.xp, 0);

  const progressPct = CHALLENGES.length > 0 ? completedIds.size / CHALLENGES.length : 0;

  function renderSectionHeader({ section }) {
    const { color } = DIFFICULTY[section.title];
    const sectionCompleted = section.data.filter(c => completedIds.has(c.id)).length;
    return (
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionDot, { backgroundColor: color }]} />
        <Text style={[styles.sectionTitle, { color }]}>{section.title.toUpperCase()}</Text>
        <Text style={styles.sectionCount}>
          {sectionCompleted}/{section.data.length}
        </Text>
      </View>
    );
  }

  function renderChallenge({ item, section }) {
    const done = completedIds.has(item.id);
    const { color, bg } = DIFFICULTY[section.title];
    return (
      <View style={[styles.card, done && styles.cardDone]}>
        <View style={[styles.cardAccent, { backgroundColor: color }]} />
        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <Text style={[styles.cardTitle, done && styles.cardTitleDone]} numberOfLines={1}>
              {item.title}
            </Text>
            <View style={[styles.xpBadge, { backgroundColor: bg }]}>
              <Text style={[styles.xpText, { color }]}>+{item.xp} XP</Text>
            </View>
          </View>
          <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
          {done ? (
            <Text style={[styles.completedLabel, { color }]}>✓ Completed</Text>
          ) : (
            <TouchableOpacity
              style={[styles.completeButton, { backgroundColor: color }]}
              onPress={() => handleComplete(item.id)}
              disabled={completing === item.id}
            >
              <Text style={styles.completeButtonText}>
                {completing === item.id ? 'Saving...' : 'Mark Complete'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SectionList
        sections={SECTIONS}
        keyExtractor={item => item.id}
        renderItem={renderChallenge}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.statsCard}>
            <View style={styles.statsRow}>
              <View>
                <Text style={styles.statsXP}>{totalXP} XP</Text>
                <Text style={styles.statsLabel}>earned so far</Text>
              </View>
              <View style={styles.statsRight}>
                <Text style={styles.statsCount}>
                  {completedIds.size}
                  <Text style={styles.statsTotal}>/{CHALLENGES.length}</Text>
                </Text>
                <Text style={styles.statsLabel}>completed</Text>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPct * 100}%` }]} />
            </View>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, paddingBottom: 32 },

  statsCard: {
    backgroundColor: '#4F46E5',
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statsXP: { fontSize: 28, fontWeight: '800', color: '#fff' },
  statsCount: { fontSize: 28, fontWeight: '800', color: '#fff', textAlign: 'right' },
  statsTotal: { fontSize: 18, fontWeight: '400', color: 'rgba(255,255,255,0.6)' },
  statsLabel: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  statsRight: { alignItems: 'flex-end' },
  progressTrack: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 3,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 4,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    flex: 1,
  },
  sectionCount: {
    fontSize: 13,
    color: '#9CA3AF',
    fontWeight: '500',
  },

  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardDone: { opacity: 0.55 },
  cardAccent: { width: 4 },
  cardBody: { flex: 1, padding: 14 },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    flex: 1,
  },
  cardTitleDone: {
    textDecorationLine: 'line-through',
    color: '#9CA3AF',
  },
  xpBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  xpText: { fontSize: 12, fontWeight: '700' },
  cardDesc: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 19,
    marginBottom: 12,
  },
  completeButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  completeButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  completedLabel: { fontSize: 13, fontWeight: '700' },
});
