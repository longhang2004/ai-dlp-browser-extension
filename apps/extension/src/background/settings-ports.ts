import {
  SETTINGS_PORT_NAME,
  isContentHandshakePortMessage,
  isContentStatusPortMessage,
  isStoredSettingsEnvelope,
  type ContentProtectionStatus,
  type ProtectionStatusSnapshot,
  type StoredSettingsEnvelope,
} from "@ai-dlp/shared-types";

import { createSettingsSnapshotMessage } from "../messaging/schemas.js";
import type { SettingsStore } from "../storage/settings-store.js";
import {
  resolveSettingsPortSenderDescriptor,
  type RuntimeSender,
} from "./sender-validation.js";

export type ListenerCollection<
  Listener extends (...arguments_: never[]) => void,
> = {
  addListener(listener: Listener): void;
  removeListener?(listener: Listener): void;
};

export type RuntimePortLike = {
  name: string;
  sender?: RuntimeSender;
  postMessage(message: unknown): void;
  disconnect(): void;
  onDisconnect: ListenerCollection<() => void>;
  onMessage: ListenerCollection<(message: unknown) => void>;
};

export interface SettingsPortManager {
  handleConnect(port: RuntimePortLike): void;
  broadcast(envelope: StoredSettingsEnvelope): Promise<void>;
  readStatus(recentEventCount: number): ProtectionStatusSnapshot;
}

export interface HandshakeScheduler {
  schedule(callback: () => void, delayMs: number): () => void;
}

export const CONTENT_HANDSHAKE_TIMEOUT_MS = 5_000;

const browserHandshakeScheduler: HandshakeScheduler = {
  schedule(callback, delayMs) {
    const timeout = setTimeout(callback, delayMs);
    return () => clearTimeout(timeout);
  },
};

export function createSettingsPortManager(options: {
  runtimeId: string;
  settingsStore: SettingsStore;
  storageReady: Promise<void>;
  handshakeScheduler?: HandshakeScheduler;
}): SettingsPortManager {
  const handshakeScheduler =
    options.handshakeScheduler ?? browserHandshakeScheduler;
  const ports = new Set<RuntimePortLike>();
  const lastSentGeneration = new Map<RuntimePortLike, number>();
  const expectedGeneration = new Map<RuntimePortLike, number>();
  const expectedProtectionEnabled = new Map<RuntimePortLike, boolean>();
  const connectionTokens = new Map<RuntimePortLike, number>();
  const statuses = new Map<RuntimePortLike, ContentProtectionStatus>();
  const listenerCleanup = new Map<RuntimePortLike, () => void>();
  let generation = 0;
  let nextConnectionToken = 0;

  function forget(port: RuntimePortLike, connectionToken?: number): void {
    if (
      connectionToken !== undefined &&
      connectionTokens.get(port) !== connectionToken
    ) {
      return;
    }
    ports.delete(port);
    lastSentGeneration.delete(port);
    expectedGeneration.delete(port);
    expectedProtectionEnabled.delete(port);
    connectionTokens.delete(port);
    statuses.delete(port);
    const cleanup = listenerCleanup.get(port);
    listenerCleanup.delete(port);
    cleanup?.();
  }

  function disconnect(port: RuntimePortLike, connectionToken?: number): void {
    if (
      connectionToken !== undefined &&
      connectionTokens.get(port) !== connectionToken
    ) {
      return;
    }
    forget(port, connectionToken);
    try {
      port.disconnect();
    } catch {
      // A disconnected extension context needs no second signal.
    }
  }

  function send(
    port: RuntimePortLike,
    envelope: StoredSettingsEnvelope,
    messageGeneration: number,
  ): void {
    if (expectedGeneration.get(port) !== messageGeneration) return;
    if ((lastSentGeneration.get(port) ?? -1) >= messageGeneration) {
      return;
    }
    try {
      port.postMessage(
        createSettingsSnapshotMessage(envelope, messageGeneration),
      );
      lastSentGeneration.set(port, messageGeneration);
      expectedProtectionEnabled.set(port, envelope.settings.protectionEnabled);
    } catch {
      disconnect(port);
    }
  }

  return {
    handleConnect(port) {
      const expectedDescriptor = resolveSettingsPortSenderDescriptor(
        port.sender,
        options.runtimeId,
      );
      if (port.name !== SETTINGS_PORT_NAME || expectedDescriptor === null) {
        disconnect(port);
        return;
      }

      if (connectionTokens.has(port)) forget(port);

      const connectionToken = ++nextConnectionToken;
      connectionTokens.set(port, connectionToken);
      let accepted = false;
      let cancelHandshakeTimeout: (() => void) | undefined;
      const onDisconnect = (): void => {
        forget(port, connectionToken);
      };
      const onMessage = (message: unknown): void => {
        if (connectionTokens.get(port) !== connectionToken) return;
        if (!accepted) {
          if (!isContentHandshakePortMessage(expectedDescriptor, message)) {
            disconnect(port, connectionToken);
            return;
          }
          accepted = true;
          cancelHandshakeTimeout?.();
          cancelHandshakeTimeout = undefined;
          ports.add(port);
          const initialGeneration = generation;
          expectedGeneration.set(port, initialGeneration);
          statuses.set(port, {
            state: "initializing",
            application: "chatgpt",
            protectionEnabled: null,
          });
          void options.storageReady
            .then(() => options.settingsStore.read())
            .then((envelope) => {
              if (
                connectionTokens.get(port) === connectionToken &&
                generation === initialGeneration
              ) {
                send(port, envelope, initialGeneration);
              }
            })
            .catch(() => disconnect(port, connectionToken));
          return;
        }

        const protectionEnabled = expectedProtectionEnabled.get(port);
        if (
          !isContentStatusPortMessage(message) ||
          expectedGeneration.get(port) !== message.generation ||
          lastSentGeneration.get(port) !== message.generation ||
          protectionEnabled === undefined ||
          (message.status.state !== "initializing" &&
            (protectionEnabled
              ? message.status.state === "disabled"
              : message.status.state !== "disabled"))
        ) {
          return;
        }
        statuses.set(port, structuredClone(message.status));
      };
      port.onDisconnect.addListener(onDisconnect);
      port.onMessage.addListener(onMessage);
      listenerCleanup.set(port, () => {
        try {
          cancelHandshakeTimeout?.();
        } catch {
          // Continue removing both independent port listeners.
        }
        cancelHandshakeTimeout = undefined;
        try {
          port.onDisconnect.removeListener?.(onDisconnect);
        } catch {
          // Continue removing the independent message listener.
        }
        try {
          port.onMessage.removeListener?.(onMessage);
        } catch {
          // The port may already have invalidated its listener registry.
        }
      });
      cancelHandshakeTimeout = handshakeScheduler.schedule(() => {
        if (connectionTokens.get(port) === connectionToken && !accepted) {
          disconnect(port, connectionToken);
        }
      }, CONTENT_HANDSHAKE_TIMEOUT_MS);
    },
    async broadcast(envelope) {
      if (!isStoredSettingsEnvelope(envelope)) {
        return;
      }
      const broadcastGeneration = ++generation;
      for (const port of ports) {
        expectedGeneration.set(port, broadcastGeneration);
        statuses.set(port, {
          state: "initializing",
          application: "chatgpt",
          protectionEnabled: null,
        });
      }
      await options.storageReady;
      if (generation !== broadcastGeneration) {
        return;
      }
      for (const port of [...ports]) {
        send(port, envelope, broadcastGeneration);
      }
    },
    readStatus(recentEventCount) {
      const count =
        Number.isSafeInteger(recentEventCount) && recentEventCount >= 0
          ? recentEventCount
          : 0;
      const current = [...statuses.values()];
      if (current.length === 0) {
        return {
          state: "unavailable",
          application: "chatgpt",
          protectionEnabled: null,
          recentEventCount: count,
        };
      }
      if (current.some((status) => status.state === "initializing")) {
        return {
          state: "initializing",
          application: "chatgpt",
          protectionEnabled: null,
          recentEventCount: count,
        };
      }
      if (current.every((status) => status.state === "disabled")) {
        return {
          state: "disabled",
          application: "chatgpt",
          protectionEnabled: false,
          recentEventCount: count,
        };
      }
      if (current.some((status) => status.state === "disabled")) {
        return {
          state: "initializing",
          application: "chatgpt",
          protectionEnabled: null,
          recentEventCount: count,
        };
      }
      if (current.some((status) => status.state === "degraded")) {
        return {
          state: "degraded",
          application: "chatgpt",
          protectionEnabled: true,
          recentEventCount: count,
        };
      }
      if (current.some((status) => status.state === "waiting_for_composer")) {
        return {
          state: "waiting_for_composer",
          application: "chatgpt",
          protectionEnabled: true,
          recentEventCount: count,
        };
      }
      return {
        state: "active",
        application: "chatgpt",
        protectionEnabled: true,
        recentEventCount: count,
      };
    },
  };
}
