import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../utils/api';
import { COLORS } from '../constants';

const PAGE_SIZE = 20;

export default function CanteenHistoryTab({ parentEmail }) {
  const [children, setChildren]         = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [canteenLog, setCanteenLog]     = useState([]);
  const [loading, setLoading]           = useState(false);
  const [loadError, setLoadError]       = useState('');
  const [refreshing, setRefreshing]     = useState(false);
  const [page, setPage]                 = useState(1);

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

  const loadCanteenLog = useCallback(async (childId) => {
    if (!childId || !parentEmail) return;
    const { ok, data } = await api(
      `parent-portal?action=canteen-log&email=${encodeURIComponent(parentEmail)}&student_id=${childId}&limit=100`
    );
    if (ok) setCanteenLog(data.canteen_log || []);
  }, [parentEmail]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await loadChildren();
    if (selectedChildId) await loadCanteenLog(selectedChildId);
    setLoading(false);
  }, [loadChildren, loadCanteenLog, selectedChildId]);

  useEffect(() => { loadAll(); }, [parentEmail]);

  useEffect(() => {
    if (selectedChildId) {
      setPage(1);
      loadCanteenLog(selectedChildId);
    }
  }, [selectedChildId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadChildren();
    if (selectedChildId) await loadCanteenLog(selectedChildId);
    setRefreshing(false);
  };

  const visibleLogs = canteenLog.slice(0, page * PAGE_SIZE);
  const hasMore     = visibleLogs.length < canteenLog.length;

  const allowedCount = canteenLog.filter((l) => l.access_status === 'Allowed').length;
  const deniedCount  = canteenLog.length - allowedCount;

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading access history…</Text>
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
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />
      }
    >
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.heroAccent} />
        <View style={styles.heroBody}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>RFID History</Text>
          </View>
          <Text style={styles.heroTitle}>Canteen Access</Text>
          <Text style={styles.heroSub}>
            {selectedChild
              ? `${selectedChild.student_name}'s tap history at the school canteen`
              : 'RFID tap records at the school canteen'}
          </Text>
        </View>
      </View>

      {/* Child selector pills (if more than one child) */}
      {children.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillScroll}>
          {children.map((child) => (
            <TouchableOpacity
              key={child.id}
              style={[styles.childPill, selectedChildId === child.id && styles.childPillActive]}
              onPress={() => setSelectedChildId(child.id)}
              activeOpacity={0.75}
            >
              <Text
                style={[styles.childPillText, selectedChildId === child.id && styles.childPillTextActive]}
              >
                {child.student_name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Stats row */}
      {canteenLog.length > 0 && (
        <View style={styles.statsRow}>
          <View style={[styles.statCard, styles.statCardGreen]}>
            <Text style={[styles.statNum, styles.statNumGreen]}>{allowedCount}</Text>
            <Text style={styles.statLabel}>Allowed</Text>
          </View>
          <View style={[styles.statCard, styles.statCardRed]}>
            <Text style={[styles.statNum, styles.statNumRed]}>{deniedCount}</Text>
            <Text style={styles.statLabel}>Denied</Text>
          </View>
          <View style={[styles.statCard, styles.statCardBlue]}>
            <Text style={[styles.statNum, styles.statNumBlue]}>{canteenLog.length}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
        </View>
      )}

      {/* Log list */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Access Log</Text>
        <Text style={styles.cardSub}>Last {canteenLog.length} records — pull down to refresh</Text>

        {canteenLog.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No records yet</Text>
            <Text style={styles.emptyText}>
              Canteen access records appear here after the first RFID scan.
            </Text>
          </View>
        ) : (
          <>
            {visibleLogs.map((log) => {
              const ok = log.access_status === 'Allowed';
              return (
                <View key={log.id} style={styles.logRow}>
                  <View style={[styles.logBadge, ok ? styles.logBadgeGreen : styles.logBadgeRed]}>
                    <Text style={styles.logBadgeText}>{ok ? '✓' : '✗'}</Text>
                  </View>
                  <View style={styles.logContent}>
                    <Text style={styles.logMeal} numberOfLines={1}>
                      {log.meal_type_name || 'Canteen Scan'}
                    </Text>
                    <Text style={styles.logDate}>
                      {log.access_date}  •  {log.access_time?.slice(0, 5)}
                    </Text>
                    {!ok && !!log.deny_reason && (
                      <Text style={styles.logDeny}>⚠ {log.deny_reason}</Text>
                    )}
                  </View>
                  <View style={[styles.statusPill, ok ? styles.pillGreen : styles.pillRed]}>
                    <Text style={[styles.pillText, ok ? styles.pillTextGreen : styles.pillTextRed]}>
                      {ok ? 'Allowed' : 'Denied'}
                    </Text>
                  </View>
                </View>
              );
            })}

            {hasMore && (
              <TouchableOpacity style={styles.loadMoreBtn} onPress={() => setPage((p) => p + 1)} activeOpacity={0.8}>
                <Text style={styles.loadMoreText}>
                  Load More ({canteenLog.length - visibleLogs.length} remaining)
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: COLORS.background },
  content:      { paddingBottom: 40 },
  centered:     { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  loadingText:  { marginTop: 12, color: COLORS.textMuted, fontSize: 15, fontWeight: '500' },

  // Hero
  hero: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
    marginBottom: 20,
    overflow: 'hidden',
  },
  heroAccent: {
    width: 6,
    backgroundColor: COLORS.primary,
  },
  heroBody: {
    flex: 1,
    padding: 24,
    paddingVertical: 32,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primaryLight,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 12,
  },
  chipText: { color: COLORS.primaryDark, fontWeight: '800', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroTitle: { color: COLORS.text, fontSize: 26, fontWeight: '800', marginBottom: 8, letterSpacing: -0.3 },
  heroSub:   { color: COLORS.textMuted, fontSize: 15, lineHeight: 22 },

  // Child pills
  pillScroll: { paddingHorizontal: 20, paddingBottom: 16 },
  childPill: {
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20,
    backgroundColor: COLORS.surface, marginRight: 12,
    borderWidth: 1.5, borderColor: COLORS.border,
    shadowColor: '#64748B', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  childPillActive:     { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  childPillText:       { fontWeight: '700', fontSize: 14, color: COLORS.text },
  childPillTextActive: { color: '#ffffff' },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  statCard: {
    flex: 1, borderRadius: 16, padding: 16, alignItems: 'center',
    shadowColor: '#64748B', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  statCardGreen: { backgroundColor: COLORS.successLight },
  statCardRed:   { backgroundColor: COLORS.dangerLight },
  statCardBlue:  { backgroundColor: '#EFF6FF' },
  statNum:       { fontSize: 28, fontWeight: '800', marginBottom: 4, letterSpacing: -0.5 },
  statNumGreen:  { color: COLORS.success },
  statNumRed:    { color: COLORS.danger },
  statNumBlue:   { color: '#2563EB' },
  statLabel:     { fontSize: 12, fontWeight: '700', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Card
  card: {
    backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, marginHorizontal: 20, marginTop: 16,
    shadowColor: '#64748B', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06, shadowRadius: 24, elevation: 6,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, marginBottom: 4, letterSpacing: -0.2 },
  cardSub:   { fontSize: 14, color: COLORS.textMuted, marginBottom: 20 },

  // Empty
  emptyBox:   { alignItems: 'center', paddingVertical: 40 },
  emptyIcon:  { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, marginBottom: 8 },
  emptyText:  { fontSize: 15, color: COLORS.textMuted, textAlign: 'center', lineHeight: 22 },

  // Log row
  logRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  logBadge: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  logBadgeGreen:  { backgroundColor: COLORS.successLight },
  logBadgeRed:    { backgroundColor: COLORS.dangerLight },
  logBadgeText:   { fontWeight: '800', fontSize: 16, color: COLORS.text },
  logContent:     { flex: 1, marginRight: 12 },
  logMeal:        { fontSize: 16, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  logDate:        { fontSize: 13, color: COLORS.textMuted, fontWeight: '500' },
  logDeny:        { fontSize: 12, color: COLORS.danger, marginTop: 4, fontWeight: '600' },

  // Status pill
  statusPill:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, alignSelf: 'center' },
  pillGreen:      { backgroundColor: COLORS.successLight },
  pillRed:        { backgroundColor: COLORS.dangerLight },
  pillText:       { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  pillTextGreen:  { color: COLORS.success },
  pillTextRed:    { color: COLORS.danger },

  // Load more
  loadMoreBtn: {
    marginTop: 20, paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: COLORS.border, alignItems: 'center',
  },
  loadMoreText: { color: COLORS.primary, fontWeight: '800', fontSize: 14 },
});
