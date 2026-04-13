import { apiFetch } from './api-fetch.js';
import { t } from './i18n.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function setPushStatus(msg, isError) {
  const el = document.getElementById('pushNotificationStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.hidden = !msg;
  el.style.color = isError ? '#E24B4A' : '';
}

function pushSupportedInThisBrowser() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** @returns {Promise<boolean>} */
async function serverHasVapid() {
  try {
    const r = await fetch('/api/push/vapid-public', { credentials: 'same-origin' });
    return r.ok;
  } catch {
    return false;
  }
}

export async function refreshPushNotificationsPanel() {
  const block = document.querySelector('.push-notifications-block');
  const serverOff = document.getElementById('pushServerOffHint');
  const httpsHint = document.getElementById('pushHttpsHint');
  const btnSub = document.getElementById('btnPushSubscribe');
  const btnUn = document.getElementById('btnPushUnsubscribe');
  const btnTest = document.getElementById('btnPushTest');
  if (!block) return;

  setPushStatus('', false);

  const vapidOk = await serverHasVapid();
  if (serverOff) {
    serverOff.hidden = vapidOk;
  }
  if (!vapidOk) {
    if (btnSub) btnSub.disabled = true;
    if (btnUn) btnUn.disabled = true;
    if (btnTest) btnTest.disabled = true;
    return;
  }
  if (btnSub) btnSub.disabled = false;
  if (btnTest) btnTest.disabled = false;

  const secure =
    typeof window.isSecureContext === 'boolean'
      ? window.isSecureContext
      : window.location.protocol === 'https:' || window.location.hostname === 'localhost';
  if (httpsHint) {
    httpsHint.hidden = secure;
  }

  if (!pushSupportedInThisBrowser()) {
    if (btnSub) btnSub.disabled = true;
    if (btnUn) btnUn.disabled = true;
    if (btnTest) btnTest.disabled = true;
    return;
  }

  let localSub = null;
  try {
    const reg = await navigator.serviceWorker.ready;
    localSub = await reg.pushManager.getSubscription();
  } catch {
    /* ignore */
  }

  let serverEndpoints = new Set();
  try {
    const r = await apiFetch('/api/push/subscriptions');
    if (r.ok) {
      const data = await r.json();
      const list = Array.isArray(data.subscriptions) ? data.subscriptions : [];
      serverEndpoints = new Set(list.map((x) => x.endpoint));
    }
  } catch {
    /* ignore */
  }

  const registeredHere = localSub && serverEndpoints.has(localSub.endpoint);
  if (btnSub) btnSub.hidden = Boolean(registeredHere);
  if (btnUn) {
    btnUn.hidden = !registeredHere;
    btnUn.disabled = !registeredHere;
  }
}

export async function enableBrowserPush() {
  setPushStatus('', false);
  if (!pushSupportedInThisBrowser()) {
    setPushStatus(t('settings.pushUnsupported'), true);
    return;
  }
  const vapidOk = await serverHasVapid();
  if (!vapidOk) {
    setPushStatus(t('settings.pushServerOff'), true);
    return;
  }
  try {
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') {
      setPushStatus(t('settings.pushDenied'), true);
      return;
    }
    await navigator.serviceWorker.register('/sw.js');
    const vapidR = await fetch('/api/push/vapid-public', { credentials: 'same-origin' });
    if (!vapidR.ok) {
      setPushStatus(t('settings.pushServerOff'), true);
      return;
    }
    const { publicKey } = await vapidR.json();
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    const r = await apiFetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
    if (!r.ok) throw new Error();
    setPushStatus(t('settings.pushEnabledOk'), false);
    await refreshPushNotificationsPanel();
  } catch {
    setPushStatus(t('settings.pushEnableErr'), true);
  }
}

export async function disableBrowserPush() {
  setPushStatus('', false);
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await apiFetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setPushStatus(t('settings.pushDisabledOk'), false);
    await refreshPushNotificationsPanel();
  } catch {
    setPushStatus(t('settings.pushDisableErr'), true);
  }
}

export async function testBrowserPush() {
  setPushStatus('', false);
  try {
    const r = await apiFetch('/api/push/test', { method: 'POST' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'fail');
    setPushStatus(t('settings.pushTestOk'), false);
  } catch {
    setPushStatus(t('settings.pushTestErr'), true);
  }
}
