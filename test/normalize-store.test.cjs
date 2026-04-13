const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeStore } = require('../server.js');

const minimalPreset = {
  id: 'preset-1',
  title: 'Dishes',
  points: 1,
  color: '#378ADD',
  scoringMode: 'flat',
};

test('normalizeStore fills default people/locations when missing', () => {
  const s = normalizeStore({
    entries: [],
    chorePresets: [minimalPreset],
    quickChoreIds: [],
  });
  assert.ok(s.people.length >= 1);
  assert.ok(s.locations.length >= 1);
});

test('scheduled chore gets reminderEnabled true by default', () => {
  const s = normalizeStore({
    entries: [],
    scheduledChores: [
      {
        id: 'sch-1',
        title: 'Weekly',
        intervalDays: 7,
        startsOn: '2026-01-01',
        createdAt: '2026-01-01T12:00:00.000Z',
        updatedAt: '2026-01-01T12:00:00.000Z',
      },
    ],
    chorePresets: [minimalPreset],
    quickChoreIds: [minimalPreset.id],
  });
  const sch = s.scheduledChores.find((x) => x.id === 'sch-1');
  assert.strictEqual(sch.reminderEnabled, true);
});

test('reminderEnabled false preserved', () => {
  const s = normalizeStore({
    entries: [],
    scheduledChores: [
      {
        id: 'sch-2',
        title: 'Quiet',
        intervalDays: 7,
        startsOn: '2026-01-01',
        reminderEnabled: false,
        createdAt: '2026-01-01T12:00:00.000Z',
        updatedAt: '2026-01-01T12:00:00.000Z',
      },
    ],
    chorePresets: [minimalPreset],
    quickChoreIds: [minimalPreset.id],
  });
  assert.strictEqual(s.scheduledChores.find((x) => x.id === 'sch-2').reminderEnabled, false);
});

test('discordWebhook invalid generic URL stripped', () => {
  const s = normalizeStore({
    entries: [],
    discordWebhook: {
      enabled: true,
      url: 'https://discord.com/api/webhooks/x/y',
      reminderIntervalMinutes: 60,
      genericWebhookUrl: 'http://insecure.example/hook',
    },
    chorePresets: [minimalPreset],
    quickChoreIds: [minimalPreset.id],
  });
  assert.strictEqual(s.discordWebhook.genericWebhookUrl, '');
});

test('entry inherits chore text from choreId preset', () => {
  const s = normalizeStore({
    entries: [
      {
        id: 'e1',
        d: '2026-04-01',
        p: 'Alex',
        choreId: minimalPreset.id,
        c: '',
        createdAt: '2026-04-01T12:00:00.000Z',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    ],
    chorePresets: [minimalPreset],
    quickChoreIds: [minimalPreset.id],
  });
  assert.strictEqual(s.entries[0].c, 'Dishes');
});

test('discordReminderSentAt prunes unknown scheduled ids', () => {
  const s = normalizeStore({
    entries: [],
    scheduledChores: [
      {
        id: 'only-one',
        title: 'X',
        intervalDays: 7,
        startsOn: '2026-01-01',
        createdAt: '2026-01-01T12:00:00.000Z',
        updatedAt: '2026-01-01T12:00:00.000Z',
      },
    ],
    discordReminderSentAt: {
      'only-one': '2026-04-01T12:00:00.000Z',
      stale: '2026-04-01T12:00:00.000Z',
    },
    chorePresets: [minimalPreset],
    quickChoreIds: [minimalPreset.id],
  });
  assert.strictEqual(Object.keys(s.discordReminderSentAt).length, 1);
  assert.ok(s.discordReminderSentAt['only-one']);
  assert.strictEqual(s.discordReminderSentAt.stale, undefined);
});

test('merge-shaped store: union people and appended entries', () => {
  const s = normalizeStore({
    people: ['A', 'B', 'ImportUser'],
    locations: ['Kitchen'],
    entries: [
      {
        id: 'n1',
        d: '2026-05-01',
        p: 'ImportUser',
        c: 'Dishes',
        createdAt: '2026-05-01T12:00:00.000Z',
        updatedAt: '2026-05-01T12:00:00.000Z',
      },
    ],
    chorePresets: [minimalPreset],
    quickChoreIds: [minimalPreset.id],
  });
  assert.ok(s.people.includes('ImportUser'));
  assert.strictEqual(s.entries.length, 1);
  assert.strictEqual(s.entries[0].p, 'ImportUser');
});

test('entries without person or chore text are dropped', () => {
  const s = normalizeStore({
    entries: [
      {
        id: 'bad',
        d: '2026-04-01',
        p: '',
        c: 'Dishes',
        createdAt: '2026-04-01T12:00:00.000Z',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
      {
        id: 'ok',
        d: '2026-04-02',
        p: 'Pat',
        c: 'Dishes',
        createdAt: '2026-04-02T12:00:00.000Z',
        updatedAt: '2026-04-02T12:00:00.000Z',
      },
    ],
    chorePresets: [minimalPreset],
    quickChoreIds: [minimalPreset.id],
  });
  assert.strictEqual(s.entries.length, 1);
  assert.strictEqual(s.entries[0].id, 'ok');
});

test('entry locationIds are limited to known household locations', () => {
  const s = normalizeStore({
    locations: ['Kitchen'],
    entries: [
      {
        id: 'e1',
        d: '2026-04-01',
        p: 'Pat',
        c: 'Dishes',
        locationIds: ['Kitchen', 'Unknown room', 'Kitchen'],
        createdAt: '2026-04-01T12:00:00.000Z',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    ],
    chorePresets: [minimalPreset],
    quickChoreIds: [minimalPreset.id],
  });
  assert.deepStrictEqual(s.entries[0].locationIds, ['Kitchen', 'Kitchen']);
});

test('explicit empty quickChoreIds does not get auto-filled', () => {
  const s = normalizeStore({
    entries: [],
    chorePresets: [minimalPreset],
    quickChoreIds: [],
  });
  assert.strictEqual(s.quickChoreIds.length, 0);
});

test('omitted quickChoreIds defaults first presets to quick bar', () => {
  const p2 = { ...minimalPreset, id: 'preset-2', title: 'Trash' };
  const s = normalizeStore({
    entries: [],
    chorePresets: [minimalPreset, p2],
  });
  assert.ok(s.quickChoreIds.length >= 1);
  assert.strictEqual(s.quickChoreIds[0], minimalPreset.id);
});

test('empty chorePresets array gets default preset pack', () => {
  const s = normalizeStore({
    entries: [],
    chorePresets: [],
    quickChoreIds: [],
  });
  assert.ok(s.chorePresets.length >= 1);
  assert.ok(s.quickChoreIds.length >= 1);
});

test('invalid chore preset color falls back to default hex', () => {
  const s = normalizeStore({
    entries: [],
    chorePresets: [{ ...minimalPreset, color: 'not-a-color' }],
    quickChoreIds: [],
  });
  assert.strictEqual(s.chorePresets[0].color, '#378ADD');
});

test('scheduled intervalDays clamped to valid range', () => {
  const s = normalizeStore({
    entries: [],
    scheduledChores: [
      {
        id: 'wide',
        title: 'Often',
        intervalDays: 99999,
        startsOn: '2026-01-01',
        createdAt: '2026-01-01T12:00:00.000Z',
        updatedAt: '2026-01-01T12:00:00.000Z',
      },
    ],
    chorePresets: [minimalPreset],
    quickChoreIds: [minimalPreset.id],
  });
  assert.strictEqual(s.scheduledChores[0].intervalDays, 3650);
});

test('slack webhook URL kept when hooks.slack.com', () => {
  const url = 'https://hooks.slack.com/services/T/A/B';
  const s = normalizeStore({
    entries: [],
    discordWebhook: {
      enabled: true,
      url: '',
      slackWebhookUrl: url,
      reminderIntervalMinutes: 1440,
    },
    chorePresets: [minimalPreset],
    quickChoreIds: [minimalPreset.id],
  });
  assert.strictEqual(s.discordWebhook.slackWebhookUrl, url);
});

test('invalid Discord webhook URL rejected', () => {
  const s = normalizeStore({
    entries: [],
    discordWebhook: {
      enabled: true,
      url: 'https://example.com/not-discord',
      reminderIntervalMinutes: 60,
    },
    chorePresets: [minimalPreset],
    quickChoreIds: [minimalPreset.id],
  });
  assert.strictEqual(s.discordWebhook.url, '');
});

test('audit log drops rows without action', () => {
  const s = normalizeStore({
    entries: [],
    auditLog: [
      { id: 'a1', at: '2026-01-01T12:00:00.000Z', actor: 'u', action: 'test.ok', target: 'x' },
      { id: 'a2', at: '2026-01-02T12:00:00.000Z', actor: 'u', action: '', target: 'bad' },
    ],
    chorePresets: [minimalPreset],
    quickChoreIds: [minimalPreset.id],
  });
  assert.strictEqual(s.auditLog.length, 1);
  assert.strictEqual(s.auditLog[0].action, 'test.ok');
});
