import { useRef, useEffect, useMemo } from 'react';
import { View, Text, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme';
import { streakColor } from '../lib/streaks';

const WEEK_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export default function StreakCard({ currentStreak, sessions }) {
  const { dark, colors: C } = useTheme();
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
    const d = new Date(today);
    d.setDate(today.getDate() - todayDow + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return { label, dateStr, isToday: dateStr === todayStr };
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
