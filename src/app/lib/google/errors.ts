export class GscNotConnectedError extends Error {
  constructor(
    message = "Google Search Console is not connected. Connect a Google account in settings.",
  ) {
    super(message);
    this.name = "GscNotConnectedError";
  }
}

export class GscAuthError extends Error {
  constructor(
    message = "Google authorization is no longer valid. Reconnect the account in settings.",
  ) {
    super(message);
    this.name = "GscAuthError";
  }
}

export class GscApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GscApiError";
    this.status = status;
  }
}
