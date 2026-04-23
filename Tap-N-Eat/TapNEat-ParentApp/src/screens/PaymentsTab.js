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
  contentContainer: { padding: 16, paddingBottom: 48 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText: { marginTop: 12, color: COLORS.textMuted, fontSize: 14 },

  alertBanner: { borderRadius: 10, padding: 12, marginBottom: 12 },
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
    backgroundColor: COLORS.accent,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 10,
  },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  heroTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: 6 },
  heroSub: { fontSize: 13, color: COLORS.textMuted, lineHeight: 18 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text, marginBottom: 8 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 12 },

  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 6,
    marginTop: 12,
  },
  req: { color: COLORS.danger },

  pickerRow: { flexGrow: 0, marginBottom: 4 },
  optionChip: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    backgroundColor: COLORS.background,
  },
  optionChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#f0fdf4',
  },
  optionChipText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '500' },
  optionChipTextActive: { color: COLORS.primary, fontWeight: '700' },

  readonlyBox: {
    backgroundColor: COLORS.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  readonlyText: { color: COLORS.text, fontSize: 14 },

  radioGroup: { flexDirection: 'row', gap: 16, marginTop: 4 },
  radioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flex: 1,
  },
  radioOptionActive: { borderColor: COLORS.primary, backgroundColor: '#f0fdf4' },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  radioCircleActive: { borderColor: COLORS.primary },
  radioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary },
  radioText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },
  radioTextActive: { color: COLORS.primary, fontWeight: '700' },

  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  monthCell: {
    width: '22%',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  monthCellDisabled: { backgroundColor: COLORS.background, opacity: 0.5 },
  monthCellChecked: { borderColor: COLORS.primary, backgroundColor: '#f0fdf4' },
  monthName: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  monthNameDisabled: { color: COLORS.textLight },
  monthNameChecked: { color: COLORS.primary },
  monthPrice: { fontSize: 10, color: COLORS.textMuted, marginTop: 2 },
  monthPriceChecked: { color: COLORS.primary },

  hint: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginTop: 8,
  },

  pricingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  pricingRowTotal: { borderBottomWidth: 0, marginTop: 4 },
  pricingLabel: { fontSize: 14, color: COLORS.textMuted },
  pricingValue: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  pricingLabelTotal: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  pricingValueTotal: { fontSize: 20, fontWeight: '800', color: COLORS.primary },

  payBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  payBtnDisabled: { opacity: 0.5 },
  payBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  emptyBox: { padding: 32, alignItems: 'center' },
  emptyText: { color: COLORS.textMuted, fontSize: 14, textAlign: 'center' },
});
