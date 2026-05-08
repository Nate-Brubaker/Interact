import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { getSettings, saveSettings, INPUT_MODES } from '../lib/settings';

const MODES = [
  {
    id: INPUT_MODES.AUTO_VAD,
    title: 'Auto — Silence Detection',
    desc: 'Recording starts when the AI finishes and stops automatically when you go quiet.',
    icon: 'mic-outline',
    badge: 'Default',
  },
  {
    id: INPUT_MODES.AUTO_COUNTDOWN,
    title: 'Auto-start + Countdown',
    desc: 'Recording starts automatically. A 20-second countdown shows. Tap Submit when done.',
    icon: 'timer-outline',
    badge: null,
  },
  {
    id: INPUT_MODES.PUSH_TO_SPEAK,
    title: 'Push to Speak',
    desc: 'Tap the mic to speak. A timer shows how long you took to respond.',
    icon: 'hand-left-outline',
    badge: null,
  },
];

export default function SettingsScreen() {
  const [selectedMode, setSelectedMode] = useState(INPUT_MODES.AUTO_VAD);

  useFocusEffect(
    useCallback(() => {
      getSettings().then(s => setSelectedMode(s.inputMode));
    }, [])
  );

  async function selectMode(id) {
    setSelectedMode(id);
    await saveSettings({ inputMode: id });
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Sign out failed', error.message);
  }

  return (
    <ScrollView style={S.container} contentContainerStyle={S.content} showsVerticalScrollIndicator={false}>
      <Text style={S.sectionLabel}>INPUT MODE</Text>

      {MODES.map(m => {
        const selected = selectedMode === m.id;
        return (
          <TouchableOpacity
            key={m.id}
            style={[S.card, selected && S.cardSelected]}
            onPress={() => selectMode(m.id)}
            activeOpacity={0.75}
          >
            <View style={[S.iconBox, selected && S.iconBoxSelected]}>
              <Ionicons name={m.icon} size={18} color={selected ? '#4F46E5' : '#94A3B8'} />
            </View>
            <View style={S.cardBody}>
              <View style={S.titleRow}>
                <Text style={[S.cardTitle, selected && S.cardTitleSelected]}>{m.title}</Text>
                {m.badge ? (
                  <View style={S.badge}>
                    <Text style={S.badgeText}>{m.badge}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={S.cardDesc}>{m.desc}</Text>
            </View>
            <View style={[S.radio, selected && S.radioSelected]}>
              {selected && <View style={S.radioDot} />}
            </View>
          </TouchableOpacity>
        );
      })}

      <Text style={[S.sectionLabel, { marginTop: 32 }]}>ACCOUNT</Text>
      <TouchableOpacity style={S.signOutBtn} onPress={signOut} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={18} color="#EF4444" />
        <Text style={S.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FF' },
  content:   { padding: 20, paddingBottom: 48 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#94A3B8', letterSpacing: 1.2, marginBottom: 10 },

  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 2, borderColor: 'transparent',
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
    gap: 12,
  },
  cardSelected: { borderColor: '#4F46E5' },

  iconBox: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center',
  },
  iconBoxSelected: { backgroundColor: '#EEF2FF' },

  cardBody:  { flex: 1 },
  titleRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#334155' },
  cardTitleSelected: { color: '#4F46E5' },
  cardDesc:  { fontSize: 12, color: '#94A3B8', lineHeight: 17 },

  badge:     { backgroundColor: '#EEF2FF', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: '700', color: '#4F46E5', letterSpacing: 0.5 },

  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: '#E2E8F0',
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { borderColor: '#4F46E5' },
  radioDot:      { width: 9, height: 9, borderRadius: 5, backgroundColor: '#4F46E5' },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FEF2F2', borderRadius: 14, padding: 14,
  },
  signOutText: { color: '#EF4444', fontWeight: '600', fontSize: 15 },
});
