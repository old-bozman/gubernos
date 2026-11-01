// Next due date for a recurring task. The logic is shared with the browser (public/recur.js):
// canon `recurrence` is a cron pattern or an interval ("every 2 weeks").
export { nextRepeatDate as nextCronDate } from '../public/recur.js';
