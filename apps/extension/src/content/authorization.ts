import type { ConsumedSubmissionAuthorization } from "../adapters/chat-application-adapter.js";

export const AUTHORIZATION_LIFETIME_MS = 5 * 60 * 1_000;

declare const submissionAuthorizationBrand: unique symbol;

export type SubmissionAuthorization = {
  readonly [submissionAuthorizationBrand]: true;
};

type AuthorizationState = {
  attemptId: string;
  createdAt: number;
  consumed: boolean;
  invalidated: boolean;
};

const authorizationStates = new WeakMap<object, AuthorizationState>();

function isValidMonotonicTime(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function createSubmissionAuthorization(
  attemptId: string,
  createdAt: number,
): SubmissionAuthorization {
  if (attemptId.length === 0 || !isValidMonotonicTime(createdAt)) {
    throw new Error("Invalid submission authorization source.");
  }
  const authorization = Object.freeze(Object.create(null)) as object;
  authorizationStates.set(authorization, {
    attemptId,
    createdAt,
    consumed: false,
    invalidated: false,
  });
  return authorization as SubmissionAuthorization;
}

export function invalidateSubmissionAuthorization(
  authorization: SubmissionAuthorization | null,
): void {
  if (authorization !== null) {
    const state = authorizationStates.get(authorization);
    if (state !== undefined) {
      state.invalidated = true;
    }
  }
}

export function consumeSubmissionAuthorization(
  authorization: SubmissionAuthorization,
  attemptId: string,
  currentTime: number,
): ConsumedSubmissionAuthorization | null {
  const state = authorizationStates.get(authorization);
  if (
    state === undefined ||
    state.invalidated ||
    state.consumed ||
    state.attemptId !== attemptId ||
    !isValidMonotonicTime(currentTime) ||
    currentTime < state.createdAt ||
    currentTime - state.createdAt > AUTHORIZATION_LIFETIME_MS
  ) {
    if (state !== undefined) {
      state.invalidated = true;
    }
    return null;
  }

  state.consumed = true;
  return { attemptId } as ConsumedSubmissionAuthorization;
}
