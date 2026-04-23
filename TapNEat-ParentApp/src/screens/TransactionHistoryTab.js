import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
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
  container: { flex: 1, backgroundColor: '#f8fafc' },
  contentContainer: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText: { marginTop: 12, color: COLORS.textMuted, fontSize: 15 },
  alertBanner: { padding: 12, borderRadius: 10, marginBottom: 12 },
  alertError: { backgroundColor: '#fee2e2' },
  alertSuccess: { backgroundColor: '#d1fae5' },
  alertText: { color: '#1e293b', fontWeight: '600', fontSize: 14 },

  heroSection: { marginBottom: 20, paddingVertical: 16, paddingHorizontal: 4 },
  chip: { backgroundColor: '#ede9fe', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, marginBottom: 10 },
  chipText: { color: '#6d28d9', fontWeight: '700', fontSize: 12 },
  heroTitle: { fontSize: 22, fontWeight: '800', color: '#1e293b', marginBottom: 6 },
  heroSub: { fontSize: 14, color: COLORS.textMuted, lineHeight: 20 },

  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1e293b', marginBottom: 4 },
  cardSub: { fontSize: 13, color: COLORS.textMuted, marginBottom: 14 },

  childItem: { padding: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0', marginBottom: 8 },
  childItemActive: { borderColor: COLORS.primary, backgroundColor: '#f0fdf4' },
  childName: { fontWeight: '700', fontSize: 14, color: '#1e293b' },
  childNameActive: { color: COLORS.primary },
  childMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  emptyBox: { alignItems: 'center', padding: 20 },
  emptyText: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center' },

  paymentRow: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12,
    padding: 14, marginBottom: 12,
  },
  paymentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  typePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  typeTuckshop: { backgroundColor: '#fef3c7' },
  typeCanteen: { backgroundColor: '#e0f2fe' },
  typePillText: { fontSize: 12, fontWeight: '700', color: '#1e293b' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusCompleted: { backgroundColor: '#d1fae5' },
  statusPending: { backgroundColor: '#fee2e2' },
  statusText: { fontSize: 11, fontWeight: '700', color: '#065f46' },

  payMealName: { fontSize: 15, fontWeight: '700', color: '#1e293b', marginBottom: 4 },
  payMeta: { fontSize: 12, color: COLORS.textMuted, marginBottom: 8 },

  amountRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#f8fafc', borderRadius: 10, padding: 10, marginBottom: 10 },
  amountLabel: { fontSize: 11, color: COLORS.textMuted, marginBottom: 2 },
  amountValue: { fontSize: 14, fontWeight: '700', color: '#1e293b' },
  amountTotal: { color: '#16a34a' },

  idBox: { backgroundColor: '#f1f5f9', borderRadius: 8, padding: 10, marginBottom: 8 },
  idLabel: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600', letterSpacing: 0.5 },
  idValue: { fontSize: 12, color: '#1e293b', fontFamily: 'monospace', marginTop: 2 },

  payDate: { fontSize: 11, color: COLORS.textLight, textAlign: 'right' },
});
