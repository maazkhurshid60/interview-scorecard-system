const { ValidationError } = require('./errors');

/** Prevent completion while a managed Google Calendar meeting is still active. */
function assertCalendarMeetingCancelled(interview, action) {
  if (interview?.calendarEventId) {
    throw new ValidationError(['meeting'], `Cancel the active Google Calendar meeting before you ${action}.`);
  }
}

module.exports = { assertCalendarMeetingCancelled };
