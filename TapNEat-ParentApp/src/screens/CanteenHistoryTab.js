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
  container:    { flex: 1, backgroundColor: '#f1f5f9' },
  content:      { paddingBottom: 40 },
  centered:     { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  loadingText:  { marginTop: 12, color: COLORS.textMuted, fontSize: 14 },

  // Hero
  hero: {
    flexDirection: 'row',
    backgroundColor: COLORS.sidebar,
    overflow: 'hidden',
  },
  heroAccent: {
    width: 6,
    backgroundColor: COLORS.primary,
  },
  heroBody: {
    flex: 1,
    padding: 20,
    paddingVertical: 22,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,184,148,0.18)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 3,
    marginBottom: 8,
  },
  chipText: { color: COLORS.primary, fontWeight: '700', fontSize: 11, letterSpacing: 0.5 },
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 4 },
  heroSub:   { color: '#94a3b8', fontSize: 13, lineHeight: 18 },

  // Child pills
  pillScroll: { paddingHorizontal: 16, paddingVertical: 12 },
  childPill: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#fff', marginRight: 8,
    borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  childPillActive:     { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  childPillText:       { fontWeight: '600', fontSize: 13, color: COLORS.text },
  childPillTextActive: { color: '#fff' },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },
  statCard: {
    flex: 1, borderRadius: 14, padding: 14, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  statCardGreen: { backgroundColor: '#f0fdf4' },
  statCardRed:   { backgroundColor: '#fef2f2' },
  statCardBlue:  { backgroundColor: '#eff6ff' },
  statNum:       { fontSize: 26, fontWeight: '800', marginBottom: 2 },
  statNumGreen:  { color: '#16a34a' },
  statNumRed:    { color: '#dc2626' },
  statNumBlue:   { color: '#2563eb' },
  statLabel:     { fontSize: 11, fontWeight: '600', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Card
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, margin: 16, marginTop: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  cardSub:   { fontSize: 12, color: COLORS.textMuted, marginBottom: 14 },

  // Empty
  emptyBox:   { alignItems: 'center', paddingVertical: 32 },
  emptyIcon:  { fontSize: 40, marginBottom: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  emptyText:  { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', lineHeight: 19 },

  // Log row
  logRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  logBadge: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center', marginRight: 12, marginTop: 1,
  },
  logBadgeGreen:  { backgroundColor: '#dcfce7' },
  logBadgeRed:    { backgroundColor: '#fee2e2' },
  logBadgeText:   { fontWeight: '800', fontSize: 14 },
  logContent:     { flex: 1, marginRight: 10 },
  logMeal:        { fontSize: 14, fontWeight: '700', color: COLORS.text, marginBottom: 2 },
  logDate:        { fontSize: 12, color: COLORS.textMuted },
  logDeny:        { fontSize: 11, color: '#dc2626', marginTop: 3 },

  // Status pill
  statusPill:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, alignSelf: 'center' },
  pillGreen:      { backgroundColor: '#dcfce7' },
  pillRed:        { backgroundColor: '#fee2e2' },
  pillText:       { fontSize: 12, fontWeight: '700' },
  pillTextGreen:  { color: '#15803d' },
  pillTextRed:    { color: '#b91c1c' },

  // Load more
  loadMoreBtn: {
    marginTop: 14, paddingVertical: 12, borderRadius: 10,
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center',
  },
  loadMoreText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
});
