// lib/calendar.js in the iPhone app with no Mac (scripts/build-local.mjs maps /lib/calendar.js here): the phone doesn't read a
// calendar yet, so Plan the day plans the workday without meetings and says so (lib/planner.js calendarError; the page
// already leaves the calendar out offline: app.js S.data.local).
const NONE = 'Your calendar is read on your Mac: on the phone the plan doesn’t know your meetings';
export const source = () => null;
export const readCalendars = () => [];
export const listEvents = async () => { throw new Error(NONE); };
export const listCalendars = async () => [];
const no = async () => { throw Object.assign(new Error('Calendar blocks need your Mac'), { status: 503 }); };
export const createEvent = no, moveEvent = no, deleteEvent = no;
