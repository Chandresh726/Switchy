export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  halfOpenMaxCalls?: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private halfOpenCalls: number = 0;

  private readonly options: Required<CircuitBreakerOptions>;

  constructor(options: CircuitBreakerOptions) {
    this.options = {
      failureThreshold: options.failureThreshold,
      resetTimeout: options.resetTimeout,
      halfOpenMaxCalls: options.halfOpenMaxCalls ?? 3,
    };
  }

  getState(): CircuitState {
    if (
      this.state === CircuitState.OPEN &&
      Date.now() - this.lastFailureTime >= this.options.resetTimeout
    ) {
      this.state = CircuitState.HALF_OPEN;
      this.halfOpenCalls = 0;
      console.log("[CircuitBreaker] Transitioning to HALF_OPEN state");
    }
    return this.state;
  }

  canExecute(): boolean {
    const state = this.getState();

    switch (state) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.OPEN:
        return false;
      case CircuitState.HALF_OPEN:
        return this.halfOpenCalls < this.options.halfOpenMaxCalls;
    }
  }

  recordSuccess(): void {
    this.successCount++;

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenCalls++;
      if (this.halfOpenCalls >= this.options.halfOpenMaxCalls) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.halfOpenCalls = 0;
        console.log("[CircuitBreaker] Circuit CLOSED - Service recovered");
      }
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount = 0;
    }
  }

  recordFailure(error?: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenCalls++;
      this.state = CircuitState.OPEN;
      console.log(
        `[CircuitBreaker] Circuit OPENED (half-open failure) - ${error?.message || "Unknown error"}`
      );
    } else if (
      this.state === CircuitState.CLOSED &&
      this.failureCount >= this.options.failureThreshold
    ) {
      this.state = CircuitState.OPEN;
      console.log(
        `[CircuitBreaker] Circuit OPENED (threshold reached: ${this.failureCount}/${this.options.failureThreshold}) - ${error?.message || "Unknown error"}`
      );
    }
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenCalls = 0;
    console.log("[CircuitBreaker] Circuit manually reset to CLOSED");
  }

  getStats(): {
    state: CircuitState;
    failureCount: number;
    successCount: number;
    lastFailureTime: number;
  } {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      const error = new Error(
        `Circuit breaker is ${this.state}. Will reset in ${Math.max(0, this.options.resetTimeout - (Date.now() - this.lastFailureTime))}ms`
      );
      error.name = "CircuitBreakerOpenError";
      throw error;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
}

export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  return new CircuitBreaker({
    failureThreshold: options.failureThreshold ?? 10,
    resetTimeout: options.resetTimeout ?? 60000,
    halfOpenMaxCalls: options.halfOpenMaxCalls ?? 3,
  });
}
