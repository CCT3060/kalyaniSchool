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
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} size="large" />
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
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingBottom: 40 },
  headerSection: { alignItems: 'center', marginBottom: 36 },
  logoImage: { width: 180, height: 70, marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.text, textAlign: 'center', marginBottom: 12, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: COLORS.textMuted, textAlign: 'center', lineHeight: 22, paddingHorizontal: 16 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 28,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 8 },
  input: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 16 : 12,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: '#F8FAFC',
  },
  errorBox: { backgroundColor: COLORS.dangerLight, borderRadius: 10, padding: 14, marginTop: 16 },
  errorText: { color: COLORS.danger, fontSize: 14, fontWeight: '600' },
  btn: { 
    backgroundColor: COLORS.primary, 
    borderRadius: 14, 
    paddingVertical: 18, 
    alignItems: 'center', 
    marginTop: 24,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  btnDisabled: { opacity: 0.5, shadowOpacity: 0, elevation: 0 },
  btnText: { color: '#ffffff', fontSize: 17, fontWeight: '700', letterSpacing: 0.5 },
  footer: { alignItems: 'center', marginTop: 48 },
  footerText: { textAlign: 'center', color: COLORS.textLight, fontSize: 12, lineHeight: 18, fontWeight: '500' },
});
