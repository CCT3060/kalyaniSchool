import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
} from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getParentAuth, clearParentAuth } from '../utils/storage';
import { COLORS, API_BASE_URL } from '../constants';

function resolveLogoUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  const base = API_BASE_URL.replace(/\/api$/, '').replace(/\/backend\/api$/, '/backend');
  return `${base}${u.startsWith('/') ? '' : '/'}${u}`;
}
import WalletTab from './WalletTab';
import SubscriptionsTab from './SubscriptionsTab';
import TransactionHistoryTab from './TransactionHistoryTab';
import CanteenHistoryTab from './CanteenHistoryTab';

const Tab = createBottomTabNavigator();

export default function DashboardScreen({ navigation }) {
  const [parentEmail, setParentEmail] = useState('');
  const [parentName, setParentName] = useState('Parent');
  const [schoolLogoUrl, setSchoolLogoUrl] = useState('');
  const [schoolName, setSchoolName] = useState('');

  useEffect(() => {
    getParentAuth().then(({ email, name, schoolLogoUrl: logo, schoolName: sname }) => {
      if (!email) {
        navigation.replace('Login');
        return;
      }
      setParentEmail(email);
      setParentName(name);
      setSchoolLogoUrl(logo || '');
      setSchoolName(sname || '');
    });
  }, []);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await clearParentAuth();
          navigation.replace('Login');
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      {/* Top Header */}
      <SafeAreaView edges={['top']} style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.headerLeft}>
            <View style={styles.logoCircle}>
              {schoolLogoUrl ? (
                <Image
                  source={{ uri: resolveLogoUrl(schoolLogoUrl) }}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              ) : (
                <Text style={styles.logoEmoji}>🍽️</Text>
              )}
            </View>
            <View>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {schoolName || 'Tap-N-Eat'}
              </Text>
              <Text style={styles.headerSub}>Parent Portal</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>
                {(parentName || 'P').slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={{ marginLeft: 8, flex: 1 }}>
              <Text style={styles.parentName} numberOfLines={1}>{parentName}</Text>
              <Text style={styles.parentEmail} numberOfLines={1}>{parentEmail}</Text>
            </View>
            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={handleLogout}
              activeOpacity={0.7}
            >
              <Text style={styles.logoutText}>↩ Logout</Text>
            </TouchableOpacity>
          </View>
        </View>
        {/* Bottom accent line */}
        <View style={styles.headerAccent} />
      </SafeAreaView>

      {/* Bottom Tab Navigator */}
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: '#94a3b8',
          tabBarStyle: {
            backgroundColor: '#fff',
            borderTopColor: '#e2e8f0',
            borderTopWidth: 1,
            paddingBottom: 8,
            paddingTop: 6,
            height: 64,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: 0.06,
            shadowRadius: 8,
            elevation: 10,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '700',
            marginTop: 2,
          },
          tabBarIcon: ({ color, focused }) => {
            const icons = {
              Wallet:   focused ? '🏠' : '🏠',
              MealPlans: focused ? '🍽️' : '🍽️',
              Canteen:  focused ? '📡' : '📡',
              History:  focused ? '📊' : '📊',
            };
            return (
              <Text style={{
                fontSize: 20,
                opacity: focused ? 1 : 0.6,
                transform: [{ scale: focused ? 1.1 : 1 }],
              }}>
                {icons[route.name] || '·'}
              </Text>
            );
          },
        })}
      >
        <Tab.Screen
          name="Wallet"
          options={{ tabBarLabel: 'Home' }}
        >
          {() => <WalletTab parentEmail={parentEmail} parentName={parentName} />}
        </Tab.Screen>
        <Tab.Screen
          name="MealPlans"
          options={{ tabBarLabel: 'Meal Plans' }}
        >
          {() => <SubscriptionsTab parentEmail={parentEmail} />}
        </Tab.Screen>
        <Tab.Screen
          name="Canteen"
          options={{ tabBarLabel: 'Canteen' }}
        >
          {() => <CanteenHistoryTab parentEmail={parentEmail} />}
        </Tab.Screen>
        <Tab.Screen
          name="History"
          options={{ tabBarLabel: 'Payments' }}
        >
          {() => <TransactionHistoryTab parentEmail={parentEmail} />}
        </Tab.Screen>
      </Tab.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.sidebar,
  },
  header: {
    backgroundColor: COLORS.sidebar,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,184,148,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(0,184,148,0.4)',
  },
  logoEmoji: { fontSize: 20 },
  logoImage: { width: 28, height: 28, borderRadius: 6 },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  headerSub: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  avatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  parentName: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
    maxWidth: 90,
  },
  parentEmail: {
    color: '#94a3b8',
    fontSize: 9,
    maxWidth: 90,
  },
  logoutBtn: {
    marginLeft: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  logoutText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600',
  },
  headerAccent: {
    height: 2,
    backgroundColor: COLORS.primary,
    opacity: 0.5,
  },
});
