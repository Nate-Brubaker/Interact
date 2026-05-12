import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../lib/theme';
import { getSessions } from '../lib/sessions';
import { getCompletedChallenges } from '../lib/challenges';
import { CHALLENGES } from '../data/challenges';

const { width: SCREEN_W } = Dimensions.get('window');
const CHART_W = SCREEN_W - 32;

const STATS = [
  { key: 'avg_confidence',       label: 'Confidence',       color: '#3B82F6' },
  { key: 'avg_clarity',          label: 'Clarity',          color: '#10B981' },
  { key: 'avg_energy',           label: 'Energy',           color: '#F59E0B' },
  { key: 'avg_specificity',      label: 'Specificity',      color: '#8B5CF6' },
  { key: 'avg_active_listening', label: 'Active Listening',  color: '#EC4899' },
  { key: 'grade',                label: 'Grade',            color: '#6366F1' },
];

const GRADE_NUM = {
  'A+': 10, 'A': 9.5, 'A-': 9,
  'B+': 8.5, 'B': 8, 'B-': 7.5,
  'C+': 7, 'C': 6.5, 'C-': 6,
  'D+': 5.5, 'D': 5, 'D-': 4.5, 'F': 3,
};

const XP_LEVELS = [
  { threshold: 0,   title: 'Wallflower',    color: '#94A3B8' },
  { threshold: 50,  title: 'Ice Breaker',   color: '#60A5FA' },
  { threshold: 150, title: 'Explorer',      color: '#34D399' },
  { threshold: 300, title: 'Connector',     color: '#A78BFA' },
  { threshold: 500, title: 'Champion',      color: '#F59E0B' },
  { threshold: 750, title: 'Social Master', color: '#F43F5E' },
];

const DIFF_COLORS = {
  Easy:   '#22C55E',
  Medium: '#F97316',
  Hard:   '#EF4444',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getXPLevel(xp) {
  let level = XP_LEVELS[0];
  for (const l of XP_LEVELS) { if (xp >= l.threshold) level = l; }
  const idx  = XP_LEVELS.indexOf(level);
  const next = XP_LEVELS[idx + 1] ?? null;
  const prog = next
    ? (xp - level.threshold) / (next.threshold - level.threshold)
    : 1;
  return { ...level, index: idx, next, progress: Math.min(prog, 1) };
}

function calcStreaks(sessions) {
  if (!sessions.length) return { current: 0, longest: 0 };
  const days  = new Set(sessions.map(s => s.created_at.slice(0, 10)));
  const today = new Date().toISOString().slice(0, 10);

  let current = 0;
  const d = new Date();
  if (!days.has(today)) d.setDate(d.getDate() - 1);
  while (days.has(d.toISOString().slice(0, 10))) {
    current++;
    d.setDate(d.getDate() - 1);
  }

  let longest = 0, streak = 0, prev = null;
  for (const day of Array.from(days).sort()) {
    const cur = new Date(day + 'T12:00:00');
    streak = prev && Math.round((cur - prev) / 86400000) === 1 ? streak + 1 : 1;
    if (streak > longest) longest = streak;
    prev = cur;
  }

  return { current, longest };
}

function getVal(session, key) {
  if (key === 'grade') return GRADE_NUM[session.grade] ?? null;
  return session[key] ?? null;
}

function prepareChartData(sessions, statKey, limit = 20) {
  const ordered = [...sessions].reverse();
  const valid = ordered
    .map(s => ({ val: getVal(s, statKey), date: s.created_at.slice(0, 10) }))
    .filter(x => x.val !== null)
    .slice(-limit);

  if (valid.length < 2) return null;

  const showEvery = Math.max(1, Math.floor(valid.length / 5));
  const labels = valid.map((x, i) => {
    if (i % showEvery === 0 || i === valid.length - 1) {
      const d = new Date(x.date + 'T12:00:00');
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }
    return '';
  });

  return { labels, datasets: [{ data: valid.map(x => x.val) }] };
}

function calcAverages(sessions) {
  const result = {};
  STATS.filter(s => s.key !== 'grade').forEach(({ key }) => {
    const vals = sessions.map(s => s[key]).filter(v => v != null);
    result[key] = vals.length
      ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1))
      : null;
  });
  return result;
}

// ─── Custom calendar ─────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_LABELS  = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function buildMonthGrid(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

function ActivityCalendar({ sessions, C, dark }) {
  const sessionCounts = useMemo(() => {
    const counts = {};
    sessions.forEach(s => {
      const day = s.created_at.slice(0, 10);
      counts[day] = (counts[day] ?? 0) + 1;
    });
    return counts;
  }, [sessions]);

  const months = useMemo(() => {
    const result = [];
    const today = new Date();
    for (let i = 2; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      result.push({ year: d.getFullYear(), month: d.getMonth() });
    }
    return result;
  }, []);

  const todayStr = new Date().toISOString().slice(0, 10);
  const cellSize = Math.floor((SCREEN_W - 32 - 32 - 6 * 4) / 7);

  return (
    <View style={{ gap: 20 }}>
      {months.map(({ year, month }) => {
        const cells = buildMonthGrid(year, month);
        return (
          <View key={`${year}-${month}`}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: C.text, marginBottom: 8 }}>
              {MONTH_NAMES[month]} {year}
            </Text>
            {/* Day-of-week labels */}
            <View style={{ flexDirection: 'row', marginBottom: 4 }}>
              {DAY_LABELS.map(l => (
                <View key={l} style={{ width: cellSize, alignItems: 'center' }}>
                  <Text style={{ fontSize: 9, color: C.textMuted, fontWeight: '600' }}>{l}</Text>
                </View>
              ))}
            </View>
            {/* Day cells */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {cells.map((day, idx) => {
                if (day === null) {
                  return <View key={`e-${idx}`} style={{ width: cellSize, height: cellSize }} />;
                }
                const pad   = String(month + 1).padStart(2, '0') + '/' + String(day).padStart(2, '0');
                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const count = sessionCounts[dateStr] ?? 0;
                const isToday = dateStr === todayStr;

                let bg, textColor;
                if (count === 0) {
                  bg = dark ? '#1E293B' : '#F1F5F9';
                  textColor = dark ? '#475569' : '#94A3B8';
                } else if (count === 1) {
                  bg = '#6366F133';
                  textColor = '#6366F1';
                } else if (count === 2) {
                  bg = '#6366F166';
                  textColor = '#6366F1';
                } else {
                  bg = '#6366F1';
                  textColor = '#fff';
                }

                return (
                  <View
                    key={dateStr}
                    style={{
                      width: cellSize, height: cellSize,
                      borderRadius: 6,
                      backgroundColor: bg,
                      alignItems: 'center', justifyContent: 'center',
                      borderWidth: isToday ? 1.5 : 0,
                      borderColor: isToday ? '#6366F1' : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: count > 0 ? '700' : '400', color: textColor }}>
                      {day}
                    </Text>
                    {count > 0 && (
                      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: textColor, marginTop: 1, opacity: 0.8 }} />
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ProgressScreen() {
  const { dark, colors: C } = useTheme();
  const [sessions,     setSessions]     = useState([]);
  const [completedIds, setCompletedIds] = useState(new Set());
  const [loading,      setLoading]      = useState(true);
  const [selectedStat, setSelectedStat] = useState('avg_confidence');
  const [chartType,    setChartType]    = useState('line');

  useFocusEffect(useCallback(() => {
    setLoading(true);
    Promise.all([getSessions(), getCompletedChallenges()]).then(([sess, chal]) => {
      setSessions(sess);
      setCompletedIds(new Set(chal.map(c => c.challenge_id)));
      setLoading(false);
    });
  }, []));

  const { current: currentStreak, longest: longestStreak } =
    useMemo(() => calcStreaks(sessions), [sessions]);
  const chartData  = useMemo(() => prepareChartData(sessions, selectedStat), [sessions, selectedStat]);
  const averages   = useMemo(() => calcAverages(sessions), [sessions]);
  const activeStat = STATS.find(s => s.key === selectedStat);

  const totalXP   = useMemo(
    () => CHALLENGES.filter(c => completedIds.has(c.id)).reduce((s, c) => s + c.xp, 0),
    [completedIds],
  );
  const levelInfo = useMemo(() => getXPLevel(totalXP), [totalXP]);

  const chartConfig = useMemo(() => {
    const hex = activeStat?.color ?? '#6366F1';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return {
      backgroundColor:        C.card,
      backgroundGradientFrom: C.card,
      backgroundGradientTo:   C.card,
      decimalPlaces: 1,
      color:      (o = 1) => `rgba(${r},${g},${b},${o})`,
      labelColor: ()      => C.textMuted,
      strokeWidth: 2.5,
      propsForDots: { r: '4', strokeWidth: '2', stroke: hex },
      propsForBackgroundLines: { stroke: dark ? '#334155' : '#E2E8F0', strokeDasharray: '' },
    };
  }, [C, activeStat, dark]);

  if (loading) {
    return (
      <View style={[S.center, { backgroundColor: C.bg }]}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  if (!sessions.length && completedIds.size === 0) {
    return (
      <View style={[S.center, { backgroundColor: C.bg, gap: 12, padding: 40 }]}>
        <Ionicons name="bar-chart-outline" size={52} color={C.textMuted} />
        <Text style={{ fontSize: 18, fontWeight: '700', color: C.text }}>No data yet</Text>
        <Text style={{ fontSize: 14, color: C.textMuted, textAlign: 'center', lineHeight: 20 }}>
          Complete a training session or challenge to start tracking your progress.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 110 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Streak card ─────────────────────────────────────────────────── */}
      <View style={[S.streakCard, { backgroundColor: C.accent }]}>
        <View style={S.streakMain}>
          <Text style={S.streakFire}>🔥</Text>
          <Text style={S.streakNum}>{currentStreak}</Text>
          <Text style={S.streakSuffix}>day{currentStreak !== 1 ? 's' : ''}</Text>
        </View>
        <View style={S.streakDivider} />
        <View style={S.streakMeta}>
          <Text style={S.streakMetaVal}>{longestStreak}</Text>
          <Text style={S.streakMetaLabel}>Best Streak</Text>
        </View>
        <View style={S.streakDivider} />
        <View style={S.streakMeta}>
          <Text style={S.streakMetaVal}>{sessions.length}</Text>
          <Text style={S.streakMetaLabel}>Sessions</Text>
        </View>
      </View>

      {/* ── Challenges progress ──────────────────────────────────────────── */}
      <Text style={[S.section, { color: C.textMuted }]}>CHALLENGES</Text>
      <View style={[S.card, { backgroundColor: C.card, padding: 16, marginBottom: 24 }]}>
        {/* Level row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 12 }}>
          <View style={[S.levelBadge, { backgroundColor: levelInfo.color + '22', borderColor: levelInfo.color + '55' }]}>
            <Text style={[S.levelNum, { color: levelInfo.color }]}>Lv.{levelInfo.index + 1}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: C.text }}>{levelInfo.title}</Text>
            <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>{totalXP} XP total</Text>
          </View>
          <Text style={{ fontSize: 12, color: C.textMuted }}>
            {completedIds.size}/{CHALLENGES.length} done
          </Text>
        </View>
        {/* XP bar */}
        <View style={[S.xpTrack, { backgroundColor: dark ? '#1E293B' : '#F1F5F9' }]}>
          <View style={[S.xpFill, { backgroundColor: levelInfo.color, width: `${Math.round(levelInfo.progress * 100)}%` }]} />
        </View>
        {levelInfo.next && (
          <Text style={{ fontSize: 10, color: C.textMuted, marginTop: 5, textAlign: 'right' }}>
            {levelInfo.next.threshold - totalXP} XP to {levelInfo.next.title}
          </Text>
        )}

        {/* Per-difficulty bars */}
        <View style={{ gap: 10, marginTop: 16 }}>
          {['Easy', 'Medium', 'Hard'].map(d => {
            const total = CHALLENGES.filter(c => c.difficulty === d).length;
            const done  = CHALLENGES.filter(c => c.difficulty === d && completedIds.has(c.id)).length;
            const pct   = total > 0 ? done / total : 0;
            return (
              <View key={d}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: DIFF_COLORS[d] }}>{d}</Text>
                  <Text style={{ fontSize: 12, color: C.textMuted }}>{done}/{total}</Text>
                </View>
                <View style={[S.diffTrack, { backgroundColor: dark ? '#1E293B' : '#F1F5F9' }]}>
                  <View style={[S.diffFill, { backgroundColor: DIFF_COLORS[d], width: `${Math.round(pct * 100)}%` }]} />
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* ── Activity calendar ────────────────────────────────────────────── */}
      <Text style={[S.section, { color: C.textMuted }]}>ACTIVITY — LAST 3 MONTHS</Text>
      <View style={[S.card, { backgroundColor: C.card }]}>
        <ActivityCalendar sessions={sessions} C={C} dark={dark} />
        {/* Legend */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, justifyContent: 'center' }}>
          {[
            { bg: dark ? '#1E293B' : '#F1F5F9', label: 'None' },
            { bg: '#6366F133', label: '1' },
            { bg: '#6366F166', label: '2' },
            { bg: '#6366F1',   label: '3+' },
          ].map(({ bg, label }) => (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: bg }} />
              <Text style={{ fontSize: 10, color: C.textMuted }}>{label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── All-time averages ────────────────────────────────────────────── */}
      {sessions.length > 0 && (
        <>
          <Text style={[S.section, { color: C.textMuted }]}>ALL-TIME AVERAGES</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            {STATS.filter(s => s.key !== 'grade').map(stat => (
              <View key={stat.key} style={[S.avgChip, { backgroundColor: C.card }]}>
                <View style={[S.avgDot, { backgroundColor: stat.color }]} />
                <View>
                  <Text style={{ fontSize: 17, fontWeight: '800', color: C.text }}>
                    {averages[stat.key] ?? '—'}
                  </Text>
                  <Text style={{ fontSize: 10, color: C.textMuted, fontWeight: '600', marginTop: 1 }}>
                    {stat.label}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* ── Performance chart ────────────────────────────────────────────── */}
          <Text style={[S.section, { color: C.textMuted }]}>PERFORMANCE OVER TIME</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', gap: 7, paddingRight: 16 }}>
              {STATS.map(stat => {
                const sel = selectedStat === stat.key;
                return (
                  <TouchableOpacity
                    key={stat.key}
                    onPress={() => setSelectedStat(stat.key)}
                    activeOpacity={0.7}
                    style={[
                      S.chip,
                      { borderColor: sel ? stat.color : C.border, backgroundColor: sel ? stat.color + '20' : C.card },
                    ]}
                  >
                    <View style={[S.chipDot, { backgroundColor: stat.color }]} />
                    <Text style={{ fontSize: 12, fontWeight: '600', color: sel ? stat.color : C.textSec }}>
                      {stat.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <View style={[S.toggle, { backgroundColor: C.cardAlt }]}>
            {[
              { type: 'line', icon: 'trending-up-outline', label: 'Line' },
              { type: 'bar',  icon: 'bar-chart-outline',   label: 'Bar' },
            ].map(({ type, icon, label }) => (
              <TouchableOpacity
                key={type}
                style={[
                  S.toggleBtn,
                  chartType === type && [S.toggleBtnActive, { backgroundColor: C.card }],
                ]}
                onPress={() => setChartType(type)}
                activeOpacity={0.7}
              >
                <Ionicons name={icon} size={14} color={chartType === type ? C.accent : C.textMuted} />
                <Text style={{ fontSize: 12, fontWeight: '600', marginLeft: 5, color: chartType === type ? C.accent : C.textMuted }}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {chartData ? (
            <View style={[S.card, { backgroundColor: C.card, paddingHorizontal: 0, paddingVertical: 12, overflow: 'hidden' }]}>
              {chartType === 'line' ? (
                <LineChart
                  data={chartData}
                  width={CHART_W}
                  height={220}
                  chartConfig={chartConfig}
                  bezier
                  style={{ borderRadius: 16 }}
                  withInnerLines
                  withOuterLines={false}
                  withVerticalLines={false}
                />
              ) : (
                <BarChart
                  data={chartData}
                  width={CHART_W}
                  height={220}
                  chartConfig={chartConfig}
                  style={{ borderRadius: 16 }}
                  withInnerLines
                  showValuesOnTopOfBars
                  fromZero
                  yAxisLabel=""
                  yAxisSuffix=""
                />
              )}
            </View>
          ) : (
            <View style={[S.card, { backgroundColor: C.card, height: 100, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: C.textMuted, fontSize: 14 }}>Not enough data for this stat yet</Text>
            </View>
          )}

          {selectedStat === 'grade' && chartData && (
            <Text style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 8 }}>
              Grade scale: A+ = 10 · A = 9.5 · B = 8 · C = 6.5 · D = 5 · F = 3
            </Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  streakCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 20, padding: 20, marginBottom: 24,
  },
  streakMain:    { alignItems: 'center', flex: 1.2 },
  streakFire:    { fontSize: 28, lineHeight: 34 },
  streakNum:     { fontSize: 38, fontWeight: '900', color: '#fff', lineHeight: 44 },
  streakSuffix:  { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.7)', marginTop: -2 },
  streakDivider: { width: 1, height: 48, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 16 },
  streakMeta:      { flex: 1, alignItems: 'center' },
  streakMetaVal:   { fontSize: 22, fontWeight: '800', color: '#fff' },
  streakMetaLabel: { fontSize: 11, fontWeight: '500', color: 'rgba(255,255,255,0.65)', marginTop: 2 },

  section: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 10 },

  card: {
    borderRadius: 18, padding: 16, marginBottom: 24,
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },

  levelBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  levelNum:   { fontSize: 13, fontWeight: '800' },
  xpTrack:    { height: 7, borderRadius: 4, overflow: 'hidden' },
  xpFill:     { height: '100%', borderRadius: 4 },
  diffTrack:  { height: 5, borderRadius: 3, overflow: 'hidden' },
  diffFill:   { height: '100%', borderRadius: 3 },

  avgChip: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  avgDot: { width: 10, height: 10, borderRadius: 5 },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1.5,
  },
  chipDot: { width: 7, height: 7, borderRadius: 4 },

  toggle: {
    flexDirection: 'row', borderRadius: 12, padding: 3, marginBottom: 12,
    alignSelf: 'flex-start',
  },
  toggleBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10,
  },
  toggleBtnActive: {
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 4, elevation: 2,
  },
});
