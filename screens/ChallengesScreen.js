import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Animated, LayoutAnimation,
  UIManager, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { CHALLENGES } from '../data/challenges';
import { useTheme } from '../lib/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── XP level system ─────────────────────────────────────────────────────────
const LEVELS = [
  { threshold: 0,   title: 'Wallflower',     color: '#94A3B8' },
  { threshold: 50,  title: 'Ice Breaker',    color: '#60A5FA' },
  { threshold: 150, title: 'Explorer',       color: '#34D399' },
  { threshold: 300, title: 'Connector',      color: '#A78BFA' },
  { threshold: 500, title: 'Champion',       color: '#F59E0B' },
  { threshold: 750, title: 'Social Master',  color: '#F43F5E' },
];

function getLevel(xp) {
  let level = LEVELS[0];
  for (const l of LEVELS) { if (xp >= l.threshold) level = l; }
  const idx = LEVELS.indexOf(level);
  const next = LEVELS[idx + 1] ?? null;
  const fromPrev = xp - level.threshold;
  const toNext   = next ? next.threshold - level.threshold : 1;
  return { ...level, index: idx, next, progress: Math.min(fromPrev / toNext, 1) };
}

// ─── Daily challenge (deterministic by date) ──────────────────────────────────
function getDailyChallenge() {
  const now   = new Date();
  const seed  = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  return CHALLENGES[seed % CHALLENGES.length];
}

// ─── Difficulty meta ──────────────────────────────────────────────────────────
const DIFF = {
  Easy:   { color: '#22C55E', dim: '#16A34A', bg: '#F0FDF4', bgDark: 'rgba(34,197,94,0.12)' },
  Medium: { color: '#F97316', dim: '#EA580C', bg: '#FFF7ED', bgDark: 'rgba(249,115,22,0.12)' },
  Hard:   { color: '#EF4444', dim: '#DC2626', bg: '#FEF2F2', bgDark: 'rgba(239,68,68,0.12)' },
};

const FILTERS = ['All', 'Easy', 'Medium', 'Hard'];

// ─── Component ────────────────────────────────────────────────────────────────
export default function ChallengesScreen() {
  const { dark, colors: C } = useTheme();
  const S = useMemo(() => makeStyles(C, dark), [C, dark]);

  const [completedIds, setCompletedIds] = useState(new Set());
  const [loading,      setLoading]      = useState(true);
  const [completing,   setCompleting]   = useState(null);
  const [filter,       setFilter]       = useState('All');
  const [expanded,     setExpanded]     = useState(null);

  const xpAnim      = useRef(new Animated.Value(0)).current;
  const levelAnim   = useRef(new Animated.Value(0)).current;
  const headerAnim  = useRef(new Animated.Value(0)).current;

  useFocusEffect(useCallback(() => {
    loadData();
  }, []));

  async function loadData() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from('completed_challenges')
      .select('challenge_id')
      .eq('user_id', user.id);
    if (data) setCompletedIds(new Set(data.map(r => r.challenge_id)));
    setLoading(false);
  }

  const totalXP = useMemo(
    () => CHALLENGES.filter(c => completedIds.has(c.id)).reduce((s, c) => s + c.xp, 0),
    [completedIds],
  );
  const levelInfo = useMemo(() => getLevel(totalXP), [totalXP]);
  const daily     = useMemo(() => getDailyChallenge(), []);

  useEffect(() => {
    if (!loading) {
      Animated.parallel([
        Animated.timing(headerAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(xpAnim, { toValue: levelInfo.progress, duration: 900, useNativeDriver: false }),
        Animated.timing(levelAnim, { toValue: levelInfo.index / (LEVELS.length - 1), duration: 900, useNativeDriver: false }),
      ]).start();
    }
  }, [loading]);

  async function handleComplete(challengeId) {
    setCompleting(challengeId);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('completed_challenges')
      .insert({ user_id: user.id, challenge_id: challengeId });
    if (!error) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setCompletedIds(prev => new Set([...prev, challengeId]));
    }
    setCompleting(null);
  }

  function toggleExpand(id) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(prev => (prev === id ? null : id));
  }

  const filteredChallenges = useMemo(() => {
    if (filter === 'All') return CHALLENGES;
    return CHALLENGES.filter(c => c.difficulty === filter);
  }, [filter]);

  const groupedByDiff = useMemo(() => {
    const diffs = filter === 'All' ? ['Easy', 'Medium', 'Hard'] : [filter];
    return diffs.map(d => ({
      difficulty: d,
      items: filteredChallenges.filter(c => c.difficulty === d),
    }));
  }, [filteredChallenges, filter]);

  const dailyDone = completedIds.has(daily.id);

  if (loading) {
    return (
      <View style={[S.center, { backgroundColor: C.bg }]}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingBottom: 110 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Player card ──────────────────────────────────────────────────── */}
      <Animated.View style={[S.playerCard, { opacity: headerAnim, transform: [{ translateY: headerAnim.interpolate({ inputRange: [0,1], outputRange: [12, 0] }) }] }]}>
        {/* Decorative circles */}
        <View style={S.decoCircle1} />
        <View style={S.decoCircle2} />
        <View style={S.decoCircle3} />

        <View style={S.playerCardInner}>
          {/* Left: level badge + info */}
          <View style={S.playerLeft}>
            <View style={[S.levelBadge, { backgroundColor: levelInfo.color + '22', borderColor: levelInfo.color + '55' }]}>
              <Text style={[S.levelBadgeNum, { color: levelInfo.color }]}>Lv.{levelInfo.index + 1}</Text>
            </View>
            <Text style={S.playerTitle}>{levelInfo.title}</Text>
            <Text style={S.playerXP}>{totalXP} XP</Text>
          </View>

          {/* Right: completion stats */}
          <View style={S.playerStats}>
            {['Easy', 'Medium', 'Hard'].map(d => {
              const total = CHALLENGES.filter(c => c.difficulty === d).length;
              const done  = CHALLENGES.filter(c => c.difficulty === d && completedIds.has(c.id)).length;
              return (
                <View key={d} style={S.playerStatItem}>
                  <Text style={[S.playerStatNum, { color: DIFF[d].color }]}>{done}</Text>
                  <Text style={S.playerStatLabel}>{d}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* XP progress bar */}
        <View style={S.xpBarTrack}>
          <Animated.View
            style={[S.xpBarFill, {
              width: xpAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              backgroundColor: levelInfo.color,
            }]}
          />
        </View>
        <View style={S.xpBarLabels}>
          <Text style={S.xpBarLabel}>{levelInfo.title}</Text>
          {levelInfo.next && (
            <Text style={S.xpBarLabel}>{levelInfo.next.threshold} XP → {levelInfo.next.title}</Text>
          )}
        </View>

        {/* Overall progress dots */}
        <View style={S.dotRow}>
          {CHALLENGES.map(c => (
            <View
              key={c.id}
              style={[
                S.dot,
                { backgroundColor: completedIds.has(c.id) ? DIFF[c.difficulty].color : 'rgba(255,255,255,0.2)' },
              ]}
            />
          ))}
        </View>
      </Animated.View>

      {/* ── Daily quest ───────────────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: 16, marginBottom: 20 }}>
        <Text style={[S.sectionLabel, { color: C.textMuted }]}>TODAY'S QUEST</Text>
        <View style={[S.dailyCard, { backgroundColor: C.card, borderColor: dailyDone ? '#22C55E44' : C.accent + '44', borderWidth: 1.5 }]}>
          <View style={[S.dailyIconBox, { backgroundColor: dailyDone ? '#22C55E22' : C.accent + '22' }]}>
            <Ionicons name={daily.icon} size={22} color={dailyDone ? '#22C55E' : C.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <Text style={[S.dailyTitle, { color: C.text }]}>{daily.title}</Text>
              <View style={[S.tagPill, { backgroundColor: C.accent + '18' }]}>
                <Text style={[S.tagText, { color: C.accent }]}>{daily.tag}</Text>
              </View>
            </View>
            <Text style={[S.dailyDesc, { color: C.textSec }]} numberOfLines={2}>{daily.description}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <View style={[S.xpPill, { backgroundColor: DIFF[daily.difficulty].color + '22' }]}>
              <Text style={[S.xpPillText, { color: DIFF[daily.difficulty].color }]}>+{daily.xp}</Text>
            </View>
            {dailyDone
              ? <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
              : (
                <TouchableOpacity
                  style={[S.dailyBtn, { backgroundColor: C.accent }]}
                  onPress={() => handleComplete(daily.id)}
                  disabled={completing === daily.id}
                  activeOpacity={0.8}
                >
                  {completing === daily.id
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={S.dailyBtnText}>Do it</Text>}
                </TouchableOpacity>
              )}
          </View>
        </View>
      </View>

      {/* ── Filter tabs ──────────────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: 16 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {FILTERS.map(f => {
              const active = filter === f;
              const col    = f === 'All' ? C.accent : DIFF[f]?.color ?? C.accent;
              return (
                <TouchableOpacity
                  key={f}
                  style={[S.filterTab, { borderColor: active ? col : C.border, backgroundColor: active ? col + '18' : C.card }]}
                  onPress={() => setFilter(f)}
                  activeOpacity={0.7}
                >
                  {f !== 'All' && (
                    <View style={[S.filterDot, { backgroundColor: active ? col : C.textMuted }]} />
                  )}
                  <Text style={[S.filterText, { color: active ? col : C.textSec, fontWeight: active ? '700' : '500' }]}>
                    {f}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        {/* ── Challenge sections ──────────────────────────────────────────── */}
        {groupedByDiff.map(({ difficulty, items }) => {
          const meta = DIFF[difficulty];
          const done = items.filter(c => completedIds.has(c.id)).length;
          return (
            <View key={difficulty} style={{ marginBottom: 24 }}>
              {/* Section header */}
              <View style={S.groupHeader}>
                <View style={[S.groupHeaderLine, { backgroundColor: meta.color }]} />
                <Text style={[S.groupTitle, { color: meta.color }]}>{difficulty.toUpperCase()}</Text>
                <View style={S.groupDots}>
                  {items.map(c => (
                    <View
                      key={c.id}
                      style={[S.groupDot, { backgroundColor: completedIds.has(c.id) ? meta.color : (dark ? '#334155' : '#E2E8F0') }]}
                    />
                  ))}
                </View>
                <Text style={[S.groupCount, { color: C.textMuted }]}>{done}/{items.length}</Text>
              </View>

              {/* Challenge cards */}
              {items.map(item => {
                const isDone   = completedIds.has(item.id);
                const isExpand = expanded === item.id;
                const isBusy   = completing === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[S.challengeCard, { backgroundColor: C.card }, isDone && { opacity: 0.55 }]}
                    onPress={() => toggleExpand(item.id)}
                    activeOpacity={0.85}
                  >
                    {/* Colored left strip */}
                    <View style={[S.cardStrip, { backgroundColor: meta.color }]} />

                    <View style={{ flex: 1 }}>
                      {/* Card top row */}
                      <View style={S.cardRow}>
                        <View style={[S.cardIcon, { backgroundColor: dark ? meta.bgDark : meta.bg }]}>
                          <Ionicons name={item.icon} size={16} color={meta.color} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[S.cardTitle, { color: isDone ? C.textMuted : C.text }, isDone && { textDecorationLine: 'line-through' }]} numberOfLines={1}>
                            {item.title}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <View style={[S.tagPill, { backgroundColor: dark ? 'rgba(255,255,255,0.07)' : '#F1F5F9' }]}>
                              <Text style={[S.tagText, { color: C.textMuted }]}>{item.tag}</Text>
                            </View>
                          </View>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 5 }}>
                          <View style={[S.xpPill, { backgroundColor: dark ? meta.bgDark : meta.bg }]}>
                            <Text style={[S.xpPillText, { color: meta.color }]}>+{item.xp} XP</Text>
                          </View>
                          {isDone
                            ? <Ionicons name="checkmark-circle" size={18} color={meta.color} />
                            : <Ionicons name={isExpand ? 'chevron-up' : 'chevron-down'} size={16} color={C.textMuted} />}
                        </View>
                      </View>

                      {/* Expanded panel */}
                      {isExpand && (
                        <View style={[S.expandPanel, { borderTopColor: dark ? '#1E293B' : '#F1F5F9' }]}>
                          <Text style={[S.expandDesc, { color: C.textSec }]}>{item.description}</Text>
                          {!isDone && (
                            <TouchableOpacity
                              style={[S.completeBtn, { backgroundColor: meta.color }]}
                              onPress={() => handleComplete(item.id)}
                              disabled={isBusy}
                              activeOpacity={0.8}
                            >
                              {isBusy
                                ? <ActivityIndicator size="small" color="#fff" />
                                : (
                                  <>
                                    <Ionicons name="checkmark" size={15} color="#fff" />
                                    <Text style={S.completeBtnText}>Mark Complete</Text>
                                  </>
                                )}
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const makeStyles = (C, dark) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Player card
  playerCard: {
    margin: 16,
    borderRadius: 24,
    backgroundColor: dark ? '#1E293B' : '#0F172A',
    padding: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  decoCircle1: {
    position: 'absolute', width: 180, height: 180, borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.04)', top: -60, right: -30,
  },
  decoCircle2: {
    position: 'absolute', width: 120, height: 120, borderRadius: 60,
    backgroundColor: 'rgba(255,255,255,0.03)', bottom: -20, left: 40,
  },
  decoCircle3: {
    position: 'absolute', width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.06)', top: 20, right: 100,
  },
  playerCardInner: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  playerLeft:  { flex: 1.2, gap: 4 },
  levelBadge:  { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1, marginBottom: 4 },
  levelBadgeNum: { fontSize: 12, fontWeight: '800' },
  playerTitle: { fontSize: 20, fontWeight: '800', color: '#fff' },
  playerXP:    { fontSize: 13, color: 'rgba(255,255,255,0.55)', fontWeight: '500' },

  playerStats:    { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 16 },
  playerStatItem: { alignItems: 'center' },
  playerStatNum:  { fontSize: 20, fontWeight: '800' },
  playerStatLabel:{ fontSize: 10, color: 'rgba(255,255,255,0.5)', fontWeight: '600', marginTop: 2 },

  xpBarTrack:  { height: 6, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  xpBarFill:   { height: '100%', borderRadius: 3 },
  xpBarLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  xpBarLabel:  { fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: '500' },

  dotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  dot:    { width: 7, height: 7, borderRadius: 4 },

  // Daily
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.1, marginBottom: 8 },
  dailyCard:  { flexDirection: 'row', alignItems: 'center', borderRadius: 18, padding: 14, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  dailyIconBox: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dailyTitle: { fontSize: 15, fontWeight: '700' },
  dailyDesc:  { fontSize: 12, lineHeight: 17 },
  dailyBtn:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, minWidth: 52, alignItems: 'center' },
  dailyBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },

  // Filter tabs
  filterTab:  { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  filterDot:  { width: 7, height: 7, borderRadius: 4 },
  filterText: { fontSize: 13 },

  // Group header
  groupHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  groupHeaderLine: { width: 3, height: 16, borderRadius: 2 },
  groupTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  groupDots:  { flexDirection: 'row', gap: 3, flex: 1 },
  groupDot:   { width: 8, height: 8, borderRadius: 4 },
  groupCount: { fontSize: 12, fontWeight: '500' },

  // Challenge cards
  challengeCard: {
    flexDirection: 'row', borderRadius: 14, marginBottom: 8, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  cardStrip: { width: 3 },
  cardRow:   { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  cardIcon:  { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700' },

  expandPanel: { paddingHorizontal: 12, paddingBottom: 12, borderTopWidth: 1, paddingTop: 10, marginLeft: 58 },
  expandDesc:  { fontSize: 13, lineHeight: 20, marginBottom: 12 },

  completeBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  completeBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Shared
  tagPill:   { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  tagText:   { fontSize: 10, fontWeight: '600' },
  xpPill:    { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  xpPillText:{ fontSize: 11, fontWeight: '700' },
});
