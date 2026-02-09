/**
 * Circuit Breaker implementation for the job matcher
 *
 * Prevents overwhelming the AI service when errors are occurring frequently.
 * States:
 * - CLOSED: Normal operation, requests go through
 * - OPEN: Circuit is open, requests fail immediately
 * - HALF_OPEN: Testing if service is recovered
 */

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerOptions {
  failureThreshold: number; // Number of failures before opening circuit
  resetTimeout: number; // Time in ms before attempting recovery
  halfOpenMaxCalls?: number; // Max calls to allow in half-open state
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

  /**
   * Get the current state of the circuit breaker
   */
  getState(): CircuitState {
    // Check if we should transition from OPEN to HALF_OPEN
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

  /**
   * Check if a request can proceed
   */
  canExecute(): boolean {
    const state = this.getState();

    switch (state) {
      case CircuitState.CLOSED:
        return true;
      case CircuitState.OPEN:
        return false;
      case CircuitState.HALF_OPEN:
        // Allow limited requests in half-open state
        return this.halfOpenCalls < this.options.halfOpenMaxCalls;
    }
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.successCount++;
    this.halfOpenCalls++;

    if (this.state === CircuitState.HALF_OPEN) {
      // After enough successes in half-open, close the circuit
      if (this.halfOpenCalls >= this.options.halfOpenMaxCalls) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        console.log("[CircuitBreaker] Circuit CLOSED - Service recovered");
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed request
   */
  recordFailure(error?: Error): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.halfOpenCalls++;

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open reopens the circuit
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

  /**
   * Reset the circuit breaker to closed state
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenCalls = 0;
    console.log("[CircuitBreaker] Circuit manually reset to CLOSED");
  }

  /**
   * Get statistics about the circuit breaker
   */
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

  /**
   * Execute a function with circuit breaker protection
   */
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

// Singleton instance for the matcher
let matcherCircuitBreaker: CircuitBreaker | null = null;

export function getMatcherCircuitBreaker(options?: CircuitBreakerOptions): CircuitBreaker {
  if (!matcherCircuitBreaker && options) {
    matcherCircuitBreaker = new CircuitBreaker(options);
  }
  if (!matcherCircuitBreaker) {
    // Default options if none provided
    matcherCircuitBreaker = new CircuitBreaker({
      failureThreshold: 10,
      resetTimeout: 60000,
      halfOpenMaxCalls: 3,
    });
  }
  return matcherCircuitBreaker;
}

export function resetMatcherCircuitBreaker(options?: CircuitBreakerOptions): CircuitBreaker {
  if (options) {
    matcherCircuitBreaker = new CircuitBreaker(options);
  } else if (matcherCircuitBreaker) {
    matcherCircuitBreaker.reset();
  } else {
    matcherCircuitBreaker = new CircuitBreaker({
      failureThreshold: 10,
      resetTimeout: 60000,
      halfOpenMaxCalls: 3,
    });
  }
  return matcherCircuitBreaker;
}
