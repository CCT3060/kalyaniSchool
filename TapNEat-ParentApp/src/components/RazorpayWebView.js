import React, { useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { COLORS } from '../constants';

/**
 * Renders Razorpay checkout inside a WebView modal.
 *
 * Props:
 *  - visible: bool
 *  - options: Razorpay options object (key, amount, currency, name, etc.)
 *  - onSuccess(response)  — called with razorpay_payment_id, order_id, signature
 *  - onDismiss()          — called when user closes the checkout
 *  - onFailed(error)      — called when payment fails
 */
export default function RazorpayWebView({ visible, options, onSuccess, onDismiss, onFailed }) {
  const webRef = useRef(null);

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #f0f0f0; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; }
    #msg { color: #555; font-size: 14px; text-align: center; padding: 20px; }
  </style>
</head>
<body>
  <div id="msg">Opening payment gateway…</div>
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <script>
    var opts = ${JSON.stringify({
      ...options,
      handler: undefined,
      modal: undefined,
    })};

    opts.handler = function(response) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'success',
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id: response.razorpay_order_id,
        razorpay_signature: response.razorpay_signature,
      }));
    };

    opts.modal = {
      ondismiss: function() {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'dismissed' }));
      }
    };

    try {
      var rzp = new Razorpay(opts);
      rzp.on('payment.failed', function(resp) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'failed',
          error: resp.error,
        }));
      });
      rzp.open();
    } catch(e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'error',
        message: e.message,
      }));
    }
  </script>
</body>
</html>
`;

  const handleMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'success') {
        onSuccess && onSuccess(msg);
      } else if (msg.type === 'dismissed') {
        onDismiss && onDismiss();
      } else if (msg.type === 'failed' || msg.type === 'error') {
        onFailed && onFailed(msg.error || msg.message);
      }
    } catch {}
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Secure Payment</Text>
          <TouchableOpacity onPress={onDismiss} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕ Cancel</Text>
          </TouchableOpacity>
        </View>
        <WebView
          ref={webRef}
          source={{ html: htmlContent }}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.loadingText}>Loading payment gateway…</Text>
            </View>
          )}
          style={styles.webview}
          // Allow mixed content for Razorpay on Android
          mixedContentMode="always"
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingBottom: 12,
    backgroundColor: COLORS.sidebar,
  },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  closeBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  closeBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  webview: { flex: 1 },
  loadingBox: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  loadingText: { marginTop: 12, color: COLORS.textMuted, fontSize: 14 },
});
