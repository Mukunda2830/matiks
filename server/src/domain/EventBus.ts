import { EventEmitter } from 'events';
import { MatchCompletedEvent, RewardTriggeredEvent, LedgerEntry, PlayerState } from './models';

export interface RewardDedupedPayload {
  playerId: string;
  ruleId: string;
  idempotencyKey: string;
  timestamp: number;
}

export interface RewardGrantedPayload {
  ledgerEntry: LedgerEntry;
  playerState: PlayerState;
}

export interface EventMap {
  MatchCompleted: MatchCompletedEvent;
  RewardTriggered: RewardTriggeredEvent;
  RewardGranted: RewardGrantedPayload;
  RewardDeduped: RewardDedupedPayload;
}

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  public on<K extends keyof EventMap>(
    event: K,
    listener: (payload: EventMap[K]) => void | Promise<void>
  ): this {
    this.emitter.on(event, listener as (...args: any[]) => void);
    return this;
  }

  public once<K extends keyof EventMap>(
    event: K,
    listener: (payload: EventMap[K]) => void | Promise<void>
  ): this {
    this.emitter.once(event, listener as (...args: any[]) => void);
    return this;
  }

  public emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): boolean {
    return this.emitter.emit(event, payload);
  }

  public off<K extends keyof EventMap>(
    event: K,
    listener: (payload: EventMap[K]) => void
  ): this {
    this.emitter.off(event, listener as (...args: any[]) => void);
    return this;
  }

  public removeAllListeners(event?: keyof EventMap): this {
    if (event !== undefined) {
      this.emitter.removeAllListeners(event as string);
    } else {
      this.emitter.removeAllListeners();
    }
    return this;
  }

  public listenerCount(event: keyof EventMap): number {
    return this.emitter.listenerCount(event);
  }
}

export const eventBus = new EventBus();
