// Keep functions on the bounds, not on logs.timestamp, so SQLite can use its index.
const WORKDAY_FILTER = `timestamp >= datetime(date('now', 'localtime', '-4 hours'), '+4 hours', 'utc')
  AND timestamp < datetime(date('now', 'localtime', '-4 hours'), '+1 day', '+4 hours', 'utc')`;

function periodFilter(startDate, endDate, defaultWorkday = true) {
  if (startDate && endDate) {
    const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
      throw new Error('Invalid date range');
    }
    return {
      clause: " WHERE timestamp >= datetime(?, 'utc') AND timestamp < datetime(?, '+1 day', 'utc') ",
      params: [startDate, endDate]
    };
  }
  return { clause: defaultWorkday ? ` WHERE ${WORKDAY_FILTER} ` : '', params: [] };
}

module.exports = { periodFilter, WORKDAY_FILTER };
