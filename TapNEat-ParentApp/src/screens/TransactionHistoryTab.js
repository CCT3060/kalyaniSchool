import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { api } from '../utils/api';
import { COLORS } from '../constants';

export default function TransactionHistoryTab({ parentEmail }) {
  const [children, setChildren] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [alertMsg, setAlertMsg] = useState({ type: '', text: '' });

  const showAlert = (text, type = 'error') => {
    setAlertMsg({ type, text });
    setTimeout(() => setAlertMsg({ type: '', text: '' }), 4000);
  };

  const selectedChild = children.find((c) => c.id === selectedChildId) || null;

  const loadChildren = useCallback(async () => {
    if (!parentEmail) return;
    const { ok, data } = await api(
      `parent-portal?action=profile&email=${encodeURIComponent(parentEmail)}`
    );
    if (ok && data.children) {
      setChildren(data.children || []);
      setLoadError('');
      if (data.children.length > 0 && !selectedChildId) {
        setSelectedChildId(data.children[0].id);
      }
    } else if (!ok) {
      setLoadError(data.error || 'Could not connect to server. Please check your connection.');
    }
  }, [parentEmail, selectedChildId]);

  const loadPayments = useCallback(async (childId) => {
    if (!childId || !parentEmail) return;
    const { ok, data } = await api(
      `parent-portal?action=payment-history&email=${encodeURIComponent(parentEmail)}&student_id=${childId}`
    );
    if (ok) setPayments(data.payments || []);
    else showAlert(data.error || 'Failed to load payment history');
  }, [parentEmail]);

  const loadAll = useCallback(async (childId) => {
    setLoading(true);
    await loadChildren();
    const cid = childId || selectedChildId;
    if (cid) await loadPayments(cid);
    setLoading(false);
  }, [loadChildren, loadPayments, selectedChildId]);

  useEffect(() => { loadAll(); }, [parentEmail]);

  useEffect(() => {
    if (selectedChildId) loadPayments(selectedChildId);
  }, [selectedChildId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAll(selectedChildId);
    setRefreshing(false);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
      });
    } catch { return dateStr; }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading payment history…</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text style={{ fontSize: 48, marginBottom: 12 }}>⚠️</Text>
        <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8 }}>Connection Error</Text>
        <Text style={{ fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>{loadError}</Text>
        <TouchableOpacity style={{ backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 32, paddingVertical: 14 }} onPress={() => loadAll()}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
    >
      {!!alertMsg.text && (
        <View style={[styles.alertBanner, alertMsg.type === 'error' ? styles.alertError : styles.alertSuccess]}>
          <Text style={styles.alertText}>{alertMsg.text}</Text>
        </View>
      )}

      {/* Hero */}
      <View style={styles.heroSection}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>Razorpay Payments</Text>
        </View>
        <Text style={styles.heroTitle}>Payment History</Text>
        <Text style={styles.heroSub}>All Razorpay payments made for your child's meal plans and tuckshop wallet.</Text>
      </View>

      {/* Child Selector */}
      {children.length > 1 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Select Child</Text>
          {children.map((child) => (
            <TouchableOpacity
              key={child.id}
              style={[styles.childItem, selectedChild?.id === child.id && styles.childItemActive]}
              onPress={() => setSelectedChildId(child.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.childName, selectedChild?.id === child.id && styles.childNameActive]}>
                {child.student_name}
              </Text>
              <Text style={styles.childMeta}>{child.grade || 'Grade N/A'} • {child.division || 'N/A'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Payments list */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Razorpay Transactions</Text>
        <Text style={styles.cardSub}>
          For {selectedChild?.student_name || 'your child'}
        </Text>

        {payments.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No Razorpay payment records found.</Text>
          </View>
        ) : (
          payments.map((p) => (
            <View key={p.id} style={styles.paymentRow}>
              {/* Header row */}
              <View style={styles.paymentHeader}>
                <View style={[
                  styles.typePill,
                  p.payment_for === 'TuckShop' ? styles.typeTuckshop : styles.typeCanteen,
                ]}>
                  <Text style={styles.typePillText}>
                    {p.payment_for === 'TuckShop' ? '🛒 TuckShop' : '🍽 Meal Plan'}
                  </Text>
                </View>
                <View style={[styles.statusPill, p.payment_status === 'Completed' ? styles.statusCompleted : styles.statusPending]}>
                  <Text style={styles.statusText}>{p.payment_status || 'Completed'}</Text>
                </View>
              </View>

              {/* Meal/plan info */}
              {!!p.meal_type_name && (
                <Text style={styles.payMealName}>{p.meal_type_name}</Text>
              )}
              {!!p.payment_months && p.payment_months !== '[]' && (
                <Text style={styles.payMeta}>Months: {JSON.parse(p.payment_months || '[]').join(', ')} / {p.payment_year}</Text>
              )}

              {/* Amounts */}
              <View style={styles.amountRow}>
                <View>
                  <Text style={styles.amountLabel}>Sub Total</Text>
                  <Text style={styles.amountValue}>₹{parseFloat(p.sub_total || 0).toFixed(2)}</Text>
                </View>
                <View>
                  <Text style={styles.amountLabel}>Fee</Text>
                  <Text style={styles.amountValue}>₹{parseFloat(p.convenience_fee || 0).toFixed(2)}</Text>
                </View>
                <View>
                  <Text style={styles.amountLabel}>Total Paid</Text>
                  <Text style={[styles.amountValue, styles.amountTotal]}>₹{parseFloat(p.total_paid || 0).toFixed(2)}</Text>
                </View>
              </View>

              {/* Razorpay IDs */}
              <View style={styles.idBox}>
                <Text style={styles.idLabel}>Payment ID</Text>
                <Text style={styles.idValue} selectable>{p.razorpay_payment_id || '—'}</Text>
                <Text style={[styles.idLabel, { marginTop: 4 }]}>Order ID</Text>
                <Text style={styles.idValue} selectable>{p.razorpay_order_id || '—'}</Text>
              </View>

              <Text style={styles.payDate}>{formatDate(p.created_at)}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  contentContainer: { padding: 20, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText: { marginTop: 12, color: COLORS.textMuted, fontSize: 15, fontWeight: '500' },
  alertBanner: { padding: 14, borderRadius: 12, marginBottom: 16 },
  alertError: { backgroundColor: COLORS.dangerLight },
  alertSuccess: { backgroundColor: COLORS.successLight },
  alertText: { color: COLORS.text, fontWeight: '600', fontSize: 14 },

  heroSection: { marginBottom: 24, paddingVertical: 12, paddingHorizontal: 4 },
  chip: { backgroundColor: COLORS.primaryLight, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginBottom: 12 },
  chipText: { color: COLORS.primaryDark, fontWeight: '800', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroTitle: { fontSize: 24, fontWeight: '800', color: COLORS.text, marginBottom: 6, letterSpacing: -0.3 },
  heroSub: { fontSize: 15, color: COLORS.textMuted, lineHeight: 22 },

  card: {
    backgroundColor: COLORS.surface, borderRadius: 24, padding: 24,
    marginBottom: 20, shadowColor: '#64748B', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06, shadowRadius: 24, elevation: 6,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, marginBottom: 4, letterSpacing: -0.2 },
  cardSub: { fontSize: 14, color: COLORS.textMuted, marginBottom: 16 },

  childItem: { padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border, marginBottom: 10, backgroundColor: COLORS.surface },
  childItemActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  childName: { fontWeight: '800', fontSize: 16, color: COLORS.text },
  childNameActive: { color: COLORS.primary },
  childMeta: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },
  emptyBox: { alignItems: 'center', padding: 32 },
  emptyText: { color: COLORS.textMuted, fontSize: 15, textAlign: 'center', lineHeight: 22 },

  paymentRow: {
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 16,
    padding: 16, marginBottom: 14, backgroundColor: COLORS.surface,
  },
  paymentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  typePill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  typeTuckshop: { backgroundColor: COLORS.warningLight },
  typeCanteen: { backgroundColor: '#E0F2FE' },
  typePillText: { fontSize: 12, fontWeight: '800', color: COLORS.text },
  statusPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  statusCompleted: { backgroundColor: COLORS.successLight },
  statusPending: { backgroundColor: COLORS.dangerLight },
  statusText: { fontSize: 12, fontWeight: '800', color: COLORS.success },

  payMealName: { fontSize: 16, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  payMeta: { fontSize: 13, color: COLORS.textMuted, marginBottom: 10 },

  amountRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#F8FAFC', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: COLORS.border },
  amountLabel: { fontSize: 12, color: COLORS.textMuted, marginBottom: 4, fontWeight: '600' },
  amountValue: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  amountTotal: { color: COLORS.primary, fontSize: 16 },

  idBox: { backgroundColor: '#F1F5F9', borderRadius: 10, padding: 12, marginBottom: 12 },
  idLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  idValue: { fontSize: 13, color: COLORS.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 4 },

  payDate: { fontSize: 12, color: COLORS.textLight, textAlign: 'right', fontWeight: '500' },
});
