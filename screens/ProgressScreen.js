import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Dimensions, Animated,
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
  const now   = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let current = 0;
  const d = new Date();
  if (!days.has(today)) d.setDate(d.getDate() - 1);
  const localStr = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  while (days.has(localStr(d))) {
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

function streakColor(n) {
  if (n === 0) return '#94A3B8';
  if (n < 3)   return '#FB923C';
  if (n < 7)   return '#F97316';
  if (n < 14)  return '#EF4444';
  if (n < 30)  return '#DC2626';
  return '#7F1D1D';
}

const WEEK_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function StreakCard({ currentStreak, sessions, C, dark }) {
  const fire      = streakColor(currentStreak);
  const pulse  = useRef(new Animated.Value(1)).current;
  const wiggle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (currentStreak === 0) return;
    Animated.parallel([
      Animated.sequence([
        Animated.timing(pulse,  { toValue: 1.3,  duration: 420, useNativeDriver: true }),
        Animated.timing(pulse,  { toValue: 1,     duration: 480, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(wiggle, { toValue:  1,    duration: 220, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: -1,    duration: 220, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue:  0.5,  duration: 180, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue:  0,    duration: 180, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const rotate = wiggle.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] });

  const sessionDays = useMemo(() => new Set(sessions.map(s => s.created_at.slice(0, 10))), [sessions]);

  const today    = new Date();
  const todayDow = today.getDay();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const week = WEEK_LABELS.map((label, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - todayDow + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return { label, dateStr, isToday: dateStr === todayStr, isFuture: i > todayDow };
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 18, padding: 14,
      alignItems: 'center', justifyContent: 'center', gap: 2,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
    }}>
      {/* Flame */}
      <Animated.View style={{ alignItems: 'center', justifyContent: 'center', marginBottom: 2, transform: [{ scale: pulse }, { rotate }] }}>
        <Ionicons name="flame" size={22} color={fire + '44'} style={{ position: 'absolute', top: 6 }} />
        <Ionicons name="flame" size={44} color={fire} />
      </Animated.View>

      {/* Number */}
      <Text style={{ fontSize: 36, fontWeight: '900', color: C.text, lineHeight: 40 }}>
        {currentStreak}
      </Text>
      <Text style={{ fontSize: 11, fontWeight: '700', color: fire, marginBottom: 8 }}>
        day streak
      </Text>

      {/* This-week tracker */}
      <View style={{ width: '100%', backgroundColor: dark ? '#0F172A' : '#F1F5F9', borderRadius: 12, padding: 8 }}>
        <View style={{ flexDirection: 'row', marginBottom: 5 }}>
          {week.map(({ label, isToday }) => (
            <Text key={label} style={{ fontSize: 8, fontWeight: '700', textAlign: 'center', flex: 1,
              color: isToday ? fire : C.textMuted }}>
              {label}
            </Text>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 3 }}>
          {week.map(({ dateStr, isToday }) => {
            const done = sessionDays.has(dateStr);
            return (
              <View key={dateStr} style={{ flex: 1, aspectRatio: 1, borderRadius: 6,
                backgroundColor: done ? fire : (dark ? '#1E293B' : '#E2E8F0'),
                borderWidth: isToday && !done ? 1.5 : 0,
                borderColor: fire,
                alignItems: 'center', justifyContent: 'center',
              }}>
                {done && <Ionicons name="checkmark" size={10} color="#fff" />}
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

// ─── Custom calendar ─────────────────────────────────────────────────────────

const DAY_HEADERS = ['S', 'M', 'T', 'W', 'TH', 'F', 'S'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CAL_GAP  = 4;
const CAL_HALF = Math.floor((SCREEN_W - 64 - 16) / 2);
const CELL     = Math.floor((CAL_HALF - 6 * CAL_GAP) / 7);

function ActivityCalendar({ sessions, C, dark }) {
  const activeDays = useMemo(() => {
    const set = new Set();
    sessions.forEach(s => set.add(s.created_at.slice(0, 10)));
    return set;
  }, [sessions]);

  const today       = new Date();
  const year        = today.getFullYear();
  const month       = today.getMonth();
  const todayStr    = `${year}-${String(month + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayDow    = today.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow    = new Date(year, month, 1).getDay();

  const cells = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  return (
    <View style={{ width: CAL_HALF }}>
      {/* Day headers */}
      <View style={{ flexDirection: 'row', gap: CAL_GAP, marginBottom: 6 }}>
        {DAY_HEADERS.map((h, i) => (
          <View key={i} style={{ width: CELL, alignItems: 'center' }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: i === todayDow ? '#22C55E' : C.textMuted }}>
              {h}
            </Text>
          </View>
        ))}
      </View>
      {/* Week rows */}
      <View style={{ gap: CAL_GAP }}>
        {weeks.map((week, rowIdx) => (
          <View key={rowIdx} style={{ flexDirection: 'row', gap: CAL_GAP }}>
            {week.map((day, colIdx) => {
              if (day === null) {
                return <View key={colIdx} style={{ width: CELL, height: CELL }} />;
              }
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const active  = activeDays.has(dateStr);
              const isToday = dateStr === todayStr;
              return (
                <View
                  key={colIdx}
                  style={{
                    width: CELL, height: CELL, borderRadius: 4,
                    backgroundColor: active
                      ? '#22C55E'
                      : (dark ? 'rgba(34,197,94,0.12)' : '#DCFCE7'),
                    borderWidth: isToday ? 2 : 0,
                    borderColor: '#22C55E',
                  }}
                />
              );
            })}
          </View>
        ))}
      </View>
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

      {/* ── Activity calendar + streak ───────────────────────────────────── */}
      <Text style={[S.section, { color: C.textMuted }]}>ACTIVITY</Text>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'stretch', marginBottom: 24 }}>
        <View style={[S.card, { backgroundColor: C.card, marginBottom: 0 }]}>
          <ActivityCalendar sessions={sessions} C={C} dark={dark} />
        </View>
        <StreakCard
          currentStreak={currentStreak}
          sessions={sessions}
          C={C} dark={dark}
        />
      </View>

      {sessions.length > 0 && (
        <>
          {/* ── All-time averages ────────────────────────────────────────────── */}
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

  statChip: {
    flex: 1, borderRadius: 16, padding: 14, alignItems: 'center',
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },

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
