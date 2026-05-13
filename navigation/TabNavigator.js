import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme';
import LearnScreen from '../screens/LearnScreen';
import TrainerScreen from '../screens/TrainerScreen';
import ChallengesScreen from '../screens/ChallengesScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

const ICONS = {
  Learn:      'book-outline',
  Trainer:    'mic-outline',
  Challenges: 'trophy-outline',
  Profile:    'person-outline',
};

function FloatingTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const { dark, colors: C } = useTheme();
  const radius = insets.bottom > 0 ? 28 : 14;
  const bottom = 19;

  return (
    <View style={[S.bar, { borderRadius: radius, bottom, backgroundColor: C.card }]}>
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const color   = focused ? (dark ? '#ffffff' : C.accent) : C.textSec;
        return (
          <TouchableOpacity
            key={route.key}
            style={S.tab}
            activeOpacity={0.7}
            onPress={() => {
              const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !e.defaultPrevented) navigation.navigate(route.name);
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
          >
            <Ionicons name={ICONS[route.name]} size={22} color={color} />
            <Text style={[S.label, { color }]}>{route.name}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const S = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 19, right: 19,
    flexDirection: 'row',
    backgroundColor: '#fff',
    height: 62,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 12,
  },
  tab:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontSize: 10, fontWeight: '600' },
});

export default function TabNavigator() {
  const { colors: C } = useTheme();
  return (
    <Tab.Navigator
      tabBar={props => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: C.card },
        headerTintColor: C.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
      }}
    >
      <Tab.Screen name="Learn"      component={LearnScreen} />
      <Tab.Screen name="Trainer"    component={TrainerScreen} />
      <Tab.Screen name="Challenges" component={ChallengesScreen} />
      <Tab.Screen name="Profile"    component={ProfileScreen} />
    </Tab.Navigator>
  );
}
