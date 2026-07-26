import {
  SETTINGS_PORT_NAME,
  isStoredSettingsEnvelope,
  type StoredSettingsEnvelope,
} from "@ai-dlp/shared-types";

import { createSettingsSnapshotMessage } from "../messaging/schemas.js";
import type { SettingsStore } from "../storage/settings-store.js";
import {
  isValidSettingsPortSender,
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
};

export interface SettingsPortManager {
  handleConnect(port: RuntimePortLike): void;
  broadcast(envelope: StoredSettingsEnvelope): Promise<void>;
}

export function createSettingsPortManager(options: {
  runtimeId: string;
  settingsStore: SettingsStore;
  storageReady: Promise<void>;
}): SettingsPortManager {
  const ports = new Set<RuntimePortLike>();
  const lastSentGeneration = new Map<RuntimePortLike, number>();
  let generation = 0;

  function forget(port: RuntimePortLike): void {
    ports.delete(port);
    lastSentGeneration.delete(port);
  }

  function disconnect(port: RuntimePortLike): void {
    forget(port);
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
    if ((lastSentGeneration.get(port) ?? -1) >= messageGeneration) {
      return;
    }
    try {
      port.postMessage(createSettingsSnapshotMessage(envelope));
      lastSentGeneration.set(port, messageGeneration);
    } catch {
      disconnect(port);
    }
  }

  return {
    handleConnect(port) {
      if (
        port.name !== SETTINGS_PORT_NAME ||
        !isValidSettingsPortSender(port.sender, options.runtimeId)
      ) {
        disconnect(port);
        return;
      }

      ports.add(port);
      const initialGeneration = generation;
      const onDisconnect = (): void => {
        forget(port);
        port.onDisconnect.removeListener?.(onDisconnect);
      };
      port.onDisconnect.addListener(onDisconnect);

      void options.storageReady
        .then(() => options.settingsStore.read())
        .then((envelope) => {
          if (ports.has(port) && generation === initialGeneration) {
            send(port, envelope, initialGeneration);
          }
        })
        .catch(() => disconnect(port));
    },
    async broadcast(envelope) {
      if (!isStoredSettingsEnvelope(envelope)) {
        return;
      }
      const broadcastGeneration = ++generation;
      await options.storageReady;
      if (generation !== broadcastGeneration) {
        return;
      }
      for (const port of [...ports]) {
        send(port, envelope, broadcastGeneration);
      }
    },
  };
}
