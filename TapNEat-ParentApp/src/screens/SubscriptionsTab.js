import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import { api } from '../utils/api';
import { COLORS, MONTH_NAMES, RAZORPAY_KEY, CONVENIENCE_RATE } from '../constants';
import RazorpayWebView from '../components/RazorpayWebView';

export default function SubscriptionsTab({ parentEmail }) {
  const [children, setChildren] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);
  const [canteenLog, setCanteenLog] = useState([]);
  const [availablePlans, setAvailablePlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [subscribeLoading, setSubscribeLoading] = useState(false);
  const [alertMsg, setAlertMsg] = useState({ type: '', text: '' });
  const [razorpayVisible, setRazorpayVisible] = useState(false);
  const [razorpayOptions, setRazorpayOptions] = useState(null);
  const [pendingVerifyPayload, setPendingVerifyPayload] = useState(null);
  const [rzpKey, setRzpKey] = useState(RAZORPAY_KEY);
  // Multi-month modal state
  const [multiModal, setMultiModal] = useState(false);
  const [modalPlanGroup, setModalPlanGroup] = useState([]);
  const [modalSelectedIds, setModalSelectedIds] = useState(new Set());

  const showAlert = (text, type = 'error') => {
    setAlertMsg({ type, text });
    setTimeout(() => setAlertMsg({ type: '', text: '' }), 4000);
  };

  const selectedChild = children.find((c) => c.id === selectedChildId) || null;

  const loadSubscriptions = useCallback(async (childId) => {
    if (!childId || !parentEmail) return;
    const { ok, data } = await api(
      `parent-portal?action=subscriptions&email=${encodeURIComponent(parentEmail)}&student_id=${childId}`
    );
    if (ok) setSubscriptions(data.subscriptions || []);
    else showAlert(data.error || 'Failed to load subscriptions');
  }, [parentEmail]);

  const loadCanteenLog = useCallback(async (childId) => {
    if (!childId || !parentEmail) return;
    const { ok, data } = await api(
      `parent-portal?action=canteen-log&email=${encodeURIComponent(parentEmail)}&student_id=${childId}&limit=30`
    );
    if (ok) setCanteenLog(data.canteen_log || []);
  }, [parentEmail]);

  const loadAvailablePlans = useCallback(async (schoolId, grade) => {
    const curYear = new Date().getFullYear();
    let url = `monthly-meal-plans?year=${curYear}&year_end=${curYear + 1}`;
    if (schoolId) url += `&school_id=${schoolId}`;
    if (grade)    url += `&grade=${encodeURIComponent(grade)}`;
    const { ok, data } = await api(url);
    if (ok && Array.isArray(data?.plans)) {
      const seen = new Set();
      setAvailablePlans(
        data.plans.filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
      );
    } else {
      setAvailablePlans([]);
    }
  }, []);

  const loadAll = useCallback(async (childId) => {
    setLoading(true);
    let loadedChildren = children;
    if (!parentEmail) { setLoading(false); return; }
    const { ok, data } = await api(
      `parent-portal?action=profile&email=${encodeURIComponent(parentEmail)}`
    );
    if (ok && data.children) {
      loadedChildren = data.children || [];
      setChildren(loadedChildren);
      setLoadError('');
      if (loadedChildren.length > 0 && !selectedChildId) {
        setSelectedChildId(loadedChildren[0].id);
      }
    } else if (!ok) {
      setLoadError(data.error || 'Could not connect to server. Please check your connection.');
    }
    const cid = childId || selectedChildId || (loadedChildren[0]?.id);
    if (cid) {
      await loadSubscriptions(cid);
    }
    const child = loadedChildren.find((c) => c.id === cid) || loadedChildren[0];
    await loadAvailablePlans(child?.school_id, child?.grade);
    setLoading(false);
  }, [parentEmail, children, selectedChildId, loadSubscriptions, loadAvailablePlans]);

  useEffect(() => {
    api('razorpay-config').then(({ ok, data }) => { if (ok && data.key_id) setRzpKey(data.key_id); });
  }, []);

  useEffect(() => {
    loadAll();
  }, [parentEmail]);

  useEffect(() => {
    if (selectedChildId) {
      loadSubscriptions(selectedChildId);
      const child = children.find((c) => c.id === selectedChildId);
      loadAvailablePlans(child?.school_id, child?.grade);
    }
  }, [selectedChildId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAll(selectedChildId);
    setRefreshing(false);
  };

  // Group available plans by meal type for display
  const mealTypeGroups = (() => {
    const map = {};
    availablePlans.forEach((p) => {
      if (!map[p.meal_type_id]) map[p.meal_type_id] = { meal_type_id: p.meal_type_id, meal_name: p.meal_name, plans: [] };
      map[p.meal_type_id].plans.push(p);
    });
    return Object.values(map);
  })();

  // Open multi-month selection modal when parent taps Subscribe (group-level).
  // Only shows months from the current month onward, up to 12 months ahead.
  const handleSubscribePlanGroup = (mealTypeId) => {
    if (!selectedChildId) { showAlert('Please select a child first'); return; }

    // Calculate the valid window: current month → 12 months from now
    const now      = new Date();
    const curMonth = now.getMonth() + 1; // 1-indexed
    const curYear  = now.getFullYear();

    const group = availablePlans.filter((p) => {
      if (p.meal_type_id !== mealTypeId) return false;

      // Exclude months the child is already subscribed to
      const alreadySubscribed = subscriptions.some(
        (s) =>
          s.meal_type_id === p.meal_type_id &&
          parseInt(s.month) === parseInt(p.month) &&
          parseInt(s.year)  === parseInt(p.year)  &&
          s.status === 'Active'
      );
      if (alreadySubscribed) return false;

      // Only include months from the current month onward (up to 12 months ahead)
      const planMonth = parseInt(p.month);
      const planYear  = parseInt(p.year);
      const monthsAhead = (planYear - curYear) * 12 + (planMonth - curMonth);
      return monthsAhead >= 0 && monthsAhead < 12;
    });

    if (group.length === 0) { showAlert('All months already subscribed for this plan', 'error'); return; }
    setModalPlanGroup(group);
    setModalSelectedIds(new Set());
    setMultiModal(true);
  };


  const handleConfirmModal = async () => {
    if (modalSelectedIds.size === 0) { showAlert('Please select at least one month'); return; }
    const child = children.find((c) => c.id === selectedChildId);
    if (!child) return;
    const selectedPlans = modalPlanGroup.filter((p) => modalSelectedIds.has(p.id));
    const years = [...new Set(selectedPlans.map((p) => parseInt(p.year)))].sort();
    if (years.length > 1) {
      // Multi-year: process the earliest year first; rest will be handled after success
      showAlert('You selected months across multiple years. Payment will be processed year by year.', 'success');
    }
    // Always process the first (or only) year
    const year = years[0];
    const plansForYear = selectedPlans.filter((p) => parseInt(p.year) === year);
    setMultiModal(false);
    setSubscribeLoading(true);
    const subTotal  = Math.round(plansForYear.reduce((s, p) => s + parseFloat(p.price), 0) * 100) / 100;
    const fee       = Math.round(subTotal * CONVENIENCE_RATE * 100) / 100;
    const total     = subTotal + fee;
    const amtPaise  = Math.round(total * 100);
    const monthNums = plansForYear.map((p) => parseInt(p.month)).sort((a, b) => a - b);
    const monthLabels = monthNums.map((m) => MONTH_NAMES[m - 1]).join(', ');
    const mealTypeId  = plansForYear[0].meal_type_id;
    const mealName    = plansForYear[0].meal_name;
    const { ok, data: orderData } = await api('razorpay-create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amtPaise,
        currency: 'INR',
        receipt: `MEAL-${child.id}-M${monthNums.join('-')}-${Date.now()}`,
        notes: {
          student_id: String(child.id),
          student_name: child.student_name,
          meal_plan: mealName,
          payment_for: 'Canteen',
          months: monthLabels,
          year: String(year),
        },
      }),
    });
    if (!ok) {
      showAlert(orderData.message || 'Failed to create payment order');
      setSubscribeLoading(false);
      return;
    }
    setPendingVerifyPayload({
      student_id: child.id,
      email: parentEmail,
      amount_paid: total,
      sub_total: subTotal,
      meal_type_id: mealTypeId,
      meal_type_name: mealName,
      months: monthNums,
      year,
      payment_for: 'Canteen',
      // Store remaining years for after first payment succeeds
      remainingSelectedIds: years.length > 1
        ? [...modalSelectedIds].filter((pid) => {
            const p = modalPlanGroup.find((x) => x.id === pid);
            return p && parseInt(p.year) !== year;
          })
        : [],
      remainingPlanGroup: modalPlanGroup,
    });
    setRazorpayOptions({
      key: rzpKey,
      amount: amtPaise,
      currency: 'INR',
      name: 'Tap-N-Eat',
      description: `${mealName} — ${monthLabels} ${year}`,
      order_id: orderData.id,
      prefill: { email: parentEmail },
      theme: { color: '#6c5ce7' },
    });
    setRazorpayVisible(true);
    setSubscribeLoading(false);
  };

  const handleRazorpaySuccess = async (response) => {
    setRazorpayVisible(false);
    if (!pendingVerifyPayload) return;

    setSubscribeLoading(true);
    const { remainingSelectedIds, remainingPlanGroup, ...verifyBody } = pendingVerifyPayload;
    const { ok: vOk, data: vData } = await api('wallet-recharge-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id: response.razorpay_order_id,
        razorpay_signature: response.razorpay_signature,
        ...verifyBody,
      }),
    });

    if (vOk && vData.verified) {
      showAlert(`Subscribed successfully to ${pendingVerifyPayload.meal_type_name}!`, 'success');
      await loadAll(selectedChildId);
      // If there are more years to pay for, reopen the modal with remaining plans
      if (remainingSelectedIds && remainingSelectedIds.length > 0) {
        setModalPlanGroup(remainingPlanGroup);
        setModalSelectedIds(new Set(remainingSelectedIds));
        setMultiModal(true);
      }
    } else {
      showAlert(vData.message || 'Payment verification failed. Contact support.');
    }
    setPendingVerifyPayload(null);
    setSubscribeLoading(false);
  };

  const handleRazorpayDismiss = () => { setRazorpayVisible(false); setSubscribeLoading(false); };
  const handleRazorpayFailed = (err) => {
    setRazorpayVisible(false);
    showAlert(`Payment failed: ${err?.description || 'Unknown error'}`);
    setSubscribeLoading(false);
  };

  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading subscriptions…</Text>
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
    <>
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
          <Text style={styles.chipText}>Canteen Meal Plans</Text>
        </View>
        <Text style={styles.heroTitle}>My Meal Plan Subscriptions</Text>
        <Text style={styles.heroSub}>View active plans and canteen access history.</Text>
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

      {/* Available Meal Plans */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Available Meal Plans</Text>
        <Text style={styles.cardSub}>Subscribe to a plan for {selectedChild?.student_name || 'your child'}</Text>
        {mealTypeGroups.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No meal plans available for this year.</Text>
          </View>
        ) : (
          mealTypeGroups.map((group) => {
            const unsubscribed = group.plans.filter(
              (p) => !subscriptions.some(
                (s) => s.meal_type_id === p.meal_type_id &&
                  parseInt(s.month) === parseInt(p.month) &&
                  parseInt(s.year) === parseInt(p.year) &&
                  s.status === 'Active'
              )
            );
            const prices = group.plans.map((p) => parseFloat(p.price));
            const minPrice = Math.min(...prices);
            const maxPrice = Math.max(...prices);
            const allSubscribed = unsubscribed.length === 0;
            return (
              <View key={group.meal_type_id} style={styles.planRow}>
                <View style={styles.planLeft}>
                  <Text style={styles.planName}>{group.meal_name}</Text>
                  <Text style={styles.planMeta}>
                    {group.plans.length} month{group.plans.length !== 1 ? 's' : ''} available
                    {' • '}₹{minPrice.toFixed(0)}{minPrice !== maxPrice ? `–₹${maxPrice.toFixed(0)}` : ''}/month
                  </Text>
                  {allSubscribed && (
                    <Text style={[styles.planMeta, { color: '#16a34a', marginTop: 2 }]}>All months subscribed</Text>
                  )}
                </View>
                {allSubscribed ? (
                  <View style={[styles.statusPill, styles.statusActive]}>
                    <Text style={[styles.statusText, styles.statusActiveText]}>✓ All Done</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.subscribeBtn, (!selectedChildId || subscribeLoading) && styles.subscribeBtnDisabled]}
                    onPress={() => handleSubscribePlanGroup(group.meal_type_id)}
                    disabled={!selectedChildId || subscribeLoading}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.subscribeBtnText}>
                      Select Months{'\n'}
                      <Text style={{ fontSize: 10 }}>({unsubscribed.length} available)</Text>
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
        {!selectedChildId && (
          <Text style={[styles.emptyText, { textAlign: 'center', marginTop: 8, color: COLORS.warning }]}>
            ↑ Select a child above to subscribe
          </Text>
        )}
      </View>

      {/* Active Subscriptions */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Active Meal Plan Subscriptions</Text>
        <Text style={styles.cardSub}>Plans subscribed for {selectedChild?.student_name || 'your child'}</Text>
        {subscriptions.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No subscriptions found. Go to Payments tab to subscribe to a meal plan.</Text>
          </View>
        ) : (
          subscriptions.map((sub) => {
            const isActive = sub.status === 'Active';
            return (
              <View key={sub.id} style={styles.subRow}>
                <View style={styles.subLeft}>
                  <Text style={styles.subPlan}>{sub.meal_type_name}</Text>
                  <Text style={styles.subMeta}>
                    {MONTH_SHORT[(sub.month || 1) - 1]} {sub.year}
                    {sub.grade ? ` • Grade ${sub.grade}` : ''}
                  </Text>
                  <Text style={styles.subDateLabel}>
                    Subscribed: {sub.subscribed_at ? new Date(sub.subscribed_at).toLocaleDateString('en-IN') : '—'}
                  </Text>
                </View>
                <View style={styles.subRight}>
                  <Text style={styles.subAmount}>₹{parseFloat(sub.amount_paid || 0).toFixed(0)}</Text>
                  <View style={[styles.statusPill, isActive ? styles.statusActive : styles.statusInactive]}>
                    <Text style={[styles.statusText, isActive ? styles.statusActiveText : styles.statusInactiveText]}>
                      {sub.status}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>

      {/* ── Multi-month subscription modal ── */}
      <Modal visible={multiModal} transparent animationType="slide" onRequestClose={() => setMultiModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {modalPlanGroup[0]?.meal_name || 'Subscribe'}
              </Text>
              <TouchableOpacity onPress={() => setMultiModal(false)} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Show which child this subscription is for */}
            {selectedChild && (
              <View style={styles.modalChildInfo}>
                <View style={styles.modalChildAvatar}>
                  <Text style={styles.modalChildAvatarText}>
                    {(selectedChild.student_name || 'S').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View>
                  <Text style={styles.modalChildName}>{selectedChild.student_name}</Text>
                  <Text style={styles.modalChildId}>Admission ID: {selectedChild.student_id || '—'}</Text>
                </View>
              </View>
            )}

            <Text style={styles.modalSubtitle}>
              Select the months you want to subscribe ({modalPlanGroup.length} available)
            </Text>

            {/* Quick-select buttons */}
            <View style={styles.quickSelectRow}>
              <TouchableOpacity
                style={styles.quickSelectBtn}
                onPress={() => setModalSelectedIds(new Set(modalPlanGroup.map((p) => p.id)))}
              >
                <Text style={styles.quickSelectBtnText}>Select All</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickSelectBtn}
                onPress={() => {
                  // Select only plans for the current calendar year
                  const curYear = new Date().getFullYear();
                  setModalSelectedIds(new Set(modalPlanGroup.filter((p) => parseInt(p.year) === curYear).map((p) => p.id)));
                }}
              >
                <Text style={styles.quickSelectBtnText}>This Year</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickSelectBtn}
                onPress={() => {
                  const nextYear = new Date().getFullYear() + 1;
                  setModalSelectedIds(new Set(modalPlanGroup.filter((p) => parseInt(p.year) === nextYear).map((p) => p.id)));
                }}
              >
                <Text style={styles.quickSelectBtnText}>Next Year</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.quickSelectBtn, styles.quickSelectBtnClear]}
                onPress={() => setModalSelectedIds(new Set())}
              >
                <Text style={[styles.quickSelectBtnText, { color: '#dc2626' }]}>Clear</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
              {modalPlanGroup.map((plan) => {
                const sel = modalSelectedIds.has(plan.id);
                return (
                  <TouchableOpacity
                    key={plan.id}
                    style={[styles.monthRow, sel && styles.monthRowSelected]}
                    onPress={() => {
                      const next = new Set(modalSelectedIds);
                      if (next.has(plan.id)) next.delete(plan.id); else next.add(plan.id);
                      setModalSelectedIds(next);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.checkbox, sel && styles.checkboxChecked]}>
                      {sel && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.monthName, sel && styles.monthNameSelected]}>
                        {MONTH_NAMES[parseInt(plan.month) - 1]} {plan.year}
                      </Text>
                      {plan.grade ? (
                        <Text style={styles.monthGrade}>Grade {plan.grade}</Text>
                      ) : null}
                    </View>
                    <Text style={[styles.monthPrice, sel && styles.monthPriceSelected]}>
                      ₹{parseFloat(plan.price).toFixed(0)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Totals */}
            {modalSelectedIds.size > 0 && (() => {
              const selPlans = modalPlanGroup.filter((p) => modalSelectedIds.has(p.id));
              const sub  = selPlans.reduce((s, p) => s + parseFloat(p.price), 0);
              const fee  = Math.round(sub * CONVENIENCE_RATE * 100) / 100;
              const tot  = sub + fee;
              return (
                <View style={styles.totalBox}>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>
                      Subtotal ({modalSelectedIds.size} month{modalSelectedIds.size !== 1 ? 's' : ''})
                    </Text>
                    <Text style={styles.totalValue}>₹{sub.toFixed(0)}</Text>
                  </View>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Convenience fee (2%)</Text>
                    <Text style={styles.totalValue}>₹{fee.toFixed(0)}</Text>
                  </View>
                  <View style={[styles.totalRow, { marginTop: 4 }]}>
                    <Text style={styles.grandLabel}>Total Payable</Text>
                    <Text style={styles.grandValue}>₹{tot.toFixed(0)}</Text>
                  </View>
                </View>
              );
            })()}

            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setMultiModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.payBtn, modalSelectedIds.size === 0 && styles.payBtnDisabled]}
                onPress={handleConfirmModal}
                disabled={modalSelectedIds.size === 0}
                activeOpacity={0.85}
              >
                <Text style={styles.payBtnText}>
                  Pay Now →
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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

  childItem: {
    padding: 16, borderRadius: 14, borderWidth: 1.5,
    borderColor: COLORS.border, marginBottom: 10,
    backgroundColor: COLORS.surface,
  },
  childItemActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  childName: { fontWeight: '800', fontSize: 16, color: COLORS.text },
  childNameActive: { color: COLORS.primary },
  childMeta: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },

  emptyBox: { alignItems: 'center', padding: 32 },
  emptyText: { color: COLORS.textMuted, fontSize: 15, textAlign: 'center', lineHeight: 22 },

  subRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  subLeft: { flex: 1, marginRight: 12 },
  subPlan: { fontSize: 16, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  subMeta: { fontSize: 14, color: COLORS.textMuted, marginBottom: 4 },
  subDateLabel: { fontSize: 12, color: COLORS.textLight, fontWeight: '500' },
  subRight: { alignItems: 'flex-end' },
  subAmount: { fontSize: 18, fontWeight: '800', color: COLORS.success, marginBottom: 8 },

  logRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  logLeft: { flex: 1, marginRight: 12 },
  logPlan: { fontSize: 15, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  logMeta: { fontSize: 13, color: COLORS.textMuted },
  logDenyReason: { fontSize: 12, color: COLORS.danger, marginTop: 4, fontWeight: '500' },

  statusPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  statusActive: { backgroundColor: COLORS.successLight },
  statusInactive: { backgroundColor: COLORS.dangerLight },
  statusText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  statusActiveText: { color: COLORS.success },
  statusInactiveText: { color: COLORS.danger },

  planRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  planLeft: { flex: 1, marginRight: 12 },
  planName: { fontSize: 16, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  planMeta: { fontSize: 13, color: COLORS.textMuted, marginBottom: 6 },
  planPrice: { fontSize: 15, fontWeight: '800', color: COLORS.primary },
  subscribeBtn: {
    backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 12, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 4,
  },
  subscribeBtnDisabled: { backgroundColor: COLORS.textLight, shadowOpacity: 0, elevation: 0 },
  subscribeBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 14, textAlign: 'center' },

  // ── Multi-month modal ──────────────────────────────────
  quickSelectRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16,
  },
  quickSelectBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: COLORS.border,
  },
  quickSelectBtnClear: {
    borderColor: COLORS.dangerLight, backgroundColor: COLORS.dangerLight,
  },
  quickSelectBtnText: {
    fontSize: 13, fontWeight: '700', color: COLORS.textMuted,
  },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 32, borderTopRightRadius: 32,
    padding: 24, paddingBottom: 40,
    shadowColor: '#000', shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.1, shadowRadius: 24, elevation: 20,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: COLORS.text, flex: 1, letterSpacing: -0.3 },
  modalClose: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center',
  },
  modalCloseText: { fontSize: 16, color: COLORS.textMuted, fontWeight: '700' },
  modalSubtitle: { fontSize: 14, color: COLORS.textMuted, marginBottom: 20, lineHeight: 20 },

  // Child info shown at the top of the month-selection modal
  modalChildInfo: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.primaryLight, borderRadius: 14,
    padding: 12, marginBottom: 16,
  },
  modalChildAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  modalChildAvatarText: { color: '#ffffff', fontWeight: '800', fontSize: 18 },
  modalChildName: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  modalChildId: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },

  monthRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.border,
    marginBottom: 10, backgroundColor: '#F8FAFC',
  },
  monthRowSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  checkbox: {
    width: 24, height: 24, borderRadius: 8,
    borderWidth: 2, borderColor: COLORS.textLight,
    marginRight: 14, justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  checkmark: { color: '#ffffff', fontWeight: '900', fontSize: 14 },
  monthName: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  monthNameSelected: { color: COLORS.primaryDark },
  monthGrade: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  monthPrice: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  monthPriceSelected: { color: COLORS.primaryDark },

  totalBox: {
    backgroundColor: '#F8FAFC', borderRadius: 14, padding: 16,
    marginTop: 16, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  totalLabel: { fontSize: 14, color: COLORS.textMuted, fontWeight: '500' },
  totalValue: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  grandLabel: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  grandValue: { fontSize: 20, fontWeight: '800', color: COLORS.primary },

  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: {
    flex: 1, paddingVertical: 16, borderRadius: 14,
    backgroundColor: '#F8FAFC', alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  cancelBtnText: { fontWeight: '700', fontSize: 15, color: COLORS.textMuted },
  payBtn: {
    flex: 2, paddingVertical: 16, borderRadius: 14,
    backgroundColor: COLORS.primary, alignItems: 'center',
    shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  payBtnDisabled: { backgroundColor: COLORS.textLight, shadowOpacity: 0, elevation: 0 },
  payBtnText: { color: '#ffffff', fontWeight: '800', fontSize: 16 },
});
