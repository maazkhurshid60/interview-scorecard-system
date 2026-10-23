const { ValidationError } = require('./errors');

function statusError(message) {
  const error = new ValidationError(['status'], message);
  error.statusCode = 409;
  return error;
}

/** New candidates and new pipeline stages are only allowed while recruiting is open. */
function assertRequisitionOpen(requisition, action) {
  if (!requisition || requisition.status !== 'open') {
    const status = requisition?.status === 'paused' || requisition?.status === 'on_hold'
      ? 'paused'
      : requisition?.status === 'draft' ? 'a draft' : 'closed';
    throw statusError(`This requisition is ${status}. Reopen it before you ${action}.`);
  }
}

/** Non-closed requisitions can be configured; only Open can accept new applicants/work. */
function assertRequisitionConfigurable(requisition, action) {
  if (!requisition || requisition.status === 'closed') {
    const status = 'closed';
    throw statusError(`This requisition is ${status}. Reopen it before you ${action}.`);
  }
}

/** A closed requisition is historical/read-only; paused/draft requisitions may finish existing work. */
function assertRequisitionNotClosed(requisition, action) {
  if (!requisition || requisition.status === 'closed') {
    throw statusError(`This requisition is closed and read-only. Reopen it before you ${action}.`);
  }
}

module.exports = { assertRequisitionOpen, assertRequisitionConfigurable, assertRequisitionNotClosed };
