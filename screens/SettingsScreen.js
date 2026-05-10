import { useState, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { getSettings, saveSettings } from '../lib/settings';
import { getProfile, calculateAge } from '../lib/profile';
import { useTheme, DARK } from '../lib/theme';

function SectionLabel({ label, top, C }) {
  return <Text style={[{ fontSize: 11, fontWeight: '700', color: C.textMuted, letterSpacing: 1.2, marginBottom: 10 }, top && { marginTop: top }]}>{label}</Text>;
}

function ToggleRow({ label, desc, value, onToggle, C }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 }}>{label}</Text>
        {desc ? <Text style={{ fontSize: 12, color: C.textMuted, lineHeight: 17 }}>{desc}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: '#E2E8F0', true: DARK.accentLight }}
        thumbColor='#ffffff'
      />
    </View>
  );
}

export default function SettingsScreen() {
  const { dark, setDark, useSystem, setUseSystem, colors: C } = useTheme();
  const [settings, setSettings] = useState(null);
  const [profile,  setProfile]  = useState(null);

  const S = useMemo(() => makeStyles(C), [C]);

  useFocusEffect(
    useCallback(() => {
      getSettings().then(setSettings);
      getProfile().then(setProfile);
    }, [])
  );

  async function update(key, value) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    await saveSettings({ [key]: value });
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) Alert.alert('Sign out failed', error.message);
  }

  if (!settings) return null;

  return (
    <ScrollView style={S.container} contentContainerStyle={S.content} showsVerticalScrollIndicator={false}>

      {profile?.firstName ? (
        <>
          <SectionLabel label="PROFILE" C={C} />
          <View style={S.profileCard}>
            <View style={S.profileAvatar}>
              <Text style={S.profileInitial}>{profile.firstName[0].toUpperCase()}</Text>
            </View>
            <View>
              <Text style={S.profileName}>{[profile.firstName, profile.lastName].filter(Boolean).join(' ')}</Text>
              {profile.dob ? (
                <Text style={S.profileSub}>
                  {profile.dob}{calculateAge(profile.dob) ? ` · ${calculateAge(profile.dob)} years old` : ''}
                </Text>
              ) : null}
            </View>
          </View>
        </>
      ) : null}

      <SectionLabel label="APPEARANCE" top={profile?.firstName ? 28 : 0} C={C} />
      <View style={S.group}>
        <ToggleRow
          label="Use System Theme"
          desc="Automatically match your device's appearance."
          value={useSystem}
          onToggle={setUseSystem}
          C={C}
        />
        {!useSystem && (
          <>
            <View style={{ height: 1, backgroundColor: C.divider, marginHorizontal: 14 }} />
            <View style={{ padding: 14, gap: 8 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 }}>Theme</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[{ label: 'Light', icon: 'sunny-outline', value: false }, { label: 'Dark', icon: 'moon-outline', value: true }].map(opt => {
                  const active = dark === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.label}
                      onPress={() => setDark(opt.value)}
                      activeOpacity={0.7}
                      style={{
                        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                        gap: 6, paddingVertical: 10, borderRadius: 10,
                        backgroundColor: active ? C.accent : C.bgAlt,
                        borderWidth: 1.5,
                        borderColor: active ? C.accent : C.border,
                      }}
                    >
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

      <SectionLabel label="NOTIFICATIONS" top={28} C={C} />
      <View style={S.group}>
        <ToggleRow
          label="Practice Reminders"
          desc="Daily nudge to keep your skills sharp."
          value={settings.practiceReminders}
          onToggle={v => update('practiceReminders', v)}
          C={C}
        />
      </View>

      <SectionLabel label="APP" top={28} C={C} />
      <View style={S.group}>
        <ToggleRow
          label="Haptic Feedback"
          desc="Vibrate when recording starts and stops."
          value={settings.hapticFeedback}
          onToggle={v => update('hapticFeedback', v)}
          C={C}
        />
      </View>

      <SectionLabel label="ACCOUNT" top={28} C={C} />
      <TouchableOpacity style={S.signOutBtn} onPress={signOut} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={18} color="#EF4444" />
        <Text style={S.signOutText}>Sign Out</Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

const makeStyles = (C) => StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content:   { padding: 20, paddingBottom: 110 },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.card, borderRadius: 16, padding: 14, marginBottom: 10,
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  profileAvatar:  { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  profileInitial: { color: '#fff', fontWeight: '700', fontSize: 18 },
  profileName:    { fontSize: 15, fontWeight: '700', color: C.text },
  profileSub:     { fontSize: 12, color: C.textMuted, marginTop: 2 },

  group: {
    backgroundColor: C.card, borderRadius: 14, overflow: 'hidden',
    shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },

  signOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: C.dangerBg, borderRadius: 14, padding: 14,
  },
  signOutText: { color: '#EF4444', fontWeight: '600', fontSize: 15 },
});
