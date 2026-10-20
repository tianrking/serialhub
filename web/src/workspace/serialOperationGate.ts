import type { HubSession } from "../useHubConnection.ts";

export interface SerialOperation {
  readonly session: HubSession;
  readonly epoch: number | undefined;
  readonly signal: AbortSignal;
  readonly controller: AbortController;
}

/** One admitted action owns TX until ACK; stale completions cannot unlock a newer action. */
export class SerialOperationGate {
  private current: SerialOperation | null = null;
  private readonly isSessionCurrent: (session: HubSession) => boolean;

  constructor(isSessionCurrent: (session: HubSession) => boolean) {
    this.isSessionCurrent = isSessionCurrent;
  }

  get busy(): boolean {
    return this.current !== null;
  }

  begin(session: HubSession | null, allowed: boolean): SerialOperation | null {
    if (this.current && !this.isCurrent(this.current)) this.invalidate();
    if (
      !allowed ||
      this.current ||
      !session ||
      typeof session.deviceEpoch !== "number" ||
      !Number.isSafeInteger(session.deviceEpoch) ||
      session.deviceEpoch < 0 ||
      !this.isSessionCurrent(session) ||
      !session.streamOpen ||
      !session.deviceConnected
    )
      return null;
    const controller = new AbortController();
    this.current = {
      session,
      epoch: session.deviceEpoch,
      controller,
      signal: AbortSignal.any([controller.signal, session.signal]),
    };
    return this.current;
  }

  isCurrent(operation: SerialOperation): boolean {
    return (
      this.current === operation &&
      !operation.signal.aborted &&
      this.isSessionCurrent(operation.session) &&
      operation.epoch === operation.session.deviceEpoch &&
      operation.session.streamOpen &&
      operation.session.deviceConnected
    );
  }

  finish(operation: SerialOperation): boolean {
    if (this.current !== operation) return false;
    this.current = null;
    return true;
  }

  invalidate(reason?: Error): boolean {
    const operation = this.current;
    this.current = null;
    operation?.controller.abort(reason);
    return operation !== null;
  }
}
