const { EventEmitter } = require('events');

const submissionEvents = new EventEmitter();
submissionEvents.setMaxListeners(0);

const isWorker = typeof process.send === 'function' && process.connected;

const notifySubmissionProgress = (sid) => {
  const id = Number(sid);
  if (!Number.isFinite(id) || id <= 0) return;
  if (isWorker) {
    try { process.send({ type: 'progress', sid: id }); } catch (e) { /* IPC closed */ }
    return;
  }
  submissionEvents.emit('update', id);
};

module.exports = {
  submissionEvents,
  notifySubmissionProgress,
};
