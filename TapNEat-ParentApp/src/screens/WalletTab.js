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
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../utils/api';
import { getItem } from '../utils/storage';
import { COLORS, RAZORPAY_KEY, CONVENIENCE_RATE } from '../constants';
import RazorpayWebView from '../components/RazorpayWebView';

export default function WalletTab({ parentEmail }) {
  const [profile, setProfile] = useState(null);
  const [children, setChildren] = useState([]);
  const [schoolName, setSchoolName] = useState('');
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

  // Register child modal state
  const [registerVisible, setRegisterVisible] = useState(false);
  const [regName, setRegName] = useState('');
  const [regStudentId, setRegStudentId] = useState('');
  const [regGrade, setRegGrade] = useState('');
  const [regDivision, setRegDivision] = useState('');
  const [regError, setRegError] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [schoolCode, setSchoolCode] = useState('');

  const showAlert = (text, type = 'success') => {
    setAlertMsg({ type, text });
    setTimeout(() => setAlertMsg({ type: '', text: '' }), 4000);
  };

  const resetRegisterForm = () => {
    setRegName('');
    setRegStudentId('');
    setRegGrade('');
    setRegDivision('');
    setSchoolCode('');
    setRegError('');
  };

  const handleRegisterChild = async () => {
    if (!regName.trim() || !regStudentId.trim() || !regGrade.trim() || !regDivision.trim()) {
      setRegError('Please fill all required fields.');
      return;
    }
    if (!parentEmail) {
      setRegError('Parent email missing. Please sign in again.');
      return;
    }

    setRegLoading(true);
    setRegError('');
    const { ok, data } = await api('parent-portal?action=register-child', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'register-child',
        email: parentEmail,
        student_name: regName.trim(),
        student_id: regStudentId.trim(),
        grade: regGrade.trim(),
        division: regDivision.trim(),
        school_code: schoolCode.trim() || undefined,
      }),
    });

    if (!ok) {
      setRegError(data.error || 'Failed to register child');
      setRegLoading(false);
      return;
    }

    setRegLoading(false);
    setRegisterVisible(false);
    resetRegisterForm();
    showAlert('Child registered successfully. RFID will be assigned by the school.', 'success');
    await loadProfile();
  };

  // Format a MySQL DATE/DATETIME value (may come as ISO string or Date object)
  const formatDate = (d) => {
    if (!d) return '—';
    const str = String(d);
    const datePart = str.includes('T') ? str.split('T')[0] : str.split(' ')[0];
    const parts = datePart.split('-');
    if (parts.length !== 3) return str;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${parts[2]} ${months[parseInt(parts[1], 10) - 1]} ${parts[0]}`;
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
      setSchoolName(data.school?.name || '');
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
    getItem('parentSchoolCode').then((v) => setSchoolCode(v || ''));
  }, []);

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
        {!!schoolName && (
          <Text style={styles.schoolName}>School: {schoolName}</Text>
        )}
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

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.registerBtn}
            onPress={() => { setRegisterVisible(true); setRegError(''); }}
            activeOpacity={0.85}
          >
            <Text style={styles.registerBtnText}>Register Child</Text>
          </TouchableOpacity>
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
                      {formatDate(item.transaction_date)}{'\n'}
                      <Text style={{ color: COLORS.textLight, fontSize: 10 }}>
                        {item.transaction_time ? String(item.transaction_time).slice(0, 5) : ''}
                      </Text>
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

    <Modal
      visible={registerVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setRegisterVisible(false)}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Register Child</Text>
            <TouchableOpacity
              onPress={() => setRegisterVisible(false)}
              style={styles.modalClose}
              activeOpacity={0.7}
            >
              <Text style={styles.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalSub}>
            Enter your child's school details. RFID will be assigned by the school admin.
          </Text>



          <Text style={styles.modalLabel}>Student Full Name *</Text>
          <TextInput
            style={styles.modalInput}
            value={regName}
            onChangeText={setRegName}
            placeholder="Child name"
            placeholderTextColor={COLORS.textMuted}
          />

          <Text style={styles.modalLabel}>Admission ID *</Text>
          <TextInput
            style={styles.modalInput}
            value={regStudentId}
            onChangeText={setRegStudentId}
            placeholder="Admission ID"
            placeholderTextColor={COLORS.textMuted}
          />

          <View style={styles.modalRow}>
            <View style={styles.modalHalf}>
              <Text style={styles.modalLabel}>Grade *</Text>
              <TextInput
                style={styles.modalInput}
                value={regGrade}
                onChangeText={setRegGrade}
                placeholder="e.g. 5"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>
            <View style={styles.modalHalf}>
              <Text style={styles.modalLabel}>Division *</Text>
              <TextInput
                style={styles.modalInput}
                value={regDivision}
                onChangeText={setRegDivision}
                placeholder="e.g. A"
                placeholderTextColor={COLORS.textMuted}
              />
            </View>
          </View>

          {!!regError && (
            <View style={styles.modalErrorBox}>
              <Text style={styles.modalErrorText}>{regError}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.modalPrimaryBtn, regLoading && styles.modalPrimaryBtnDisabled]}
            onPress={handleRegisterChild}
            disabled={regLoading}
            activeOpacity={0.85}
          >
            {regLoading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.modalPrimaryBtnText}>Register Child</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

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
  contentContainer: { padding: 20, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText: { marginTop: 12, color: COLORS.textMuted, fontSize: 15, fontWeight: '500' },
  errorIcon: { fontSize: 48, marginBottom: 16 },
  errorTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: 8 },
  errorMsg: { fontSize: 15, color: COLORS.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  retryBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 36, paddingVertical: 16, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  retryBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 16 },

  alertBanner: { borderRadius: 12, padding: 14, marginBottom: 16 },
  alertSuccess: { backgroundColor: COLORS.successLight },
  alertError: { backgroundColor: COLORS.dangerLight },
  alertText: { fontSize: 14, fontWeight: '600', color: COLORS.text },

  heroSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primaryLight,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 12,
  },
  chipText: { color: COLORS.primaryDark, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  heroTitle: { fontSize: 22, fontWeight: '800', color: COLORS.text, marginBottom: 6, letterSpacing: -0.3 },
  schoolName: { fontSize: 13, color: COLORS.textMuted, marginBottom: 6, fontWeight: '700' },
  heroSub: { fontSize: 14, color: COLORS.textMuted, lineHeight: 20 },
  summaryCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryLabel: { fontSize: 14, color: COLORS.textMuted, fontWeight: '600' },
  summaryValue: { fontSize: 24, fontWeight: '800', color: COLORS.primary },

  actionRow: { alignItems: 'flex-end', marginBottom: 12 },
  registerBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  registerBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 5,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, marginBottom: 4, letterSpacing: -0.2 },
  cardSub: { fontSize: 14, color: COLORS.textMuted, marginBottom: 16 },

  emptyBox: { padding: 40, alignItems: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: 15, textAlign: 'center', marginTop: 12, lineHeight: 22 },

  childItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    marginBottom: 10,
    backgroundColor: COLORS.surface,
  },
  childItemActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  childInfo: { flex: 1 },
  childName: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  childMeta: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },
  walletPill: {
    backgroundColor: '#F8FAFC',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  walletPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  walletPillText: { color: COLORS.text, fontWeight: '800', fontSize: 14 },
  walletPillTextActive: { color: '#ffffff' },

  statsRow: { flexDirection: 'row', marginBottom: 20 },
  statBox: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statLabel: { fontSize: 12, color: COLORS.textMuted, marginBottom: 8, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  statValueBig: { fontSize: 26, fontWeight: '800', color: COLORS.primary, letterSpacing: -0.5 },

  rechargeInfo: {
    backgroundColor: COLORS.primaryLight,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
  },
  rechargeInfoText: { fontSize: 14, color: COLORS.primaryDark, lineHeight: 20 },

  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  th: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  td: { fontSize: 13, color: COLORS.text, fontWeight: '500' },
  typeBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  typeBadgeCredit: { backgroundColor: COLORS.successLight },
  typeBadgeDebit: { backgroundColor: COLORS.dangerLight },
  typeBadgeText: { fontSize: 11, fontWeight: '800' },
  typeBadgeTextCredit: { color: COLORS.primaryDark },
  typeBadgeTextDebit: { color: COLORS.danger },

  loadMoreBtn: {
    marginTop: 16, paddingVertical: 14, alignItems: 'center',
    backgroundColor: '#F8FAFC', borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  loadMoreText: { fontSize: 14, fontWeight: '800', color: COLORS.textMuted },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: COLORS.text, letterSpacing: -0.3 },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: { fontSize: 22, fontWeight: '700', color: COLORS.textMuted },
  modalSub: { fontSize: 14, color: COLORS.textMuted, marginBottom: 20, lineHeight: 20 },
  modalLabel: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  modalInput: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
    backgroundColor: '#F8FAFC',
    marginBottom: 16,
  },
  modalRow: { flexDirection: 'row', gap: 12 },
  modalHalf: { flex: 1 },
  modalErrorBox: {
    backgroundColor: COLORS.dangerLight,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  modalErrorText: { color: COLORS.danger, fontSize: 13, fontWeight: '700' },
  modalPrimaryBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  modalPrimaryBtnDisabled: { opacity: 0.5 },
  modalPrimaryBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },

  tuckshopRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  tuckshopInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8FAFC', borderRadius: 12,
    borderWidth: 1.5, borderColor: COLORS.border,
    paddingHorizontal: 16, height: 52,
  },
  tuckshopCurrency: { fontSize: 18, fontWeight: '800', color: COLORS.textMuted, marginRight: 8 },
  tuckshopInput: { flex: 1, fontSize: 18, color: COLORS.text, fontWeight: '600' },
  tuckshopBtn: {
    backgroundColor: COLORS.primary, paddingHorizontal: 20, height: 52,
    borderRadius: 12, justifyContent: 'center', alignItems: 'center',
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  tuckshopBtnDisabled: { backgroundColor: '#94A3B8', shadowOpacity: 0, elevation: 0 },
  tuckshopBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 15 },
  tuckshopFeeRow: {
    backgroundColor: '#F1F5F9', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: COLORS.border,
    marginTop: 8,
  },
  tuckshopFeeText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '600' },
});
