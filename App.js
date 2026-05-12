import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { View, ActivityIndicator, Animated, StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { supabase } from './lib/supabase';
import { ThemeProvider, useTheme } from './lib/theme';
import TabNavigator from './navigation/TabNavigator';
import AuthNavigator from './navigation/AuthNavigator';

function AppContent({ session }) {
  const { dark } = useTheme();
  const fadeAnim      = useRef(new Animated.Value(0)).current;
  const animRef       = useRef(null);
  const isFirstRender = useRef(true);
  const prevDarkRef   = useRef(dark);

  // Computed during render before useLayoutEffect updates prevDarkRef — gives the OLD bg color
  const overlayBg = prevDarkRef.current ? '#0F172A' : '#F8F9FF';

  useLayoutEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; prevDarkRef.current = dark; return; }
    prevDarkRef.current = dark;
    animRef.current?.stop();
    fadeAnim.setValue(1);
    animRef.current = Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: false });
    animRef.current.start();
  }, [dark]);

  const navTheme = dark
    ? { ...DarkTheme,    colors: { ...DarkTheme.colors,    background: '#0F172A', card: '#1E293B' } }
    : { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: '#F8F9FF', card: '#ffffff' } };

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {session ? <TabNavigator /> : <AuthNavigator />}
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: overlayBg, opacity: fadeAnim }]}
        pointerEvents="none"
      />
    </NavigationContainer>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <ThemeProvider>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#4F46E5" />
        </View>
      ) : (
        <AppContent session={session} />
      )}
    </ThemeProvider>
  );
}
