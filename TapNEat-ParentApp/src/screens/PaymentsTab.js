import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { api } from '../utils/api';
import { COLORS, RAZORPAY_KEY, CONVENIENCE_RATE } from '../constants';
import RazorpayWebView from '../components/RazorpayWebView';

export default function PaymentsTab({ parentEmail, parentName }) {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paySelectedChildId, setPaySelectedChildId] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [alertMsg, setAlertMsg] = useState({ type: '', text: '' });
  const [razorpayVisible, setRazorpayVisible] = useState(false);
  const [razorpayOptions, setRazorpayOptions] = useState(null);
  const [pendingVerifyPayload, setPendingVerifyPayload] = useState(null);
  const [rzpKey, setRzpKey] = useState(RAZORPAY_KEY);
  const [tuckshopAmount, setTuckshopAmount] = useState('');

  const payYear = new Date().getFullYear();
  const paymentDate = (() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-GB', { month: 'short' })}-${d.getFullYear()}`;
  })();
  const paySelectedChild = children.find((c) => String(c.id) === String(paySelectedChildId)) || null;
  const tuckshopAmt = parseFloat(tuckshopAmount) || 0;
  const subTotal = tuckshopAmt;
  const convenienceFee = subTotal * CONVENIENCE_RATE;
  const totalPrice = subTotal + convenienceFee;

  const showAlert = (text, type = 'success') => {
    setAlertMsg({ type, text });
    setTimeout(() => setAlertMsg({ type: '', text: '' }), 5000);
  };

  const loadChildren = useCallback(async () => {
    if (!parentEmail) return;
    const { ok, data } = await api(
      `parent-portal?action=profile&email=${encodeURIComponent(parentEmail)}`
    );
    if (ok && data.children) setChildren(data.children);
    setLoading(false);
  }, [parentEmail]);

  useEffect(() => { loadChildren(); }, [parentEmail]);
  useEffect(() => {
    api('razorpay-config').then(({ ok, data }) => { if (ok && data.key_id) setRzpKey(data.key_id); });
  }, []);

  const handlePayWithRazorpay = async () => {
    if (!paySelectedChild) { showAlert('Please select a student', 'error'); return; }
    if (tuckshopAmt <= 0) { showAlert('Please enter a valid top-up amount', 'error'); return; }
    if (totalPrice <= 0) { showAlert('Total amount must be greater than 0', 'error'); return; }

    setPaymentLoading(true);
    const amountPaise = Math.round(totalPrice * 100);

    const { ok, data: orderData } = await api('razorpay-create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: `TUCK-${paySelectedChild.student_id}-${Date.now()}`,
        notes: {
          student_id: String(paySelectedChild.id),
          student_name: paySelectedChild.student_name,
          meal_plan: 'TuckShop',
          payment_for: 'TuckShop',
          year: String(payYear),
        },
      }),
    });

    if (!ok) {
      showAlert(orderData.message || 'Failed to create payment order', 'error');
      setPaymentLoading(false);
      return;
    }

    const options = {
      key: rzpKey,
      amount: amountPaise,
      currency: 'INR',
      name: 'Tap-N-Eat',
      description: `TuckShop Wallet Top-Up â‚¹${subTotal.toFixed(2)}`,
      order_id: orderData.id,
      prefill: { name: parentName, email: parentEmail },
      theme: { color: '#00b894' },
    };

    setPendingVerifyPayload({
      student_id: paySelectedChild.id,
      email: parentEmail,
      amount_paid: totalPrice,
      sub_total: subTotal,
      meal_type_id: 0,
      meal_type_name: '',
      months: [],
      year: payYear,
      payment_for: 'TuckShop',
    });

    setRazorpayOptions(options);
    setRazorpayVisible(true);
    setPaymentLoading(false);
  };

  const handleRazorpaySuccess = async (response) => {
    setRazorpayVisible(false);
    if (!pendingVerifyPayload) return;

    setPaymentLoading(true);
    const { ok: vOk, data: vData } = await api('wallet-recharge-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id: response.razorpay_order_id,
        razorpay_signature: response.razorpay_signature,
        ...pendingVerifyPayload,
      }),
    });

    if (vOk && vData.verified) {
      showAlert(
        `Payment successful! â‚¹${pendingVerifyPayload.sub_total.toFixed(2)} credited to ${paySelectedChild?.student_name}'s wallet.`,
        'success'
      );
      setTuckshopAmount('');
      await loadChildren();
    } else {
      showAlert(vData.message || 'Payment verification failed. Contact support.', 'error');
    }

    setPendingVerifyPayload(null);
    setPaymentLoading(false);
  };

  const handleRazorpayDismiss = () => {
    setRazorpayVisible(false);
    setPaymentLoading(false);
  };

  const handleRazorpayFailed = (err) => {
    setRazorpayVisible(false);
    showAlert(`Payment failed: ${err?.description || err || 'Unknown error'}`, 'error');
    setPaymentLoading(false);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loadingâ€¦</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
      >
        {/* Alert */}
        {!!alertMsg.text && (
          <View style={[styles.alertBanner, alertMsg.type === 'error' ? styles.alertError : styles.alertSuccess]}>
            <Text style={styles.alertText}>{alertMsg.text}</Text>
          </View>
        )}

        {/* Hero */}
        <View style={styles.heroSection}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>TuckShop Wallet</Text>
          </View>
          <Text style={styles.heroTitle}>Top Up Tuckshop Wallet</Text>
          <Text style={styles.heroSub}>
            Select your child, enter the amount, and pay securely via Razorpay. A 2% convenience fee applies.
          </Text>
        </View>

        {children.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No children linked to this account.</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Wallet Top-Up</Text>
            <View style={styles.divider} />

            {/* Student Picker */}
            <Text style={styles.fieldLabel}>Select Student <Text style={styles.req}>*</Text></Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pickerRow}>
              {children.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[
                    styles.optionChip,
                    String(paySelectedChildId) === String(c.id) && styles.optionChipActive,
                  ]}
                  onPress={() => setPaySelectedChildId(String(c.id))}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.optionChipText,
                    String(paySelectedChildId) === String(c.id) && styles.optionChipTextActive,
                  ]}>
                    {c.student_id} â€” {c.student_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Date */}
            <Text style={styles.fieldLabel}>Date</Text>
            <View style={styles.readonlyBox}>
              <Text style={styles.readonlyText}>{paymentDate}</Text>
            </View>

            {/* Name */}
            <Text style={styles.fieldLabel}>Student Name</Text>
            <View style={styles.readonlyBox}>
              <Text style={styles.readonlyText}>{paySelectedChild?.student_name || 'â€”'}</Text>
            </View>

            {/* Parent Name */}
            <Text style={styles.fieldLabel}>Parent Name</Text>
            <View style={styles.readonlyBox}>
              <Text style={styles.readonlyText}>{parentName}</Text>
            </View>

            {/* Amount */}
            <Text style={styles.fieldLabel}>Top-Up Amount (â‚¹) <Text style={styles.req}>*</Text></Text>
            <TextInput
              style={[styles.readonlyBox, { backgroundColor: '#fff' }]}
              value={tuckshopAmount}
              onChangeText={setTuckshopAmount}
              placeholder="Enter top-up amount"
              placeholderTextColor={COLORS.textLight}
              keyboardType="numeric"
            />
            <Text style={styles.hint}>This amount will be credited to the studentâ€™s tuckshop wallet.</Text>

            <View style={styles.divider} />

            {/* Pricing Summary */}
            <View style={styles.pricingRow}>
              <Text style={styles.pricingLabel}>Sub Total</Text>
              <Text style={styles.pricingValue}>â‚¹{subTotal.toFixed(2)}</Text>
            </View>
            <View style={styles.pricingRow}>
              <Text style={styles.pricingLabel}>Convenience Fee (2%)</Text>
              <Text style={styles.pricingValue}>â‚¹{convenienceFee.toFixed(2)}</Text>
            </View>
            <View style={[styles.pricingRow, styles.pricingRowTotal]}>
              <Text style={styles.pricingLabelTotal}>Total Price</Text>
              <Text style={styles.pricingValueTotal}>â‚¹{totalPrice.toFixed(2)}</Text>
            </View>

            {/* Pay Button */}
            <TouchableOpacity
              style={[
                styles.payBtn,
                (paymentLoading || totalPrice <= 0) && styles.payBtnDisabled,
              ]}
              onPress={handlePayWithRazorpay}
              disabled={paymentLoading || totalPrice <= 0}
              activeOpacity={0.85}
            >
              {paymentLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.payBtnText}>
                  Pay â‚¹{totalPrice.toFixed(2)} via Razorpay
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Razorpay WebView Modal */}
      {razorpayOptions && (
        <RazorpayWebView
          visible={razorpayVisible}
          options={razorpayOptions}
          onSuccess={handleRazorpaySuccess}
          onDismiss={handleRazorpayDismiss}
          onFailed={handleRazorpayFailed}
        />
      )}
    </>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  contentContainer: { padding: 20, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  loadingText: { marginTop: 12, color: COLORS.textMuted, fontSize: 15, fontWeight: '500' },

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
  heroTitle: { fontSize: 24, fontWeight: '800', color: COLORS.text, marginBottom: 6, letterSpacing: -0.3 },
  heroSub: { fontSize: 15, color: COLORS.textMuted, lineHeight: 22 },

  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 5,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, marginBottom: 8, letterSpacing: -0.2 },
  divider: { height: 1.5, backgroundColor: COLORS.border, marginVertical: 16 },

  fieldLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
    marginTop: 16,
  },
  req: { color: COLORS.danger },

  pickerRow: { flexGrow: 0, marginBottom: 8 },
  optionChip: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 10,
    backgroundColor: '#F8FAFC',
  },
  optionChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  optionChipText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '600' },
  optionChipTextActive: { color: COLORS.primaryDark, fontWeight: '800' },

  readonlyBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  readonlyText: { color: COLORS.text, fontSize: 15, fontWeight: '500' },

  radioGroup: { flexDirection: 'row', gap: 16, marginTop: 4 },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  radioOptionActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.textLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  radioCircleActive: { borderColor: COLORS.primary },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.primary },
  radioText: { fontSize: 15, color: COLORS.textMuted, fontWeight: '600' },
  radioTextActive: { color: COLORS.primaryDark, fontWeight: '800' },

  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 8,
  },
  monthCell: {
    width: '23%',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  monthCellDisabled: { backgroundColor: '#F8FAFC', opacity: 0.6 },
  monthCellChecked: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  monthName: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  monthNameDisabled: { color: COLORS.textLight },
  monthNameChecked: { color: COLORS.primaryDark },
  monthPrice: { fontSize: 11, color: COLORS.textMuted, marginTop: 4, fontWeight: '500' },
  monthPriceChecked: { color: COLORS.primaryDark },

  hint: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginTop: 10,
    lineHeight: 20,
  },

  pricingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  pricingRowTotal: { borderBottomWidth: 0, marginTop: 8 },
  pricingLabel: { fontSize: 15, color: COLORS.textMuted, fontWeight: '500' },
  pricingValue: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  pricingLabelTotal: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  pricingValueTotal: { fontSize: 24, fontWeight: '800', color: COLORS.primary, letterSpacing: -0.5 },

  payBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 24,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  payBtnDisabled: { backgroundColor: COLORS.textLight, shadowOpacity: 0, elevation: 0 },
  payBtnText: { color: '#ffffff', fontSize: 18, fontWeight: '800' },

  emptyBox: { padding: 40, alignItems: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: 15, textAlign: 'center', lineHeight: 22 },
});
