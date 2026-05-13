import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Modal, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { getSessions } from '../lib/sessions';
import { getCompletedChallenges } from '../lib/challenges';
import { CHALLENGES } from '../data/challenges';
import { BADGES } from '../data/badges';
import { useTheme } from '../lib/theme';

// ─── Shared level system ──────────────────────────────────────────────────────
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
  const idx      = LEVELS.indexOf(level);
  const next     = LEVELS[idx + 1] ?? null;
  const fromPrev = xp - level.threshold;
  const toNext   = next ? next.threshold - level.threshold : 1;
  return { ...level, index: idx, next, progress: Math.min(fromPrev / toNext, 1) };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const { dark, colors: C } = useTheme();
  const navigation = useNavigation();

  const [sessions,     setSessions]     = useState([]);
  const [completedIds, setCompletedIds] = useState(new Set());
  const [loading,      setLoading]      = useState(true);
  const [displayName,  setDisplayName]  = useState('');
  const [email,        setEmail]        = useState('');
  const [avatarUri,    setAvatarUri]    = useState(null);
  const [editingName,  setEditingName]  = useState(false);
  const [nameInput,    setNameInput]    = useState('');
  const [streak,       setStreak]       = useState(0);

  useFocusEffect(useCallback(() => {
    load();
  }, []));

  async function load() {
    setLoading(true);
    const [{ data: { user } }, sess, chal, storedName, storedAvatar] = await Promise.all([
      supabase.auth.getUser(),
      getSessions(),
      getCompletedChallenges(),
      AsyncStorage.getItem('profile_display_name'),
      AsyncStorage.getItem('profile_avatar_uri'),
    ]);

    setSessions(sess);
    setCompletedIds(new Set(chal.map(c => c.challenge_id)));
    setEmail(user?.email ?? '');
    if (storedAvatar) setAvatarUri(storedAvatar);

    const name = storedName
      || user?.user_metadata?.full_name
      || user?.email?.split('@')[0]
      || 'You';
    setDisplayName(name);

    // streak
    const days = new Set(sess.map(s => s.created_at.slice(0, 10)));
    const now   = new Date();
    const localStr = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const today = localStr(now);
    let cur = 0;
    const d = new Date();
    if (!days.has(today)) d.setDate(d.getDate() - 1);
    while (days.has(localStr(d))) { cur++; d.setDate(d.getDate() - 1); }
    setStreak(cur);

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

  const totalXP = useMemo(
    () => CHALLENGES.filter(c => completedIds.has(c.id)).reduce((s, c) => s + c.xp, 0),
    [completedIds],
  );
  const levelInfo = useMemo(() => getLevel(totalXP), [totalXP]);

  const badgeStats = useMemo(() => {
    const byDiff = d => CHALLENGES.filter(c => c.difficulty === d);
    return {
      sessions,
      streak,
      completedCount: completedIds.size,
      totalChallenges: CHALLENGES.length,
      easyDone:   byDiff('Easy').filter(c => completedIds.has(c.id)).length,
      easyTotal:  byDiff('Easy').length,
      mediumDone: byDiff('Medium').filter(c => completedIds.has(c.id)).length,
      mediumTotal:byDiff('Medium').length,
      hardDone:   byDiff('Hard').filter(c => completedIds.has(c.id)).length,
      hardTotal:  byDiff('Hard').length,
      levelIndex: levelInfo.index,
    };
  }, [sessions, completedIds, streak, levelInfo]);

  const initials = displayName
    .split(' ').slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?';

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
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <View style={[S.header, { backgroundColor: levelInfo.cardBg }]}>
        {/* Deco circles */}
        <View style={[S.deco1, { backgroundColor: levelInfo.color + '18' }]} />
        <View style={[S.deco2, { backgroundColor: levelInfo.color + '10' }]} />

        {/* Avatar */}
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

        {/* Name + email */}
        <TouchableOpacity onPress={() => { setNameInput(displayName); setEditingName(true); }} style={{ alignItems: 'center', gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={S.nameText}>{displayName}</Text>
            <Ionicons name="pencil" size={13} color="rgba(255,255,255,0.4)" />
          </View>
          <Text style={S.emailText}>{email}</Text>
        </TouchableOpacity>

        {/* Level badge */}
        <View style={[S.levelPill, { backgroundColor: levelInfo.color + '22', borderColor: levelInfo.color + '55' }]}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: levelInfo.color }} />
          <Text style={[S.levelPillText, { color: levelInfo.color }]}>
            Lv.{levelInfo.index + 1}  ·  {levelInfo.title}
          </Text>
        </View>

        {/* XP bar */}
        <View style={{ width: '100%', marginTop: 14 }}>
          <View style={S.xpTrack}>
            <View style={[S.xpFill, { backgroundColor: levelInfo.color, width: `${Math.round(levelInfo.progress * 100)}%` }]} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
            <Text style={S.xpLabel}>{totalXP} XP</Text>
            {levelInfo.next && (
              <Text style={S.xpLabel}>{levelInfo.next.threshold} XP · {levelInfo.next.title}</Text>
            )}
          </View>
        </View>
      </View>

      {/* ── Stats strip ───────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 0 }}>
        {[
          { label: 'Sessions',   value: sessions.length },
          { label: 'Challenges', value: completedIds.size },
          { label: 'Total XP',   value: totalXP },
          { label: 'Streak',     value: streak },
        ].map(({ label, value }) => (
          <View key={label} style={[S.statBox, { backgroundColor: C.card }]}>
            <Text style={{ fontSize: 22, fontWeight: '900', color: C.text }}>{value}</Text>
            <Text style={{ fontSize: 10, fontWeight: '600', color: C.textMuted, marginTop: 2 }}>{label.toUpperCase()}</Text>
          </View>
        ))}
      </View>

      {/* ── Badges ────────────────────────────────────────────────────────── */}
      <Text style={[S.section, { color: C.textMuted, paddingHorizontal: 16, marginTop: 24 }]}>BADGES</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10 }}>
        {BADGES.map(badge => {
          const earned = badge.check(badgeStats);
          return (
            <View
              key={badge.id}
              style={[S.badgeCard, { backgroundColor: C.card,
                borderWidth: earned ? 1.5 : 0,
                borderColor: earned ? badge.color + '55' : 'transparent',
                opacity: earned ? 1 : 0.45,
              }]}
            >
              <View style={[S.badgeIcon, { backgroundColor: earned ? badge.color + '22' : (dark ? '#1E293B' : '#F1F5F9') }]}>
                <Ionicons name={badge.icon} size={22} color={earned ? badge.color : C.textMuted} />
              </View>
              <Text style={{ fontSize: 11, fontWeight: '700', color: earned ? C.text : C.textMuted, textAlign: 'center', marginTop: 6 }} numberOfLines={2}>
                {badge.title}
              </Text>
              {earned && (
                <View style={[S.earnedDot, { backgroundColor: badge.color }]} />
              )}
            </View>
          );
        })}
      </View>

      {/* ── Settings link ─────────────────────────────────────────────────── */}
      <TouchableOpacity
        style={[S.settingsBtn, { backgroundColor: C.card, marginHorizontal: 16, marginTop: 24 }]}
        onPress={() => navigation.navigate('Settings')}
        activeOpacity={0.7}
      >
        <Ionicons name="settings-outline" size={18} color={C.textSec} />
        <Text style={{ fontSize: 14, fontWeight: '600', color: C.textSec, flex: 1 }}>Settings</Text>
        <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
      </TouchableOpacity>

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

  header: {
    padding: 28, paddingTop: 36, alignItems: 'center', gap: 10,
    overflow: 'hidden',
  },
  deco1: { position: 'absolute', width: 200, height: 200, borderRadius: 100, top: -80, right: -40 },
  deco2: { position: 'absolute', width: 130, height: 130, borderRadius: 65, bottom: -30, left: 20 },

  avatarRing:  { width: 84, height: 84, borderRadius: 42, borderWidth: 3, padding: 3, marginBottom: 4 },
  avatar:      { flex: 1, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: '100%', height: '100%', borderRadius: 38 },
  avatarText:  { fontSize: 28, fontWeight: '900' },
  cameraBtn:   { position: 'absolute', bottom: 2, right: 0, width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(0,0,0,0.3)',
  },

  nameText:  { fontSize: 20, fontWeight: '800', color: '#fff' },
  emailText: { fontSize: 12, color: 'rgba(255,255,255,0.45)', fontWeight: '400' },

  levelPill: { flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  levelPillText: { fontSize: 13, fontWeight: '700' },

  xpTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'hidden' },
  xpFill:  { height: '100%', borderRadius: 3 },
  xpLabel: { fontSize: 10, color: 'rgba(255,255,255,0.35)', fontWeight: '500' },

  statBox: { flex: 1, borderRadius: 14, padding: 12, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },

  section: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 12 },

  badgeCard: { width: '30%', borderRadius: 16, padding: 12, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  badgeIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  earnedDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },

  settingsBtn: { flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  modalBox:   { width: '100%', borderRadius: 20, padding: 22 },
  nameInput:  { borderRadius: 12, padding: 14, fontSize: 16, fontWeight: '500' },
  modalBtn:   { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
});
