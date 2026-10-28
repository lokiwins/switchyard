/** An expected failure of a user action, carrying the HTTP status to report. */
export class ActionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
