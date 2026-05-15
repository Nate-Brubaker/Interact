import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';

export default function SignUpScreen({ navigation }) {
  const { colors: C } = useTheme();
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [dob,       setDob]       = useState('');
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [loading,   setLoading]   = useState(false);

  function formatDob(text) {
    const digits = text.replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }

  async function handleSignUp() {
    if (!firstName || !email || !password) {
      Alert.alert('Missing fields', 'First name, email and password are required.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { firstName, lastName, dob } },
    });
    if (error) {
      Alert.alert('Sign Up Failed', error.message);
    } else {
      Alert.alert('Check your email', 'We sent you a confirmation link to verify your account.');
    }
    setLoading(false);
  }

  const inputStyle = [S.input, { borderColor: C.border, color: C.text, backgroundColor: C.card }];

  return (
    <KeyboardAvoidingView
      style={[S.container, { backgroundColor: C.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={S.inner}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[S.logo, { color: C.accent }]}>Interact</Text>
        <Text style={[S.tagline, { color: C.textMuted }]}>Create your account</Text>

        <View style={S.row}>
          <TextInput
            style={[inputStyle, S.inputHalf]}
            placeholder="First name"
            placeholderTextColor={C.textMuted}
            value={firstName}
            onChangeText={setFirstName}
            autoCapitalize="words"
          />
          <TextInput
            style={[inputStyle, S.inputHalf]}
            placeholder="Last name"
            placeholderTextColor={C.textMuted}
            value={lastName}
            onChangeText={setLastName}
            autoCapitalize="words"
          />
        </View>

        <TextInput
          style={inputStyle}
          placeholder="Date of birth (MM/DD/YYYY)"
          placeholderTextColor={C.textMuted}
          value={dob}
          onChangeText={t => setDob(formatDob(t))}
          keyboardType="number-pad"
          maxLength={10}
        />
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

        <TouchableOpacity style={[S.button, { backgroundColor: C.accent }]} onPress={handleSignUp} disabled={loading}>
          <Text style={S.buttonText}>{loading ? 'Creating account...' : 'Create Account'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text style={[S.link, { color: C.textMuted }]}>
            Already have an account?{' '}
            <Text style={[S.linkBold, { color: C.accent }]}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const S = StyleSheet.create({
  container: { flex: 1 },
  inner:     { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 60, flexGrow: 1 },
  logo:      { fontSize: 40, fontWeight: 'bold', marginBottom: 8 },
  tagline:   { fontSize: 16, marginBottom: 40 },
  row:       { flexDirection: 'row', gap: 10, width: '100%' },
  input: {
    width: '100%', height: 52, borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 16,
    fontSize: 16, marginBottom: 12,
  },
  inputHalf:  { flex: 1, width: undefined },
  button:     { width: '100%', height: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 20 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link:       { fontSize: 14 },
  linkBold:   { fontWeight: '600' },
});
