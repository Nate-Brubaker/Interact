import { useMemo } from 'react';
import { View, Text, Dimensions } from 'react-native';
import { useTheme } from '../lib/theme';

const { width: SCREEN_W } = Dimensions.get('window');

const DAY_HEADERS = ['S', 'M', 'T', 'W', 'TH', 'F', 'S'];
const CAL_GAP  = 4;
const CAL_HALF = Math.floor((SCREEN_W - 64 - 16) / 2);
const CELL     = Math.floor((CAL_HALF - 6 * CAL_GAP) / 7);

export default function ActivityCalendar({ sessions }) {
  const { dark, colors: C } = useTheme();

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

  const inactiveBg = dark ? C.success + '1F' : '#DCFCE7';

  return (
    <View style={{ width: CAL_HALF }}>
      <View style={{ flexDirection: 'row', gap: CAL_GAP, marginBottom: 6 }}>
        {DAY_HEADERS.map((h, i) => (
          <View key={i} style={{ width: CELL, alignItems: 'center' }}>
            <Text style={{ fontSize: 9, fontWeight: '700', color: i === todayDow ? C.success : C.textMuted }}>{h}</Text>
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
                  backgroundColor: active ? C.success : inactiveBg,
                  borderWidth: isToday ? 2 : 0,
                  borderColor: C.success,
                }} />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
