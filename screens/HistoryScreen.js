import { useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme } from '../lib/theme';
import { getSessions } from '../lib/sessions';

const SCENARIO_META = {
  job_interview: { color: '#6366F1', icon: 'briefcase-outline' },
  networking:    { color: '#10B981', icon: 'people-outline' },
  small_talk:    { color: '#F59E0B', icon: 'chatbubble-outline' },
  new_friends:   { color: '#3B82F6', icon: 'person-add-outline' },
  difficult:     { color: '#EF4444', icon: 'flash-outline' },
};

function gradeColor(grade, accent) {
  if (grade?.startsWith('A')) return '#22C55E';
  if (grade?.startsWith('B')) return accent;
  if (grade?.startsWith('C')) return '#F97316';
  return '#EF4444';
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days}d ago`;
  if (days < 365) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function StatCell({ label, value, C }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 38 }}>
      <Text style={{ fontSize: 15, fontWeight: '800', color: C.text }}>{value ?? '—'}</Text>
      <Text style={{ fontSize: 9, fontWeight: '600', color: C.textMuted, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

function SessionCard({ session, C, S }) {
  const meta  = SCENARIO_META[session.scenario_id] ?? { color: '#94A3B8', icon: 'chatbubble-outline' };
  const gc    = gradeColor(session.grade, C.accent);
  const meta2 = [
    session.turn_count  ? `${session.turn_count} turns`  : null,
    session.total_fillers != null ? `${session.total_fillers} filler${session.total_fillers !== 1 ? 's' : ''}` : null,
    session.avg_response_time != null ? `${session.avg_response_time}s avg` : null,
  ].filter(Boolean).join(' · ');

  return (
    <View style={S.card}>
      <View style={[S.cardAccent, { backgroundColor: meta.color }]} />
      <View style={S.cardInner}>
        <View style={S.cardTop}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 }}>
            <View style={[S.iconWrap, { backgroundColor: meta.color + '18' }]}>
              <Ionicons name={meta.icon} size={14} color={meta.color} />
            </View>
            <Text style={S.cardScenario} numberOfLines={1}>{session.scenario_label}</Text>
          </View>
          <View style={[S.gradeBadge, { backgroundColor: gc + '18' }]}>
            <Text style={[S.gradeText, { color: gc }]}>{session.grade ?? '—'}</Text>
          </View>
          <Text style={S.cardDate}>{formatDate(session.created_at)}</Text>
        </View>

        {meta2 ? <Text style={S.cardMeta}>{meta2}</Text> : null}

        <View style={S.metricsRow}>
          <StatCell label="Conf"  value={session.avg_confidence}      C={C} />
          <View style={S.metricDivider} />
          <StatCell label="Clar"  value={session.avg_clarity}         C={C} />
          <View style={S.metricDivider} />
          <StatCell label="Enrg"  value={session.avg_energy}          C={C} />
          <View style={S.metricDivider} />
          <StatCell label="Spec"  value={session.avg_specificity}     C={C} />
          <View style={S.metricDivider} />
          <StatCell label="List"  value={session.avg_active_listening} C={C} />
        </View>
      </View>
    </View>
  );
}

export default function HistoryScreen() {
  const { colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C), [C]);
  const navigation = useNavigation();

  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      getSessions().then(data => { setSessions(data); setLoading(false); });
    }, [])
  );

  const totalTurns = sessions.reduce((s, r) => s + (r.turn_count ?? 0), 0);
  const mostPracticed = (() => {
    if (!sessions.length) return null;
    const counts = {};
    sessions.forEach(s => { counts[s.scenario_label] = (counts[s.scenario_label] ?? 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  })();

  if (loading) {
    return (
      <View style={[S.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  if (!sessions.length) {
    return (
      <View style={[S.container, { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 }]}>
        <Ionicons name="time-outline" size={52} color={C.textMuted} />
        <Text style={{ fontSize: 18, fontWeight: '700', color: C.text }}>No sessions yet</Text>
        <Text style={{ fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 20 }}>
          Complete an AI training session to see your history here.
        </Text>
        <TouchableOpacity
          style={{ marginTop: 8, backgroundColor: C.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}
          onPress={() => navigation.navigate('Trainer')}
          activeOpacity={0.8}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Start Training</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={S.container}>
      <FlatList
        data={sessions}
        keyExtractor={item => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={S.list}
        ListHeaderComponent={
          <View style={S.summaryCard}>
            <View style={S.summaryItem}>
              <Text style={S.summaryValue}>{sessions.length}</Text>
              <Text style={S.summaryLabel}>Sessions</Text>
            </View>
            <View style={S.summaryDivider} />
            <View style={S.summaryItem}>
              <Text style={S.summaryValue}>{totalTurns}</Text>
              <Text style={S.summaryLabel}>Total Turns</Text>
            </View>
            {mostPracticed && (
              <>
                <View style={S.summaryDivider} />
                <View style={[S.summaryItem, { flex: 2 }]}>
                  <Text style={S.summaryValue} numberOfLines={1}>{mostPracticed}</Text>
                  <Text style={S.summaryLabel}>Most Practiced</Text>
                </View>
              </>
            )}
          </View>
        }
        renderItem={({ item }) => <SessionCard session={item} C={C} S={S} />}
      />
    </View>
  );
}

const makeStyles = (C) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  list:      { padding: 16, paddingBottom: 110 },

  summaryCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.accent, borderRadius: 18, padding: 20, marginBottom: 20,
  },
  summaryItem:   { flex: 1, alignItems: 'center' },
  summaryValue:  { fontSize: 22, fontWeight: '800', color: '#fff' },
  summaryLabel:  { fontSize: 11, color: 'rgba(255,255,255,0.65)', marginTop: 2, fontWeight: '500' },
  summaryDivider:{ width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 12 },

  card: {
    flexDirection: 'row', backgroundColor: C.card,
    borderRadius: 16, marginBottom: 10, overflow: 'hidden',
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardAccent: { width: 3, alignSelf: 'stretch' },
  cardInner:  { flex: 1, padding: 14 },
  cardTop:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  iconWrap:   { width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  cardScenario: { fontSize: 14, fontWeight: '700', color: C.text, flex: 1 },
  gradeBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  gradeText:  { fontSize: 13, fontWeight: '800' },
  cardDate:   { fontSize: 11, color: C.textMuted, fontWeight: '500' },
  cardMeta:   { fontSize: 11, color: C.textMuted, marginBottom: 12 },

  metricsRow:    { flexDirection: 'row', alignItems: 'center' },
  metricDivider: { width: 1, height: 24, backgroundColor: C.divider, marginHorizontal: 8 },
});
