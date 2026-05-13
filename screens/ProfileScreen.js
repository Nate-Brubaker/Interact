import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Modal, Image, Switch, Alert,
  Animated, Dimensions,
} from 'react-native';
import { LineChart, BarChart } from 'react-native-chart-kit';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { getSessions } from '../lib/sessions';
import { getCompletedChallenges } from '../lib/challenges';
import { getSettings, saveSettings } from '../lib/settings';
import { CHALLENGES } from '../data/challenges';
import { BADGES } from '../data/badges';
import { useTheme, DARK } from '../lib/theme';

const { width: SCREEN_W } = Dimensions.get('window');
const CHART_W = SCREEN_W - 32;

// ─── Level system ─────────────────────────────────────────────────────────────
const LEVELS = [
  { threshold: 0,   title: 'Wallflower',    color: '#94A3B8', cardBg: '#0F172A' },
  { threshold: 50,  title: 'Ice Breaker',   color: '#60A5FA', cardBg: '#080F1E' },
  { threshold: 150, title: 'Explorer',      color: '#34D399', cardBg: '#041510' },
  { threshold: 300, title: 'Connector',     color: '#A78BFA', cardBg: '#100820' },
  { threshold: 500, title: 'Champion',      color: '#F59E0B', cardBg: '#160E00' },
  { threshold: 750, title: 'Social Master', color: '#F43F5E', cardBg: '#160306' },
];

function getLevel(xp) {
  let level = LEVELS[0];
  for (const l of LEVELS) { if (xp >= l.threshold) level = l; }
  const idx    = LEVELS.indexOf(level);
  const next   = LEVELS[idx + 1] ?? null;
  const toNext = next ? next.threshold - level.threshold : 1;
  return { ...level, index: idx, next, progress: Math.min((xp - level.threshold) / toNext, 1) };
}

// ─── Chart helpers ────────────────────────────────────────────────────────────
const STATS = [
  { key: 'avg_confidence',       label: 'Confidence',      color: '#3B82F6' },
  { key: 'avg_clarity',          label: 'Clarity',         color: '#10B981' },
  { key: 'avg_energy',           label: 'Energy',          color: '#F59E0B' },
  { key: 'avg_specificity',      label: 'Specificity',     color: '#8B5CF6' },
  { key: 'avg_active_listening', label: 'Active Listening', color: '#EC4899' },
  { key: 'grade',                label: 'Grade',           color: '#6366F1' },
];

const GRADE_NUM = {
  'A+': 10, 'A': 9.5, 'A-': 9,
  'B+': 8.5, 'B': 8, 'B-': 7.5,
  'C+': 7, 'C': 6.5, 'C-': 6,
  'D+': 5.5, 'D': 5, 'D-': 4.5, 'F': 3,
};

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

// ─── Streak helpers ───────────────────────────────────────────────────────────
function calcStreaks(sessions) {
  if (!sessions.length) return { current: 0, longest: 0 };
  const days  = new Set(sessions.map(s => s.created_at.slice(0, 10)));
  const now   = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const localStr = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;

  let current = 0;
  const d = new Date();
  if (!days.has(today)) d.setDate(d.getDate() - 1);
  while (days.has(localStr(d))) { current++; d.setDate(d.getDate() - 1); }

  let longest = 0, streak = 0, prev = null;
  for (const day of Array.from(days).sort()) {
    const cur = new Date(day + 'T12:00:00');
    streak = prev && Math.round((cur - prev) / 86400000) === 1 ? streak + 1 : 1;
    if (streak > longest) longest = streak;
    prev = cur;
  }
  return { current, longest };
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
  const fire   = streakColor(currentStreak);
  const pulse  = useRef(new Animated.Value(1)).current;
  const wiggle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (currentStreak === 0) return;
    Animated.parallel([
      Animated.sequence([
        Animated.timing(pulse,  { toValue: 1.3, duration: 420, useNativeDriver: true }),
        Animated.timing(pulse,  { toValue: 1,   duration: 480, useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(wiggle, { toValue:  1,   duration: 220, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue: -1,   duration: 220, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue:  0.5, duration: 180, useNativeDriver: true }),
        Animated.timing(wiggle, { toValue:  0,   duration: 180, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  const rotate = wiggle.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] });

  const sessionDays = useMemo(() => new Set(sessions.map(s => s.created_at.slice(0, 10))), [sessions]);
  const today    = new Date();
  const todayDow = today.getDay();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const week = WEEK_LABELS.map((label, i) => {
    const dd = new Date(today);
    dd.setDate(today.getDate() - todayDow + i);
    const dateStr = `${dd.getFullYear()}-${String(dd.getMonth()+1).padStart(2,'0')}-${String(dd.getDate()).padStart(2,'0')}`;
    return { label, dateStr, isToday: dateStr === todayStr, isFuture: i > todayDow };
  });

  return (
    <View style={{ flex: 1, backgroundColor: C.card, borderRadius: 18, padding: 14,
      alignItems: 'center', justifyContent: 'center', gap: 2,
      shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
    }}>
      <Animated.View style={{ alignItems: 'center', justifyContent: 'center', marginBottom: 2, transform: [{ scale: pulse }, { rotate }] }}>
        <Ionicons name="flame" size={22} color={fire + '44'} style={{ position: 'absolute', top: 6 }} />
        <Ionicons name="flame" size={44} color={fire} />
      </Animated.View>
      <Text style={{ fontSize: 36, fontWeight: '900', color: C.text, lineHeight: 40 }}>{currentStreak}</Text>
      <Text style={{ fontSize: 11, fontWeight: '700', color: fire, marginBottom: 8 }}>day streak</Text>
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

// ─── Activity calendar ────────────────────────────────────────────────────────
const DAY_HEADERS = ['S', 'M', 'T', 'W', 'TH', 'F', 'S'];
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
  const todayStr    = `${year}-${String(month+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
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
      <View style={{ flexDirection: 'row', gap: CAL_GAP, marginBottom: 6 }}>
        {DAY_HEADERS.map((h, i) => (
          <View key={i} style={{ width: CELL, alignItems: 'center' }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: i === todayDow ? '#22C55E' : C.textMuted }}>{h}</Text>
          </View>
        ))}
      </View>
      <View style={{ gap: CAL_GAP }}>
        {weeks.map((week, rowIdx) => (
          <View key={rowIdx} style={{ flexDirection: 'row', gap: CAL_GAP }}>
            {week.map((day, colIdx) => {
              if (day === null) return <View key={colIdx} style={{ width: CELL, height: CELL }} />;
              const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
              const active  = activeDays.has(dateStr);
              const isToday = dateStr === todayStr;
              return (
                <View key={colIdx} style={{
                  width: CELL, height: CELL, borderRadius: 4,
                  backgroundColor: active ? '#22C55E' : (dark ? 'rgba(34,197,94,0.12)' : '#DCFCE7'),
                  borderWidth: isToday ? 2 : 0,
                  borderColor: '#22C55E',
                }} />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const { dark, setDark, useSystem, setUseSystem, colors: C } = useTheme();

  const [sessions,      setSessions]      = useState([]);
  const [completedIds,  setCompletedIds]  = useState(new Set());
  const [loading,       setLoading]       = useState(true);
  const [displayName,   setDisplayName]   = useState('');
  const [email,         setEmail]         = useState('');
  const [avatarUri,     setAvatarUri]     = useState(null);
  const [editingName,   setEditingName]   = useState(false);
  const [nameInput,     setNameInput]     = useState('');
  const [selectedStat,  setSelectedStat]  = useState('avg_confidence');
  const [chartType,     setChartType]     = useState('line');
  const [settings,      setSettings]      = useState({ practiceReminders: false, hapticFeedback: true });

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    setLoading(true);
    const [{ data: { user } }, sess, chal, storedName, storedAvatar, settingsData] = await Promise.all([
      supabase.auth.getUser(),
      getSessions(),
      getCompletedChallenges(),
      AsyncStorage.getItem('profile_display_name'),
      AsyncStorage.getItem('profile_avatar_uri'),
      getSettings(),
    ]);

    setSessions(sess);
    setCompletedIds(new Set(chal.map(c => c.challenge_id)));
    setEmail(user?.email ?? '');
    if (storedAvatar) setAvatarUri(storedAvatar);
    if (settingsData) setSettings(settingsData);

    const name = storedName
      || user?.user_metadata?.full_name
      || user?.email?.split('@')[0]
      || 'You';
    setDisplayName(name);
    setLoading(false);
  }

  async function pickAvatar() {
    let { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await ImagePicker.requestMediaLibraryPermissionsAsync());
    }
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setAvatarUri(uri);
      await AsyncStorage.setItem('profile_avatar_uri', uri);
    }
  }

  async function saveName() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    await AsyncStorage.setItem('profile_display_name', trimmed);
    setDisplayName(trimmed);
    setEditingName(false);
  }

  async function updateSetting(key, value) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    await saveSettings({ [key]: value });
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Sign out failed', error.message);
  }

  const totalXP  = useMemo(() => CHALLENGES.filter(c => completedIds.has(c.id)).reduce((s, c) => s + c.xp, 0), [completedIds]);
  const levelInfo = useMemo(() => getLevel(totalXP), [totalXP]);
  const { current: currentStreak } = useMemo(() => calcStreaks(sessions), [sessions]);

  const chartData  = useMemo(() => prepareChartData(sessions, selectedStat), [sessions, selectedStat]);
  const activeStat = STATS.find(s => s.key === selectedStat);

  const chartConfig = useMemo(() => {
    const hex = activeStat?.color ?? '#6366F1';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return {
      backgroundColor: C.card, backgroundGradientFrom: C.card, backgroundGradientTo: C.card,
      decimalPlaces: 1,
      color:      (o = 1) => `rgba(${r},${g},${b},${o})`,
      labelColor: ()      => C.textMuted,
      strokeWidth: 2.5,
      propsForDots: { r: '4', strokeWidth: '2', stroke: hex },
      propsForBackgroundLines: { stroke: dark ? '#334155' : '#E2E8F0', strokeDasharray: '' },
    };
  }, [C, activeStat, dark]);

  const badgeStats = useMemo(() => {
    const byDiff = d => CHALLENGES.filter(c => c.difficulty === d);
    return {
      sessions, streak: currentStreak,
      completedCount: completedIds.size, totalChallenges: CHALLENGES.length,
      easyDone:   byDiff('Easy').filter(c => completedIds.has(c.id)).length,
      easyTotal:  byDiff('Easy').length,
      mediumDone: byDiff('Medium').filter(c => completedIds.has(c.id)).length,
      mediumTotal: byDiff('Medium').length,
      hardDone:   byDiff('Hard').filter(c => completedIds.has(c.id)).length,
      hardTotal:  byDiff('Hard').length,
      levelIndex: levelInfo.index,
    };
  }, [sessions, completedIds, currentStreak, levelInfo]);

  const initials = displayName.split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?';

  if (loading) {
    return <View style={[S.center, { backgroundColor: C.bg }]}><ActivityIndicator size="large" color={C.accent} /></View>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingBottom: 110 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={[S.header, { backgroundColor: levelInfo.cardBg }]}>
        <View style={[S.deco1, { backgroundColor: levelInfo.color + '18' }]} />
        <View style={[S.deco2, { backgroundColor: levelInfo.color + '10' }]} />

        <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8}>
          <View style={[S.avatarRing, { borderColor: levelInfo.color }]}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={S.avatarImage} />
            ) : (
              <View style={[S.avatar, { backgroundColor: levelInfo.color + '33' }]}>
                <Text style={[S.avatarText, { color: levelInfo.color }]}>{initials}</Text>
              </View>
            )}
          </View>
          <View style={[S.cameraBtn, { backgroundColor: levelInfo.color }]}>
            <Ionicons name="camera" size={13} color="#fff" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => { setNameInput(displayName); setEditingName(true); }} style={{ alignItems: 'center', gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={S.nameText}>{displayName}</Text>
            <Ionicons name="pencil" size={13} color="rgba(255,255,255,0.4)" />
          </View>
          <Text style={S.emailText}>{email}</Text>
        </TouchableOpacity>

        <View style={[S.levelPill, { backgroundColor: levelInfo.color + '22', borderColor: levelInfo.color + '55' }]}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: levelInfo.color }} />
          <Text style={[S.levelPillText, { color: levelInfo.color }]}>Lv.{levelInfo.index + 1}  ·  {levelInfo.title}</Text>
        </View>

        <View style={{ width: '100%', marginTop: 14 }}>
          <View style={S.xpTrack}>
            <View style={[S.xpFill, { backgroundColor: levelInfo.color, width: `${Math.round(levelInfo.progress * 100)}%` }]} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
            <Text style={S.xpLabel}>{totalXP} XP</Text>
            {levelInfo.next && <Text style={S.xpLabel}>{levelInfo.next.threshold} XP · {levelInfo.next.title}</Text>}
          </View>
        </View>
      </View>

      {/* ── Stats strip ───────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 0 }}>
        {[
          { label: 'Sessions',   value: sessions.length },
          { label: 'Challenges', value: completedIds.size },
          { label: 'Total XP',   value: totalXP },
          { label: 'Streak',     value: currentStreak },
        ].map(({ label, value }) => (
          <View key={label} style={[S.statBox, { backgroundColor: C.card }]}>
            <Text style={{ fontSize: 22, fontWeight: '900', color: C.text }}>{value}</Text>
            <Text style={{ fontSize: 10, fontWeight: '600', color: C.textMuted, marginTop: 2 }}>{label.toUpperCase()}</Text>
          </View>
        ))}
      </View>

      {/* ── Activity ──────────────────────────────────────────────────────── */}
      <Text style={[S.section, { color: C.textMuted, paddingHorizontal: 16, marginTop: 24 }]}>ACTIVITY</Text>
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, alignItems: 'stretch' }}>
        <View style={[S.card, { backgroundColor: C.card, marginBottom: 0 }]}>
          <ActivityCalendar sessions={sessions} C={C} dark={dark} />
        </View>
        <StreakCard currentStreak={currentStreak} sessions={sessions} C={C} dark={dark} />
      </View>

      {/* ── Performance chart ─────────────────────────────────────────────── */}
      {sessions.length > 0 && (
        <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
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
                    style={[S.chip, { borderColor: sel ? stat.color : C.border, backgroundColor: sel ? stat.color + '20' : C.card }]}
                  >
                    <View style={[S.chipDot, { backgroundColor: stat.color }]} />
                    <Text style={{ fontSize: 12, fontWeight: '600', color: sel ? stat.color : C.textSec }}>{stat.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <View style={[S.toggle, { backgroundColor: C.cardAlt }]}>
            {[
              { type: 'line', icon: 'trending-up-outline', label: 'Line' },
              { type: 'bar',  icon: 'bar-chart-outline',   label: 'Bar'  },
            ].map(({ type, icon, label }) => (
              <TouchableOpacity
                key={type}
                style={[S.toggleBtn, chartType === type && [S.toggleBtnActive, { backgroundColor: C.card }]]}
                onPress={() => setChartType(type)}
                activeOpacity={0.7}
              >
                <Ionicons name={icon} size={14} color={chartType === type ? C.accent : C.textMuted} />
                <Text style={{ fontSize: 12, fontWeight: '600', marginLeft: 5, color: chartType === type ? C.accent : C.textMuted }}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {chartData ? (
            <View style={[S.card, { backgroundColor: C.card, paddingHorizontal: 0, paddingVertical: 12, overflow: 'hidden' }]}>
              {chartType === 'line' ? (
                <LineChart data={chartData} width={CHART_W} height={220} chartConfig={chartConfig} bezier
                  style={{ borderRadius: 16 }} withInnerLines withOuterLines={false} withVerticalLines={false} />
              ) : (
                <BarChart data={chartData} width={CHART_W} height={220} chartConfig={chartConfig}
                  style={{ borderRadius: 16 }} withInnerLines showValuesOnTopOfBars fromZero
                  yAxisLabel="" yAxisSuffix="" />
              )}
            </View>
          ) : (
            <View style={[S.card, { backgroundColor: C.card, height: 90, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: C.textMuted, fontSize: 14 }}>Not enough data for this stat yet</Text>
            </View>
          )}

          {selectedStat === 'grade' && chartData && (
            <Text style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', marginTop: 8 }}>
              Grade scale: A+ = 10 · A = 9.5 · B = 8 · C = 6.5 · D = 5 · F = 3
            </Text>
          )}
        </View>
      )}

      {/* ── Badges ────────────────────────────────────────────────────────── */}
      <Text style={[S.section, { color: C.textMuted, paddingHorizontal: 16, marginTop: 24 }]}>BADGES</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10, marginBottom: 24 }}>
        {BADGES.map(badge => {
          const earned = badge.check(badgeStats);
          return (
            <View key={badge.id} style={[S.badgeCard, { backgroundColor: C.card,
              borderWidth: earned ? 1.5 : 0,
              borderColor: earned ? badge.color + '55' : 'transparent',
              opacity: earned ? 1 : 0.45,
            }]}>
              <View style={[S.badgeIcon, { backgroundColor: earned ? badge.color + '22' : (dark ? '#1E293B' : '#F1F5F9') }]}>
                <Ionicons name={badge.icon} size={22} color={earned ? badge.color : C.textMuted} />
              </View>
              <Text style={{ fontSize: 11, fontWeight: '700', color: earned ? C.text : C.textMuted, textAlign: 'center', marginTop: 6 }} numberOfLines={2}>
                {badge.title}
              </Text>
              {earned && <View style={[S.earnedDot, { backgroundColor: badge.color }]} />}
            </View>
          );
        })}
      </View>

      {/* ── Settings ──────────────────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={[S.section, { color: C.textMuted }]}>APPEARANCE</Text>
        <View style={[S.settingsGroup, { backgroundColor: C.card }]}>
          <View style={S.settingsRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 }}>Use System Theme</Text>
              <Text style={{ fontSize: 12, color: C.textMuted, lineHeight: 17 }}>Automatically match your device's appearance.</Text>
            </View>
            <Switch
              value={useSystem}
              onValueChange={setUseSystem}
              trackColor={{ false: dark ? '#52525B' : '#71717A', true: DARK.accentLight }}
              thumbColor="#ffffff"
            />
          </View>
          {!useSystem && (
            <>
              <View style={{ height: 1, backgroundColor: C.divider, marginHorizontal: 14 }} />
              <View style={{ padding: 14, gap: 8 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 }}>Theme</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {[
                    { label: 'Light', icon: 'sunny-outline',  value: false },
                    { label: 'Dark',  icon: 'moon-outline',   value: true  },
                  ].map(opt => {
                    const active = dark === opt.value;
                    return (
                      <TouchableOpacity key={opt.label} onPress={() => setDark(opt.value)} activeOpacity={0.7}
                        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                          gap: 6, paddingVertical: 10, borderRadius: 10,
                          backgroundColor: active ? C.accent : C.bgAlt,
                          borderWidth: 1.5, borderColor: active ? C.accent : C.border,
                        }}>
                        <Ionicons name={opt.icon} size={15} color={active ? '#fff' : C.textSec} />
                        <Text style={{ fontSize: 13, fontWeight: '600', color: active ? '#fff' : C.textSec }}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </>
          )}
        </View>

        <Text style={[S.section, { color: C.textMuted, marginTop: 24 }]}>APP</Text>
        <View style={[S.settingsGroup, { backgroundColor: C.card }]}>
          <View style={S.settingsRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 }}>Haptic Feedback</Text>
              <Text style={{ fontSize: 12, color: C.textMuted, lineHeight: 17 }}>Vibrate when recording starts and stops.</Text>
            </View>
            <Switch
              value={settings.hapticFeedback}
              onValueChange={v => updateSetting('hapticFeedback', v)}
              trackColor={{ false: dark ? '#52525B' : '#71717A', true: DARK.accentLight }}
              thumbColor="#ffffff"
            />
          </View>
          <View style={{ height: 1, backgroundColor: C.divider, marginHorizontal: 14 }} />
          <View style={S.settingsRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 }}>Practice Reminders</Text>
              <Text style={{ fontSize: 12, color: C.textMuted, lineHeight: 17 }}>Daily nudge to keep your skills sharp.</Text>
            </View>
            <Switch
              value={settings.practiceReminders}
              onValueChange={v => updateSetting('practiceReminders', v)}
              trackColor={{ false: dark ? '#52525B' : '#71717A', true: DARK.accentLight }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        <Text style={[S.section, { color: C.textMuted, marginTop: 24 }]}>ACCOUNT</Text>
        <TouchableOpacity
          style={[S.signOutBtn, { backgroundColor: C.card }]}
          onPress={signOut}
          activeOpacity={0.8}
        >
          <Ionicons name="log-out-outline" size={18} color="#EF4444" />
          <Text style={{ color: '#EF4444', fontWeight: '600', fontSize: 15 }}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* ── Edit name modal ───────────────────────────────────────────────── */}
      <Modal visible={editingName} transparent animationType="fade">
        <View style={S.modalOverlay}>
          <View style={[S.modalBox, { backgroundColor: C.card }]}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 14 }}>Display Name</Text>
            <TextInput
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus
              style={[S.nameInput, { backgroundColor: dark ? '#1E293B' : '#F1F5F9', color: C.text }]}
              placeholder="Your name"
              placeholderTextColor={C.textMuted}
              maxLength={30}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity onPress={() => setEditingName(false)} style={[S.modalBtn, { backgroundColor: dark ? '#1E293B' : '#F1F5F9' }]}>
                <Text style={{ fontWeight: '600', color: C.textSec }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveName} style={[S.modalBtn, { backgroundColor: C.accent, flex: 1 }]}>
                <Text style={{ fontWeight: '700', color: '#fff' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { padding: 28, paddingTop: 36, alignItems: 'center', gap: 10, overflow: 'hidden' },
  deco1:  { position: 'absolute', width: 200, height: 200, borderRadius: 100, top: -80, right: -40 },
  deco2:  { position: 'absolute', width: 130, height: 130, borderRadius: 65, bottom: -30, left: 20 },

  avatarRing:  { width: 110, height: 110, borderRadius: 55, borderWidth: 3, padding: 3, marginBottom: 4 },
  avatar:      { flex: 1, borderRadius: 52, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: '100%', height: '100%', borderRadius: 50 },
  avatarText:  { fontSize: 36, fontWeight: '900' },
  cameraBtn:   { position: 'absolute', bottom: 2, right: 0, width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(0,0,0,0.3)',
  },

  nameText:     { fontSize: 20, fontWeight: '800', color: '#fff' },
  emailText:    { fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: '400' },
  levelPill:    { flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  levelPillText: { fontSize: 13, fontWeight: '700' },
  xpTrack:  { height: 6, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'hidden' },
  xpFill:   { height: '100%', borderRadius: 3 },
  xpLabel:  { fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: '500' },

  statBox: { flex: 1, borderRadius: 14, padding: 12, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },

  section: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 12 },

  card: { borderRadius: 18, padding: 16,
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },

  chip:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5 },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  toggle:  { flexDirection: 'row', borderRadius: 12, padding: 3, marginBottom: 12, alignSelf: 'flex-start' },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  toggleBtnActive: { shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },

  badgeCard: { width: '30%', borderRadius: 16, padding: 12, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  badgeIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  earnedDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },

  settingsGroup: { borderRadius: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  settingsRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },

  signOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, borderRadius: 14, padding: 14, marginBottom: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  modalBox:     { width: '100%', borderRadius: 20, padding: 22 },
  nameInput:    { borderRadius: 12, padding: 14, fontSize: 16, fontWeight: '500' },
  modalBtn:     { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
});
