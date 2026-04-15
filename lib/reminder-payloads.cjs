function daysPastDue(nextDue, today) {
  return Math.floor(
    (new Date(`${today}T12:00:00`).getTime() - new Date(`${nextDue}T12:00:00`).getTime()) / 864e5,
  );
}

function safeTitleMarkdown(chore) {
  return String((chore && chore.title) || 'Chore').replace(/\*/g, '');
}

function safeTitleText(chore) {
  return String((chore && chore.title) || 'Chore').replace(/[<>]/g, '');
}

function buildOverdueDiscordPayload(chore, nextDue, today, formatCalendarDateHuman) {
  const daysPast = daysPastDue(nextDue, today);
  const title = safeTitleMarkdown(chore);
  const dueWhen = formatCalendarDateHuman(nextDue);
  return {
    embeds: [
      {
        title: 'Scheduled chore overdue',
        description: `**${title}** was due **${dueWhen}** (${daysPast} day${daysPast === 1 ? '' : 's'} overdue).`,
        color: 0xe24b4a,
      },
    ],
  };
}

function buildOverdueSlackPlainText(chore, nextDue, today, formatCalendarDateHuman) {
  const daysPast = daysPastDue(nextDue, today);
  const title = safeTitleMarkdown(chore);
  const dueWhen = formatCalendarDateHuman(nextDue);
  return `Scheduled chore overdue: *${title}* was due ${dueWhen} (${daysPast} day${daysPast === 1 ? '' : 's'} overdue).`;
}

function buildDiscordOverdueDigestPayload(chores, today, helpers) {
  const { nextDueDateScheduled, formatCalendarDateHuman } = helpers;
  const lines = chores.map((s) => {
    const next = nextDueDateScheduled(s);
    const daysPast = daysPastDue(next, today);
    const title = safeTitleMarkdown(s);
    const dueWhen = formatCalendarDateHuman(next);
    return `• **${title}** — due ${dueWhen} (${daysPast}d overdue)`;
  });
  const desc = lines.join('\n').slice(0, 3900);
  return {
    content: `**${chores.length} overdue scheduled chore(s)**`,
    embeds: [{ description: desc, color: 0xe24b4a }],
  };
}

function buildSlackOverdueDigestPlainText(chores, today, helpers) {
  const { nextDueDateScheduled, formatCalendarDateHuman } = helpers;
  const lines = chores.map((s) => {
    const next = nextDueDateScheduled(s);
    const daysPast = daysPastDue(next, today);
    const title = safeTitleMarkdown(s);
    const dueWhen = formatCalendarDateHuman(next);
    return `• ${title} — due ${dueWhen} (${daysPast}d overdue)`;
  });
  return `*${chores.length} overdue scheduled chore(s)*\n${lines.join('\n')}`.slice(0, 3900);
}

function buildOverduePushPayloadJson(chore, nextDue, today, formatCalendarDateHuman) {
  const daysPast = daysPastDue(nextDue, today);
  const name = safeTitleText(chore);
  const dueWhen = formatCalendarDateHuman(nextDue);
  const body = `${name} — was due ${dueWhen} (${daysPast}d overdue)`;
  return JSON.stringify({
    title: 'Chorelog — overdue',
    body,
    url: '/',
    tag: `scheduled-${chore.id}`,
  });
}

function buildDigestPushPayloadJson(chores, today, helpers) {
  const { nextDueDateScheduled } = helpers;
  const lines = chores.map((s) => {
    const next = nextDueDateScheduled(s);
    const daysPast = daysPastDue(next, today);
    const title = safeTitleText(s);
    return `${title} (${daysPast}d)`;
  });
  const body = lines.slice(0, 4).join(' · ') + (lines.length > 4 ? '…' : '');
  return JSON.stringify({
    title:
      chores.length === 1 ? 'Chorelog — overdue chore' : `Chorelog — ${chores.length} overdue chores`,
    body,
    url: '/',
    tag: 'chorelog-overdue-digest',
  });
}

function buildDueTodayDiscordPayload(chore, today, formatCalendarDateHuman) {
  const title = safeTitleMarkdown(chore);
  const dueWhen = formatCalendarDateHuman(today);
  return {
    embeds: [
      {
        title: 'Scheduled chore due today',
        description: `**${title}** is due **today** (${dueWhen}).`,
        color: 0x378add,
      },
    ],
  };
}

function buildDueTodaySlackPlainText(chore, today, formatCalendarDateHuman) {
  const title = safeTitleMarkdown(chore);
  const dueWhen = formatCalendarDateHuman(today);
  return `Scheduled chore due today: *${title}* (${dueWhen}).`;
}

function buildDueTodayPushPayloadJson(chore, today) {
  const name = safeTitleText(chore);
  return JSON.stringify({
    title: 'Chorelog — due today',
    body: `${name} is due today.`,
    url: '/',
    tag: `scheduled-due-${chore.id}-${today}`,
  });
}

function buildDiscordDueTodayDigestPayload(chores, today, formatCalendarDateHuman) {
  const lines = chores.map((s) => {
    const title = safeTitleMarkdown(s);
    return `• **${title}** — due today (${formatCalendarDateHuman(today)})`;
  });
  const desc = lines.join('\n').slice(0, 3900);
  return {
    content: `**${chores.length} scheduled chore(s) due today**`,
    embeds: [{ description: desc, color: 0x378add }],
  };
}

function buildSlackDueTodayDigestPlainText(chores, today, formatCalendarDateHuman) {
  const lines = chores.map((s) => {
    const title = safeTitleMarkdown(s);
    return `• ${title} — due today (${formatCalendarDateHuman(today)})`;
  });
  return `*${chores.length} scheduled chore(s) due today*\n${lines.join('\n')}`.slice(0, 3900);
}

function buildDueTodayDigestPushPayloadJson(chores, today) {
  const lines = chores.map((s) => safeTitleText(s));
  const body = lines.slice(0, 6).join(' · ') + (lines.length > 6 ? '…' : '');
  return JSON.stringify({
    title:
      chores.length === 1 ? 'Chorelog — due today' : `Chorelog — ${chores.length} chores due today`,
    body,
    url: '/',
    tag: `chorelog-due-today-${today}`,
  });
}

module.exports = {
  buildDigestPushPayloadJson,
  buildDiscordDueTodayDigestPayload,
  buildDiscordOverdueDigestPayload,
  buildDueTodayDigestPushPayloadJson,
  buildDueTodayDiscordPayload,
  buildDueTodayPushPayloadJson,
  buildDueTodaySlackPlainText,
  buildOverdueDiscordPayload,
  buildOverduePushPayloadJson,
  buildOverdueSlackPlainText,
  buildSlackDueTodayDigestPlainText,
  buildSlackOverdueDigestPlainText,
};
