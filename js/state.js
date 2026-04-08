import { thisCalendarMonthKey } from './utils/date.js';

export const DEFAULT_PEOPLE = ['Dylan', 'Rachel', 'Vic', 'Christian'];

export const DEFAULT_LOCATIONS = [
  'Upstairs',
  'Stairs',
  'Hallway',
  'Kitchen',
  'Living room',
  'Front porch',
  'Back porch',
];

export const PALETTE = [
  { bar: '#378ADD', text: '#E6F1FB' },
  { bar: '#D85A30', text: '#FAECE7' },
  { bar: '#7F77DD', text: '#EEEDFE' },
  { bar: '#1D9E75', text: '#E1F5EE' },
  { bar: '#C973D9', text: '#F8EEFB' },
  { bar: '#D8A530', text: '#FAF4E7' },
  { bar: '#2DB3A8', text: '#E3F8F6' },
  { bar: '#B85A6E', text: '#F8EEF0' },
];

export const app = {
  people: [...DEFAULT_PEOPLE],
  locations: [...DEFAULT_LOCATIONS],
  chorePresets: [],
  quickChoreIds: [],
  entries: [],
  scheduledChores: [],
  loadError: null,
  pendingScheduledCompleteId: null,
  pendingEditEntryId: null,
  pendingDeleteEntryId: null,
  pendingUndoEntryIds: [],
  addToastHideTimer: null,
  currentMonth: thisCalendarMonthKey(),
  /** Client-side filter for the activity log (current month only); cleared when month changes. */
  logSearchQuery: '',
  /** Empty = all people. Narrows stats, bars, heatmap, MoM (not the log list). */
  analyticsPersonFilter: '',
  /** Empty = all locations. Matches entries whose `locationIds` includes this name. */
  analyticsLocationFilter: '',
  /** Server: optional Discord webhook for overdue scheduled chore reminders. */
  discordWebhook: { enabled: false, url: '', reminderIntervalMinutes: 1440 },
};
