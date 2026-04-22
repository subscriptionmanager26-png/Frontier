import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useAuth } from '@/contexts/AuthContext';

export default function AuthScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const { signIn, signUp, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const submit = async () => {
    const e = email.trim();
    const p = password;
    if (!e || !p) {
      setError('Enter email and password.');
      setInfo('');
      return;
    }
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'signin') {
        const { error: err } = await signIn(e, p);
        if (err) {
          setError(err);
        } else {
          setInfo('Signed in.');
        }
      } else {
        const { error: err, needsEmailConfirmation } = await signUp(e, p);
        if (err) {
          setError(err);
        } else if (needsEmailConfirmation) {
          setInfo('Account created. Check your email to confirm, then sign in.');
          setMode('signin');
        } else {
          setInfo('Account created and signed in.');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Frontier</Text>
        <Text style={[styles.subtitle, { color: colors.mutedText }]}>
          {mode === 'signin' ? 'Sign in to restore your data.' : 'Create account to sync your data.'}
        </Text>
        {!configured ? (
          <Text style={[styles.error, { color: colors.negative }]}>
            Supabase config missing. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in app config.
          </Text>
        ) : null}
        <TextInput
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="Email"
          placeholderTextColor={colors.mutedText}
          value={email}
          onChangeText={setEmail}
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.engagement }]}
          editable={!busy}
        />
        <View
          style={[
            styles.passwordRow,
            { borderColor: colors.border, backgroundColor: colors.engagement },
          ]}>
          <TextInput
            secureTextEntry={!showPassword}
            placeholder="Password"
            placeholderTextColor={colors.mutedText}
            value={password}
            onChangeText={setPassword}
            style={[styles.passwordField, { color: colors.text }]}
            editable={!busy}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            onPress={() => setShowPassword((v) => !v)}
            disabled={busy}
            hitSlop={10}
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            accessibilityRole="button"
            style={styles.passwordToggle}>
            <FontAwesome name={showPassword ? 'eye-slash' : 'eye'} size={20} color={colors.mutedText} />
          </Pressable>
        </View>
        {mode === 'signup' ? (
          <Text style={[styles.fieldHint, { color: colors.mutedText }]}>
            Your public agent handle is derived from your email (full address) and cannot be changed after signup.
          </Text>
        ) : null}
        {error ? <Text style={[styles.error, { color: colors.negative }]}>{error}</Text> : null}
        {info ? <Text style={[styles.info, { color: colors.tint }]}>{info}</Text> : null}
        <Pressable
          onPress={() => void submit()}
          disabled={busy || !configured}
          style={[styles.button, { backgroundColor: colors.tint, opacity: busy || !configured ? 0.6 : 1 }]}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{mode === 'signin' ? 'Sign in' : 'Sign up'}</Text>
          )}
        </Pressable>
        <Pressable onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')} disabled={busy}>
          <Text style={{ color: colors.tint, textAlign: 'center', marginTop: 12 }}>
            {mode === 'signin' ? 'Create an account' : 'Already have an account? Sign in'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: 20 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 16 },
  title: { fontSize: 26, fontWeight: '700' },
  subtitle: { marginTop: 6, marginBottom: 14 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 8,
    paddingRight: 4,
  },
  passwordField: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  passwordToggle: { padding: 10 },
  button: { marginTop: 14, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  error: { marginTop: 8, fontSize: 13 },
  info: { marginTop: 8, fontSize: 13 },
  fieldHint: { marginTop: 10, fontSize: 12, lineHeight: 17 },
});
