import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../utils/api';
import { getItem, setItem } from '../utils/storage';
import { COLORS } from '../constants';

export default function SchoolCodeScreen({ navigation }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // If already logged in, skip straight to Dashboard
    getItem('parentEmail').then((email) => {
      if (email) {
        navigation.replace('Dashboard');
      } else {
        setChecking(false);
      }
    });
  }, []);

  const handleVerify = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setError('Please enter your school code'); return; }
    setLoading(true); setError('');
    const { ok, data } = await api(`schools?action=lookup_code&code=${encodeURIComponent(trimmed)}`);
    if (!ok) {
      setError(data.error || 'School not found. Check the code and try again.');
      setLoading(false);
      return;
    }
    const school = data.school || {};
    await Promise.all([
      setItem('parentSchoolCode', trimmed),
      setItem('parentSchoolId', school.id || ''),
      setItem('parentSchoolName', school.name || ''),
      setItem('parentSchoolLogoUrl', school.logo_url || ''),
    ]);
    // Navigate to Login with school info so both login & signup know the school context
    navigation.replace('Login', { schoolInfo: school });
  };

  if (checking) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fffaf2', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.accent} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.headerSection}>
            <Image source={require('../../assets/cct-logo.png')} style={styles.logoImage} resizeMode="contain" />
            <Text style={styles.title}>Welcome to Tap-N-Eat</Text>
            <Text style={styles.subtitle}>
              Enter the school code provided by your school office to get started.
            </Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            <Text style={styles.label}>School Code</Text>
            <TextInput
              style={[styles.input, { letterSpacing: 2, textTransform: 'uppercase' }]}
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
              placeholder="e.g. KA-01"
              placeholderTextColor={COLORS.textLight}
              autoCapitalize="characters"
              editable={!loading}
              onSubmitEditing={handleVerify}
              returnKeyType="go"
              autoFocus
            />
            <Text style={{ fontSize: 12, color: COLORS.textLight, marginTop: 6, lineHeight: 17 }}>
              This code links you to your school's canteen system. Ask your school office if you don't have it.
            </Text>
            {!!error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            <TouchableOpacity
              style={[styles.btn, loading && styles.btnDisabled]}
              onPress={handleVerify}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Continue →</Text>}
            </TouchableOpacity>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Powered by Comprehensive Cloud Technologies Pvt Ltd</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fffaf2' },
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingBottom: 40 },
  headerSection: { alignItems: 'center', marginBottom: 32 },
  logoImage: { width: 200, height: 80, marginBottom: 20 },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.text, textAlign: 'center', marginBottom: 10 },
  subtitle: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', lineHeight: 19 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontSize: 15,
    color: COLORS.text,
    backgroundColor: COLORS.background,
  },
  errorBox: { backgroundColor: COLORS.dangerLight, borderRadius: 8, padding: 12, marginTop: 14 },
  errorText: { color: COLORS.danger, fontSize: 13, fontWeight: '500' },
  btn: { backgroundColor: COLORS.accent, borderRadius: 10, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  footer: { alignItems: 'center', marginTop: 40 },
  footerText: { textAlign: 'center', color: COLORS.textMuted, fontSize: 10, lineHeight: 15 },
});
