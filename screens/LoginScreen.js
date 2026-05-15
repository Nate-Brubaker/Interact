import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';

export default function LoginScreen({ navigation }) {
  const { colors: C } = useTheme();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleLogin() {
    if (!email || !password) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) Alert.alert('Sign In Failed', error.message);
    setLoading(false);
  }

  const inputStyle = [S.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }];

  return (
    <KeyboardAvoidingView
      style={[S.container, { backgroundColor: C.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={S.inner}>
        <Text style={[S.logo, { color: C.accent }]}>Interact</Text>
        <Text style={[S.tagline, { color: C.textMuted }]}>Level up your social skills</Text>

        <TextInput
          style={inputStyle}
          placeholder="Email"
          placeholderTextColor={C.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={inputStyle}
          placeholder="Password"
          placeholderTextColor={C.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity style={[S.button, { backgroundColor: C.accent }]} onPress={handleLogin} disabled={loading}>
          <Text style={S.buttonText}>{loading ? 'Signing in...' : 'Sign In'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('SignUp')}>
          <Text style={[S.link, { color: C.textMuted }]}>
            Don't have an account?{' '}
            <Text style={[S.linkBold, { color: C.accent }]}>Sign up</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1 },
  inner:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  logo:      { fontSize: 40, fontWeight: 'bold', marginBottom: 8 },
  tagline:   { fontSize: 16, marginBottom: 40 },
  input: {
    width: '100%', height: 52, borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 16,
    fontSize: 16, marginBottom: 12,
  },
  button:     { width: '100%', height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 20 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link:       { fontSize: 14 },
  linkBold:   { fontWeight: '600' },
});
