import {
  cloneProtectionSettings,
  isSettingsPortMessage,
  SETTINGS_PORT_NAME,
  type ContentProtectionStatus,
  type ProtectionSettings,
} from "@ai-dlp/shared-types";

export type ListenerCollection<Listener extends (...args: never[]) => void> = {
  addListener(listener: Listener): void;
  removeListener(listener: Listener): void;
};

export type ContentSettingsPort = {
  readonly name: string;
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: ListenerCollection<(message: unknown) => void>;
  onDisconnect: ListenerCollection<() => void>;
};

export interface RetryScheduler {
  schedule(callback: () => void, delayMs: number): () => void;
}

export type SettingsCacheState =
  "initializing" | "ready" | "unavailable" | "disposed";

export type SettingsCache = {
  start(): void;
  dispose(): void;
  getState(): SettingsCacheState;
  getSettings(): ProtectionSettings | null;
  postStatus(status: ContentProtectionStatus): boolean;
};

type ActiveConnection = {
  port: ContentSettingsPort;
  generation: number;
  onMessage(message: unknown): void;
  onDisconnect(): void;
};

const DEFAULT_RECONNECT_DELAYS_MS = Object.freeze([
  100, 250, 500, 1_000, 2_000, 5_000,
]);

const browserScheduler: RetryScheduler = {
  schedule(callback, delayMs) {
    const timeout = setTimeout(callback, delayMs);
    return () => clearTimeout(timeout);
  },
};

export function createSettingsCache(options: {
  connect(): ContentSettingsPort;
  onSettings(settings: ProtectionSettings): void;
  onConnectionState(state: Exclude<SettingsCacheState, "disposed">): void;
  scheduler?: RetryScheduler;
  reconnectDelaysMs?: readonly number[];
}): SettingsCache {
  const scheduler = options.scheduler ?? browserScheduler;
  const configuredDelays =
    options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
  const reconnectDelays =
    configuredDelays.length === 0
      ? DEFAULT_RECONNECT_DELAYS_MS
      : configuredDelays.map((delay) =>
          Number.isFinite(delay) && delay >= 0 ? delay : 5_000,
        );
  let state: SettingsCacheState = "initializing";
  let settings: ProtectionSettings | null = null;
  let settingsGeneration: number | null = null;
  let activeConnection: ActiveConnection | null = null;
  let removeRetry: (() => void) | null = null;
  let connectionGeneration = 0;
  let retryIndex = 0;
  let started = false;
  let disposed = false;

  function transition(next: Exclude<SettingsCacheState, "disposed">): void {
    if (state === next) return;
    state = next;
    options.onConnectionState(next);
  }

  function detach(connection: ActiveConnection): void {
    try {
      connection.port.onMessage.removeListener(connection.onMessage);
    } catch {
      // Continue removing the independent disconnect listener.
    }
    try {
      connection.port.onDisconnect.removeListener(connection.onDisconnect);
    } catch {
      // The extension context may already have removed its listeners.
    }
    if (activeConnection === connection) activeConnection = null;
  }

  function scheduleReconnect(): void {
    if (disposed || removeRetry !== null) return;
    const delayIndex = Math.min(retryIndex, reconnectDelays.length - 1);
    const delay = reconnectDelays[delayIndex] ?? 5_000;
    retryIndex += 1;
    removeRetry = scheduler.schedule(() => {
      removeRetry = null;
      connect();
    }, delay);
  }

  function handleConnectionLoss(connection?: ActiveConnection): void {
    if (connection !== undefined && activeConnection !== connection) return;
    if (connection !== undefined) detach(connection);
    connectionGeneration += 1;
    settings = null;
    settingsGeneration = null;
    if (!disposed) {
      transition("unavailable");
      scheduleReconnect();
    }
  }

  function handleMessage(connection: ActiveConnection, message: unknown): void {
    if (
      activeConnection !== connection ||
      connectionGeneration !== connection.generation ||
      !isSettingsPortMessage(message) ||
      (settingsGeneration !== null && message.generation <= settingsGeneration)
    ) {
      return;
    }
    const cloned = cloneProtectionSettings(message.envelope.settings);
    settings = cloned;
    settingsGeneration = message.generation;
    retryIndex = 0;
    transition("ready");
    options.onSettings(cloneProtectionSettings(cloned));
  }

  function connect(): void {
    if (disposed || activeConnection !== null) return;
    const generation = ++connectionGeneration;
    let connected: ContentSettingsPort;
    try {
      connected = options.connect();
      if (connected.name !== SETTINGS_PORT_NAME) {
        try {
          connected.disconnect();
        } catch {
          // The invalid port cannot carry a trusted snapshot.
        }
        throw new Error("Unexpected settings port.");
      }
    } catch {
      if (generation === connectionGeneration) handleConnectionLoss();
      return;
    }
    if (disposed || generation !== connectionGeneration) {
      try {
        connected.disconnect();
      } catch {
        // The content context is already being disposed.
      }
      return;
    }
    const onMessage = (message: unknown): void => {
      handleMessage(connection, message);
    };
    const onDisconnect = (): void => {
      handleConnectionLoss(connection);
    };
    const connection: ActiveConnection = {
      port: connected,
      generation,
      onMessage,
      onDisconnect,
    };
    activeConnection = connection;
    connected.onMessage.addListener(onMessage);
    connected.onDisconnect.addListener(onDisconnect);
    settings = null;
    settingsGeneration = null;
    transition("initializing");
  }

  return {
    start() {
      if (started || disposed) return;
      started = true;
      connect();
      if (state === "initializing") {
        options.onConnectionState("initializing");
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      connectionGeneration += 1;
      try {
        removeRetry?.();
      } catch {
        // Continue disposing the connected port and local state.
      }
      removeRetry = null;
      const current = activeConnection;
      if (current !== null) {
        detach(current);
        try {
          current.port.disconnect();
        } catch {
          // The extension context may already be gone.
        }
      }
      settings = null;
      settingsGeneration = null;
      state = "disposed";
    },
    getState() {
      return state;
    },
    getSettings() {
      return settings === null ? null : cloneProtectionSettings(settings);
    },
    postStatus(status) {
      const current = activeConnection;
      const generation = settingsGeneration;
      if (current === null || generation === null || disposed) return false;
      try {
        current.port.postMessage(
          structuredClone({
            type: "status.snapshot",
            generation,
            status,
          }),
        );
        return true;
      } catch {
        handleConnectionLoss(current);
        return false;
      }
    },
  };
}
