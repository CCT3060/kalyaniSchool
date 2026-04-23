import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../utils/api';
import { COLORS, RAZORPAY_KEY, CONVENIENCE_RATE } from '../constants';
import RazorpayWebView from '../components/RazorpayWebView';

export default function WalletTab({ parentEmail }) {
  const [profile, setProfile] = useState(null);
  const [children, setChildren] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [txLoading, setTxLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [alertMsg, setAlertMsg] = useState({ type: '', text: '' });
  const [showAllTx, setShowAllTx] = useState(false);

  // Tuckshop recharge state
  const [tuckshopAmount, setTuckshopAmount] = useState('');
  const [tuckshopLoading, setTuckshopLoading] = useState(false);
  const [rzpKey, setRzpKey] = useState(RAZORPAY_KEY);
  const [razorpayVisible, setRazorpayVisible] = useState(false);
  const [razorpayOptions, setRazorpayOptions] = useState(null);
  const [pendingVerifyPayload, setPendingVerifyPayload] = useState(null);

  const showAlert = (text, type = 'success') => {
    setAlertMsg({ type, text });
    setTimeout(() => setAlertMsg({ type: '', text: '' }), 4000);
  };

  const selectedChild = children.find((c) => c.id === selectedChildId) || null;

  const loadProfile = useCallback(async () => {
    if (!parentEmail) return;
    setLoading(true);
    setLoadError('');
    const { ok, data } = await api(
      `parent-portal?action=profile&email=${encodeURIComponent(parentEmail)}`
    );
    if (ok && data.children) {
      setProfile(data.parent || {});
      setChildren(data.children || []);
      if (data.children.length > 0 && !selectedChildId) {
        setSelectedChildId(data.children[0].id);
      }
    } else if (!ok) {
      setLoadError(data.error || 'Could not connect to server. Please check your connection and try again.');
    }
    setLoading(false);
  }, [parentEmail, selectedChildId]);

  const loadTransactions = useCallback(async (childId) => {
    if (!childId || !parentEmail) return;
    setTxLoading(true);
    const { ok, data } = await api(
      `parent-portal?action=transactions&email=${encodeURIComponent(parentEmail)}&student_id=${childId}`
    );
    if (ok) {
      setTransactions(data.transactions || []);
    }
    setTxLoading(false);
  }, [parentEmail]);

  useEffect(() => {
    api('razorpay-config').then(({ ok, data }) => { if (ok && data.key_id) setRzpKey(data.key_id); });
  }, []);

  /* ── Tuckshop recharge via Razorpay ── */
  const handleTuckshopRecharge = async () => {
    const amount = parseFloat(tuckshopAmount);
    if (!selectedChild) { showAlert('Please select a child first', 'error'); return; }
    if (!amount || amount <= 0) { showAlert('Please enter a valid amount', 'error'); return; }

    setTuckshopLoading(true);
    const fee   = Math.round(amount * CONVENIENCE_RATE * 100) / 100;
    const total = parseFloat((amount + fee).toFixed(2));
    const paise = Math.round(total * 100);

    const { ok, data: orderData } = await api('razorpay-create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: paise,
        currency: 'INR',
        receipt: `TUCK-${selectedChild.id}-${Date.now()}`,
        notes: {
          student_id: String(selectedChild.id),
          student_name: selectedChild.student_name,
          meal_plan: 'TuckShop',
          payment_for: 'TuckShop',
          year: String(new Date().getFullYear()),
        },
      }),
    });

    if (!ok) {
      showAlert(orderData.message || 'Failed to create payment order', 'error');
      setTuckshopLoading(false);
      return;
    }

    setPendingVerifyPayload({
      student_id: selectedChild.id,
      email: parentEmail,
      amount_paid: total,
      sub_total: amount,
      meal_type_id: 0,
      meal_type_name: 'TuckShop',
      months: [],
      year: new Date().getFullYear(),
      payment_for: 'TuckShop',
    });
    setRazorpayOptions({
      key: rzpKey,
      amount: paise,
      currency: 'INR',
      name: 'Tap-N-Eat',
      description: `TuckShop Wallet Top-Up \u20b9${amount.toFixed(2)}`,
      order_id: orderData.id,
      prefill: { email: parentEmail },
      theme: { color: '#00b894' },
    });
    setRazorpayVisible(true);
    setTuckshopLoading(false);
  };

  const handleTuckshopSuccess = async (response) => {
    setRazorpayVisible(false);
    if (!pendingVerifyPayload) return;
    setTuckshopLoading(true);
    const { ok, data } = await api('wallet-recharge-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id:   response.razorpay_order_id,
        razorpay_signature:  response.razorpay_signature,
        ...pendingVerifyPayload,
      }),
    });
    if (ok && data.verified) {
      showAlert(`\u20b9${pendingVerifyPayload.sub_total.toFixed(2)} credited to ${selectedChild?.student_name}'s wallet!`, 'success');
      setTuckshopAmount('');
      await loadProfile();
      if (selectedChildId) { setShowAllTx(false); loadTransactions(selectedChildId); }
    } else {
      showAlert(data.message || 'Payment verification failed', 'error');
    }
    setPendingVerifyPayload(null);
    setTuckshopLoading(false);
  };

  useEffect(() => {
    loadProfile();
  }, [parentEmail]);

  useEffect(() => {
    if (selectedChildId) loadTransactions(selectedChildId);
  }, [selectedChildId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadProfile();
    if (selectedChildId) await loadTransactions(selectedChildId);
    setRefreshing(false);
  };

  // Wallet balance view + tuckshop recharge option

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading profile…</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorTitle}>Connection Error</Text>
        <Text style={styles.errorMsg}>{loadError}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={loadProfile}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const INITIAL_TX = 5;
  const visibleTx  = showAllTx ? transactions : transactions.slice(0, INITIAL_TX);

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
    >
      {/* Alert Banner */}
      {!!alertMsg.text && (
        <View style={[styles.alertBanner, alertMsg.type === 'error' ? styles.alertError : styles.alertSuccess]}>
          <Text style={styles.alertText}>{alertMsg.text}</Text>
        </View>
      )}

      {/* Hero */}
      <View style={styles.heroSection}>
        <View style={styles.chip}>
          <Text style={styles.chipText}>Wallet</Text>
        </View>
        <Text style={styles.heroTitle}>Track and recharge your child wallet</Text>
        <Text style={styles.heroSub}>
          See current balances, linked school details, and recent meal transactions.
        </Text>
        {profile && (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Linked children</Text>
            <Text style={styles.summaryValue}>{children.length}</Text>
          </View>
        )}
      </View>

      {children.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No children are linked to this parent email yet.</Text>
        </View>
      ) : (
        <>
          {/* Children List */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your Children</Text>
            <Text style={styles.cardSub}>Select a child to see wallet details and history</Text>
            {children.map((child) => (
              <TouchableOpacity
                key={child.id}
                style={[styles.childItem, selectedChild?.id === child.id && styles.childItemActive]}
                onPress={() => setSelectedChildId(child.id)}
                activeOpacity={0.7}
              >
                <View style={styles.childInfo}>
                  <Text style={styles.childName}>{child.student_name}</Text>
                  <Text style={styles.childMeta}>
                    {child.grade || 'Grade N/A'} • {child.division || 'Division N/A'}
                  </Text>
                </View>
                <View style={[
                  styles.walletPill,
                  selectedChild?.id === child.id && styles.walletPillActive,
                ]}>
                  <Text style={[
                    styles.walletPillText,
                    selectedChild?.id === child.id && styles.walletPillTextActive,
                  ]}>
                    ₹{Number(child.wallet_amount || 0).toFixed(2)}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Child Details */}
          {selectedChild && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{selectedChild.student_name}</Text>
              <Text style={styles.cardSub}>
                {selectedChild.school_name || 'School not assigned'} • {selectedChild.student_id}
              </Text>

              <View style={styles.statsRow}>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Current Balance</Text>
                  <Text style={[styles.statValue, styles.statValueBig]}>
                    ₹{Number(selectedChild.wallet_amount || 0).toFixed(2)}
                  </Text>
                </View>
                <View style={[styles.statBox, { marginLeft: 12 }]}>
                  <Text style={styles.statLabel}>RFID Card</Text>
                  <Text style={styles.statValue}>{selectedChild.rfid_number || '—'}</Text>
                </View>
              </View>
              <View style={styles.rechargeInfo}>
                <Text style={styles.rechargeInfoText}>
                  💡 To pay for <Text style={{ fontWeight: '800' }}>Meal Plan</Text> subscription, go to the Meal Plans tab.
                </Text>
              </View>
            </View>
          )}

          {/* Tuckshop Wallet Recharge */}
          {selectedChild && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🛒 TuckShop Wallet Recharge</Text>
              <Text style={styles.cardSub}>Top up {selectedChild.student_name}'s wallet for tuckshop purchases</Text>
              <View style={styles.tuckshopRow}>
                <View style={styles.tuckshopInputWrap}>
                  <Text style={styles.tuckshopCurrency}>₹</Text>
                  <TextInput
                    style={styles.tuckshopInput}
                    placeholder="Enter amount"
                    placeholderTextColor={COLORS.textMuted}
                    keyboardType="decimal-pad"
                    value={tuckshopAmount}
                    onChangeText={setTuckshopAmount}
                    returnKeyType="done"
                  />
                </View>
                <TouchableOpacity
                  style={[styles.tuckshopBtn, (tuckshopLoading || !tuckshopAmount) && styles.tuckshopBtnDisabled]}
                  onPress={handleTuckshopRecharge}
                  disabled={tuckshopLoading || !tuckshopAmount}
                  activeOpacity={0.85}
                >
                  {tuckshopLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.tuckshopBtnText}>Pay via Razorpay</Text>
                  }
                </TouchableOpacity>
              </View>
              {!!tuckshopAmount && parseFloat(tuckshopAmount) > 0 && (
                <View style={styles.tuckshopFeeRow}>
                  <Text style={styles.tuckshopFeeText}>
                    Subtotal ₹{parseFloat(tuckshopAmount).toFixed(2)}{'  '}
                    + 2% fee ₹{(parseFloat(tuckshopAmount) * 0.02).toFixed(2)}{'  '}
                    = Total ₹{(parseFloat(tuckshopAmount) * 1.02).toFixed(2)}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Transactions */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Recent Transactions</Text>
            <Text style={styles.cardSub}>Latest wallet recharges and meal deductions</Text>

            {txLoading ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginTop: 16 }} />
            ) : transactions.length === 0 ? (
              <Text style={styles.emptyText}>No transactions found for this child.</Text>
            ) : (
              <>
                {/* Table Header */}
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, { flex: 2 }]}>Date</Text>
                  <Text style={[styles.th, { flex: 1 }]}>Type</Text>
                  <Text style={[styles.th, { flex: 1.2 }]}>Category</Text>
                  <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>Amt</Text>
                  <Text style={[styles.th, { flex: 1, textAlign: 'right' }]}>Bal</Text>
                </View>
                {visibleTx.map((item) => (
                  <View key={item.id} style={styles.tableRow}>
                    <Text style={[styles.td, { flex: 2 }]} numberOfLines={2}>
                      {item.transaction_date}{'\n'}
                      <Text style={{ color: COLORS.textLight, fontSize: 10 }}>{item.transaction_time}</Text>
                    </Text>
                    <View style={{ flex: 1, justifyContent: 'center' }}>
                      <View style={[
                        styles.typeBadge,
                        (item.transaction_type === 'recharge' || item.transaction_type === 'meal_subscription' || item.transaction_type === 'canteen') ? styles.typeBadgeCredit : styles.typeBadgeDebit,
                      ]}>
                        <Text style={[
                          styles.typeBadgeText,
                          (item.transaction_type === 'recharge' || item.transaction_type === 'meal_subscription' || item.transaction_type === 'canteen') ? styles.typeBadgeTextCredit : styles.typeBadgeTextDebit,
                        ]}>
                          {item.transaction_type === 'recharge'
                            ? ((item.meal_category || '').toLowerCase().includes('tuckshop') ? 'TuckShop' : 'Credit')
                            : item.transaction_type === 'meal_subscription'
                            ? 'Meal Plan'
                            : item.transaction_type === 'tuckshop'
                            ? 'Tuckshop'
                            : item.transaction_type === 'canteen'
                            ? 'Canteen'
                            : item.transaction_type === 'canteen_denied'
                            ? '⛔ Denied'
                            : 'Deduction'}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.td, { flex: 1.2 }]} numberOfLines={1}>
                      {item.meal_category || 'Wallet'}
                    </Text>
                    <Text style={[styles.td, { flex: 1, textAlign: 'right' }]}>
                      ₹{Number(item.amount || 0).toFixed(2)}
                    </Text>
                    <Text style={[styles.td, { flex: 1, textAlign: 'right' }]}>
                      ₹{Number(item.new_balance || 0).toFixed(2)}
                    </Text>
                  </View>
                ))}
                {transactions.length > INITIAL_TX && (
                  <TouchableOpacity
                    style={styles.loadMoreBtn}
                    onPress={() => setShowAllTx((v) => !v)}
                  >
                    <Text style={styles.loadMoreText}>
                      {showAllTx
                        ? 'Show Less ▲'
                        : `Show All ${transactions.length} Transactions ▼`}
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </>
      )}
    </ScrollView>

    {razorpayOptions && (
      <RazorpayWebView
        visible={razorpayVisible}
        options={razorpayOptions}
        onSuccess={handleTuckshopSuccess}
        onDismiss={() => { setRazorpayVisible(false); setTuckshopLoading(false); }}
        onFailed={(err) => {
          setRazorpayVisible(false);
          showAlert(`Payment failed: ${err?.description || 'Unknown error'}`, 'error');
          setTuckshopLoading(false);
        }}
      />
    )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  contentContainer: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText: { marginTop: 12, color: COLORS.textMuted, fontSize: 14 },
  errorIcon: { fontSize: 48, marginBottom: 12 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  errorMsg: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  retryBtn: { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 32, paddingVertical: 14 },
  retryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  alertBanner: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  alertSuccess: { backgroundColor: COLORS.successLight },
  alertError: { backgroundColor: COLORS.dangerLight },
  alertText: { fontSize: 13, fontWeight: '600', color: COLORS.text },

  heroSection: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 10,
  },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  heroTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: 6 },
  heroSub: { fontSize: 13, color: COLORS.textMuted, lineHeight: 18 },
  summaryCard: {
    backgroundColor: COLORS.background,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: { fontSize: 13, color: COLORS.textMuted },
  summaryValue: { fontSize: 22, fontWeight: '800', color: COLORS.primary },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  cardSub: { fontSize: 12, color: COLORS.textMuted, marginBottom: 12 },

  emptyBox: { padding: 32, alignItems: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center', marginTop: 8 },

  childItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  childItemActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#f0fdf4',
  },
  childInfo: { flex: 1 },
  childName: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  childMeta: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  walletPill: {
    backgroundColor: COLORS.background,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  walletPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  walletPillText: { color: COLORS.text, fontWeight: '700', fontSize: 13 },
  walletPillTextActive: { color: '#fff' },

  statsRow: { flexDirection: 'row', marginBottom: 16 },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statLabel: { fontSize: 11, color: COLORS.textMuted, marginBottom: 6, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  statValueBig: { fontSize: 24, fontWeight: '800', color: COLORS.primary },

  rechargeInfo: {
    backgroundColor: '#f0fdf4',
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  rechargeInfoText: { fontSize: 13, color: '#15803d', lineHeight: 18 },

  tableHeader: {
    flexDirection: 'row',
    backgroundColor: COLORS.background,
    borderRadius: 8,
    padding: 8,
    marginBottom: 4,
  },
  th: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  td: { fontSize: 12, color: COLORS.text },
  typeBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  typeBadgeCredit: { backgroundColor: COLORS.successLight },
  typeBadgeDebit: { backgroundColor: COLORS.dangerLight },
  typeBadgeText: { fontSize: 10, fontWeight: '700' },
  typeBadgeTextCredit: { color: COLORS.primary },
  typeBadgeTextDebit: { color: COLORS.danger },

  loadMoreBtn: {
    marginTop: 10, paddingVertical: 10, alignItems: 'center',
    backgroundColor: COLORS.background, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  loadMoreText: { fontSize: 13, fontWeight: '700', color: COLORS.primary },

  tuckshopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  tuckshopInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.background, borderRadius: 10,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 12, height: 46,
  },
  tuckshopCurrency: { fontSize: 18, fontWeight: '700', color: COLORS.text, marginRight: 4 },
  tuckshopInput: { flex: 1, fontSize: 16, color: COLORS.text },
  tuckshopBtn: {
    backgroundColor: COLORS.primary, paddingHorizontal: 16, height: 46,
    borderRadius: 10, justifyContent: 'center', alignItems: 'center',
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
  },
  tuckshopBtnDisabled: { backgroundColor: '#94a3b8', shadowOpacity: 0 },
  tuckshopBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  tuckshopFeeRow: {
    backgroundColor: '#f0fdf4', borderRadius: 8, padding: 8,
    borderWidth: 1, borderColor: '#bbf7d0',
  },
  tuckshopFeeText: { fontSize: 12, color: '#15803d', fontWeight: '600' },
});
