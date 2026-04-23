import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../utils/api';
import { setParentAuth, getItem } from '../utils/storage';
import { COLORS, API_BASE_URL } from '../constants';

function resolveLogoUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  const base = API_BASE_URL.replace(/\/api$/, '').replace(/\/backend\/api$/, '/backend');
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`;
}

export default function LoginScreen({ navigation }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [schoolLogoUrl, setSchoolLogoUrl] = useState('');
  const [schoolName, setSchoolName] = useState('');

  useEffect(() => {
    getItem('parentSchoolLogoUrl').then((v) => setSchoolLogoUrl(v || ''));
    getItem('parentSchoolName').then((v) => setSchoolName(v || ''));
  }, []);

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Signup state
  const [suName, setSuName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suPhone, setSuPhone] = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [suConfirm, setSuConfirm] = useState('');
  const [suError, setSuError] = useState('');
  const [suLoading, setSuLoading] = useState(false);

  const resolvedLogo = schoolLogoUrl ? resolveLogoUrl(schoolLogoUrl) : null;

  const handleLogin = async () => {
    if (!email.trim() || !password) { setError('Please enter email and password'); return; }
    setLoading(true); setError('');
    const { ok, data } = await api('parent-portal?action=login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    if (!ok) { setError(data.error || 'Login failed'); setLoading(false); return; }
    const logoUrl  = (data.data.school && data.data.school.logo_url) || '';
    const sName    = (data.data.school && data.data.school.name) || '';
    await setParentAuth(data.data.parent.email, data.data.parent.full_name, logoUrl, sName);
    setLoading(false);
    navigation.replace('Dashboard');
  };

  const handleSignup = async () => {
    if (!suName.trim() || !suEmail.trim() || !suPassword) { setSuError('Name, email and password are required'); return; }
    if (suPassword !== suConfirm) { setSuError('Passwords do not match'); return; }
    if (suPassword.length < 6) { setSuError('Password must be at least 6 characters'); return; }
    setSuLoading(true); setSuError('');
    const { ok, data } = await api('parent-portal?action=signup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: suName.trim(), email: suEmail.trim(), phone: suPhone.trim(), password: suPassword }),
    });
    if (!ok) { setSuError(data.error || 'Signup failed'); setSuLoading(false); return; }
    const logoUrl = (data.data.school && data.data.school.logo_url) || '';
    const sName   = (data.data.school && data.data.school.name) || '';
    await setParentAuth(data.data.parent.email, data.data.parent.full_name, logoUrl, sName);
    setSuLoading(false);
    navigation.replace('Dashboard');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={styles.headerSection}>
            {resolvedLogo ? (
              <Image source={{ uri: resolvedLogo }} style={styles.logoImage} resizeMode="contain" />
            ) : (
              <Image source={require('../../assets/logo.webp')} style={styles.logoImage} resizeMode="contain" />
            )}
            <View style={styles.badgeWrap}>
              <Text style={styles.badge}>{schoolName || 'Parent Portal'}</Text>
            </View>
            <Text style={styles.title}>{mode === 'login' ? 'Parent Access' : 'Create Account'}</Text>
            <Text style={styles.subtitle}>
              {mode === 'login'
                ? 'Track your child wallet, view transactions, and recharge anytime.'
                : 'Register to manage your child\'s meals and wallet.'}
            </Text>
          </View>

          {/* Mode toggle */}
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleBtn, mode === 'login' && styles.toggleBtnActive]}
              onPress={() => { setMode('login'); setError(''); setSuError(''); }}
            >
              <Text style={[styles.toggleText, mode === 'login' && styles.toggleTextActive]}>Sign In</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, mode === 'signup' && styles.toggleBtnActive]}
              onPress={() => { setMode('signup'); setError(''); setSuError(''); }}
            >
              <Text style={[styles.toggleText, mode === 'signup' && styles.toggleTextActive]}>Sign Up</Text>
            </TouchableOpacity>
          </View>

          {/* Card */}
          <View style={styles.card}>
            {mode === 'login' ? (
              <>
                <Text style={styles.label}>Email</Text>
                <TextInput style={styles.input} value={email} onChangeText={setEmail}
                  placeholder="parent@example.com" placeholderTextColor={COLORS.textLight}
                  keyboardType="email-address" autoCapitalize="none" editable={!loading} />
                <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
                <TextInput style={styles.input} value={password} onChangeText={setPassword}
                  placeholder="Enter password" placeholderTextColor={COLORS.textLight}
                  secureTextEntry editable={!loading} onSubmitEditing={handleLogin} returnKeyType="done" />
                {!!error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
                <TouchableOpacity style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
                  onPress={handleLogin} disabled={loading} activeOpacity={0.8}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Sign in to Parent Portal</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.label}>Full Name *</Text>
                <TextInput style={styles.input} value={suName} onChangeText={setSuName}
                  placeholder="Your full name" placeholderTextColor={COLORS.textLight} editable={!suLoading} />
                <Text style={[styles.label, { marginTop: 12 }]}>Email *</Text>
                <TextInput style={styles.input} value={suEmail} onChangeText={setSuEmail}
                  placeholder="parent@example.com" placeholderTextColor={COLORS.textLight}
                  keyboardType="email-address" autoCapitalize="none" editable={!suLoading} />
                <Text style={[styles.label, { marginTop: 12 }]}>Phone (optional)</Text>
                <TextInput style={styles.input} value={suPhone} onChangeText={setSuPhone}
                  placeholder="+91 98765 43210" placeholderTextColor={COLORS.textLight}
                  keyboardType="phone-pad" editable={!suLoading} />
                <Text style={[styles.label, { marginTop: 12 }]}>Password *</Text>
                <TextInput style={styles.input} value={suPassword} onChangeText={setSuPassword}
                  placeholder="Min 6 characters" placeholderTextColor={COLORS.textLight}
                  secureTextEntry editable={!suLoading} />
                <Text style={[styles.label, { marginTop: 12 }]}>Confirm Password *</Text>
                <TextInput style={styles.input} value={suConfirm} onChangeText={setSuConfirm}
                  placeholder="Repeat password" placeholderTextColor={COLORS.textLight}
                  secureTextEntry editable={!suLoading} onSubmitEditing={handleSignup} returnKeyType="done" />
                {!!suError && <View style={styles.errorBox}><Text style={styles.errorText}>{suError}</Text></View>}
                <TouchableOpacity style={[styles.loginBtn, suLoading && styles.loginBtnDisabled]}
                  onPress={handleSignup} disabled={suLoading} activeOpacity={0.8}>
                  {suLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.loginBtnText}>Create Account</Text>}
                </TouchableOpacity>
                <Text style={styles.signupNote}>
                  After signing up, ask your school to link your children using this email address.
                </Text>
              </>
            )}
          </View>

          <Text style={styles.footerText}>Tap-N-Eat v1.0</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fffaf2' },
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  headerSection: { alignItems: 'center', marginBottom: 24 },
  logoImage: { width: 100, height: 100, marginBottom: 16, borderRadius: 12 },
  badgeWrap: { backgroundColor: COLORS.accent, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 4, marginBottom: 12 },
  badge: { color: '#fff', fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.text, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', lineHeight: 19 },
  toggleRow: { flexDirection: 'row', marginBottom: 16, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  toggleBtn: { flex: 1, paddingVertical: 11, alignItems: 'center', backgroundColor: COLORS.background },
  toggleBtnActive: { backgroundColor: COLORS.accent },
  toggleText: { fontWeight: '700', fontSize: 14, color: COLORS.textMuted },
  toggleTextActive: { color: '#fff' },
  card: { backgroundColor: COLORS.cardBg, borderRadius: 16, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 10, fontSize: 15, color: COLORS.text, backgroundColor: COLORS.background },
  errorBox: { backgroundColor: COLORS.dangerLight, borderRadius: 8, padding: 12, marginTop: 14 },
  errorText: { color: COLORS.danger, fontSize: 13, fontWeight: '500' },
  loginBtn: { backgroundColor: COLORS.accent, borderRadius: 10, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  signupNote: { textAlign: 'center', color: COLORS.textLight, fontSize: 11, marginTop: 14, lineHeight: 16 },
  footerText: { textAlign: 'center', color: COLORS.textLight, fontSize: 12, marginTop: 24 },
});
