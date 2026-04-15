function createReminderEngine(deps) {
  const {
    browserPushAllowedForHousehold,
    formatCalendarDateHuman,
    hasReminderDestination,
    isDiscordWebhookUrl,
    isGenericHttpsWebhookUrl,
    isInReminderQuietHours,
    isSlackIncomingWebhookUrl,
    localCalendarDateISO,
    nextDueDateScheduled,
    normalizeDiscordWebhook,
    postDiscordWebhook,
    postSlackIncomingWebhook,
    pushSend,
    readStore,
    reminderPayloads,
    writeStore,
    ensureRegistryLoaded,
    listHouseholdIds,
    getRegistry,
  } = deps;

  async function sendOverdueToAllWebhookChannels(w, chore, nextDue, today) {
    const discordPayload = reminderPayloads.buildOverdueDiscordPayload(
      chore,
      nextDue,
      today,
      formatCalendarDateHuman,
    );
    const slackText = reminderPayloads.buildOverdueSlackPlainText(
      chore,
      nextDue,
      today,
      formatCalendarDateHuman,
    );
    const tasks = [];
    if (w.url && isDiscordWebhookUrl(w.url)) {
      tasks.push(() => postDiscordWebhook(w.url, discordPayload));
    }
    if (w.slackWebhookUrl && isSlackIncomingWebhookUrl(w.slackWebhookUrl)) {
      tasks.push(() => postSlackIncomingWebhook(w.slackWebhookUrl, slackText));
    }
    if (w.genericWebhookUrl && isGenericHttpsWebhookUrl(w.genericWebhookUrl)) {
      tasks.push(() => postDiscordWebhook(w.genericWebhookUrl, discordPayload));
    }
    if (!tasks.length) return false;
    const results = await Promise.all(tasks.map((fn) => fn()));
    return results.some(Boolean);
  }

  async function sendDigestToAllWebhookChannels(w, chores, today) {
    const digestHelpers = { nextDueDateScheduled, formatCalendarDateHuman };
    const discordPayload = reminderPayloads.buildDiscordOverdueDigestPayload(
      chores,
      today,
      digestHelpers,
    );
    const slackText = reminderPayloads.buildSlackOverdueDigestPlainText(chores, today, digestHelpers);
    const tasks = [];
    if (w.url && isDiscordWebhookUrl(w.url)) {
      tasks.push(() => postDiscordWebhook(w.url, discordPayload));
    }
    if (w.slackWebhookUrl && isSlackIncomingWebhookUrl(w.slackWebhookUrl)) {
      tasks.push(() => postSlackIncomingWebhook(w.slackWebhookUrl, slackText));
    }
    if (w.genericWebhookUrl && isGenericHttpsWebhookUrl(w.genericWebhookUrl)) {
      tasks.push(() => postDiscordWebhook(w.genericWebhookUrl, discordPayload));
    }
    if (!tasks.length) return false;
    const results = await Promise.all(tasks.map((fn) => fn()));
    return results.some(Boolean);
  }

  async function sendDueTodayToAllWebhookChannels(w, chore, today) {
    const discordPayload = reminderPayloads.buildDueTodayDiscordPayload(
      chore,
      today,
      formatCalendarDateHuman,
    );
    const slackText = reminderPayloads.buildDueTodaySlackPlainText(
      chore,
      today,
      formatCalendarDateHuman,
    );
    const tasks = [];
    if (w.url && isDiscordWebhookUrl(w.url)) {
      tasks.push(() => postDiscordWebhook(w.url, discordPayload));
    }
    if (w.slackWebhookUrl && isSlackIncomingWebhookUrl(w.slackWebhookUrl)) {
      tasks.push(() => postSlackIncomingWebhook(w.slackWebhookUrl, slackText));
    }
    if (w.genericWebhookUrl && isGenericHttpsWebhookUrl(w.genericWebhookUrl)) {
      tasks.push(() => postDiscordWebhook(w.genericWebhookUrl, discordPayload));
    }
    if (!tasks.length) return false;
    const results = await Promise.all(tasks.map((fn) => fn()));
    return results.some(Boolean);
  }

  async function sendDueTodayDigestToAllWebhookChannels(w, chores, today) {
    const discordPayload = reminderPayloads.buildDiscordDueTodayDigestPayload(
      chores,
      today,
      formatCalendarDateHuman,
    );
    const slackText = reminderPayloads.buildSlackDueTodayDigestPlainText(
      chores,
      today,
      formatCalendarDateHuman,
    );
    const tasks = [];
    if (w.url && isDiscordWebhookUrl(w.url)) {
      tasks.push(() => postDiscordWebhook(w.url, discordPayload));
    }
    if (w.slackWebhookUrl && isSlackIncomingWebhookUrl(w.slackWebhookUrl)) {
      tasks.push(() => postSlackIncomingWebhook(w.slackWebhookUrl, slackText));
    }
    if (w.genericWebhookUrl && isGenericHttpsWebhookUrl(w.genericWebhookUrl)) {
      tasks.push(() => postDiscordWebhook(w.genericWebhookUrl, discordPayload));
    }
    if (!tasks.length) return false;
    const results = await Promise.all(tasks.map((fn) => fn()));
    return results.some(Boolean);
  }

  /**
   * @returns {Promise<{ ok: boolean, pruned: boolean }>}
   */
  async function sendPushPayloadToStoreSubscriptions(store, householdId, payloadString) {
    const subs = store.pushSubscriptions;
    if (!subs || !subs.length || !pushSend.vapidKeysPresent()) return { ok: false, pruned: false };
    if (!pushSend.ensureVapidConfigured()) return { ok: false, pruned: false };
    const dead = [];
    let any = false;
    for (const sub of subs) {
      const subscription = { endpoint: sub.endpoint, keys: sub.keys };
      try {
        await pushSend.sendToSubscription(subscription, payloadString);
        any = true;
      } catch (e) {
        const code = e.statusCode;
        if (code === 404 || code === 410) dead.push(sub.endpoint);
        else console.error('Web push:', e.message || e);
        if (code == null && e && e.message) console.error('Web push (detail):', sub.endpoint.slice(0, 48), e.message);
      }
    }
    if (dead.length) {
      store.pushSubscriptions = subs.filter((s) => !dead.includes(s.endpoint));
      await writeStore(householdId, store);
      return { ok: any, pruned: true };
    }
    return { ok: any, pruned: false };
  }

  let reminderJobRunning = false;
  async function runDiscordReminders() {
    if (reminderJobRunning) return;
    reminderJobRunning = true;
    try {
      ensureRegistryLoaded();
      const ids = listHouseholdIds(getRegistry());
      for (const householdId of ids) {
        const store = await readStore(householdId);
        const w = store.discordWebhook || normalizeDiscordWebhook(null);
        if (!w.enabled) continue;
        const webhookPath = hasReminderDestination(w);
        const hasPush =
          browserPushAllowedForHousehold(householdId) &&
          pushSend.vapidKeysPresent() &&
          Array.isArray(store.pushSubscriptions) &&
          store.pushSubscriptions.length > 0;

        const overdueWh = webhookPath && w.overdueNotifyWebhooks;
        const overduePush = hasPush && w.overdueNotifyPush;
        const dueTodayWh = webhookPath && w.dueTodayNotifyWebhooks;
        const dueTodayPush = hasPush && w.dueTodayNotifyPush;
        const anyOverdueChannel = overdueWh || overduePush;
        const anyDueTodayChannel = w.dueTodayEnabled && (dueTodayWh || dueTodayPush);

        if (!anyOverdueChannel && !anyDueTodayChannel) continue;
        if (isInReminderQuietHours(w)) continue;

        const today = localCalendarDateISO();
        const intervalMs = w.reminderIntervalMinutes * 60 * 1000;
        const now = Date.now();
        const list = store.scheduledChores || [];
        let sentMap = { ...store.discordReminderSentAt };
        let dueTodayMap = { ...(store.discordDueTodaySentAt || {}) };
        let changed = false;

        for (const s of list) {
          if (s.reminderEnabled === false) continue;
          const next = nextDueDateScheduled(s);

          if (next > today) {
            if (sentMap[s.id]) {
              delete sentMap[s.id];
              changed = true;
            }
            if (dueTodayMap[s.id]) {
              delete dueTodayMap[s.id];
              changed = true;
            }
            continue;
          }

          if (next < today) {
            if (dueTodayMap[s.id]) {
              delete dueTodayMap[s.id];
              changed = true;
            }
            if (!anyOverdueChannel) continue;

            const last = sentMap[s.id] ? Date.parse(sentMap[s.id]) : 0;
            if (last && now - last < intervalMs) continue;

            let okWh = false;
            let pushRes = { ok: false, pruned: false };
            if (overdueWh) okWh = await sendOverdueToAllWebhookChannels(w, s, next, today);
            if (overduePush) {
              pushRes = await sendPushPayloadToStoreSubscriptions(
                store,
                householdId,
                reminderPayloads.buildOverduePushPayloadJson(s, next, today, formatCalendarDateHuman),
              );
            }
            if (pushRes.pruned) changed = true;
            if (okWh || pushRes.ok) {
              sentMap[s.id] = new Date().toISOString();
              changed = true;
            }
            continue;
          }

          if (sentMap[s.id]) {
            delete sentMap[s.id];
            changed = true;
          }

          if (!w.dueTodayEnabled) {
            if (dueTodayMap[s.id]) {
              delete dueTodayMap[s.id];
              changed = true;
            }
            continue;
          }

          if (!anyDueTodayChannel) continue;
          if (dueTodayMap[s.id] === today) continue;

          let okWh = false;
          let pushRes = { ok: false, pruned: false };
          if (dueTodayWh) okWh = await sendDueTodayToAllWebhookChannels(w, s, today);
          if (dueTodayPush) {
            pushRes = await sendPushPayloadToStoreSubscriptions(
              store,
              householdId,
              reminderPayloads.buildDueTodayPushPayloadJson(s, today),
            );
          }
          if (pushRes.pruned) changed = true;
          if (okWh || pushRes.ok) {
            dueTodayMap[s.id] = today;
            changed = true;
          }
        }

        if (changed) {
          store.discordReminderSentAt = sentMap;
          store.discordDueTodaySentAt = dueTodayMap;
          await writeStore(householdId, store);
        }
      }
    } catch (e) {
      console.error('Discord reminders:', e);
    } finally {
      reminderJobRunning = false;
    }
  }

  return {
    runDiscordReminders,
    sendDigestToAllWebhookChannels,
    sendDueTodayDigestToAllWebhookChannels,
    sendPushPayloadToStoreSubscriptions,
  };
}

module.exports = {
  createReminderEngine,
};
