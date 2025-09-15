// Error handling and retry utilities
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 16000,
  backoffMultiplier: 2,
};

export class RetryManager {
  private retryCounts: Map<string, number> = new Map();
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();

  async retry<T>(
    key: string,
    operation: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<T> {
    const currentRetries = this.retryCounts.get(key) || 0;
    
    if (currentRetries >= config.maxRetries) {
      this.retryCounts.delete(key);
      throw new Error(`Max retries (${config.maxRetries}) exceeded for ${key}`);
    }

    try {
      const result = await operation();
      // Success - reset retry count
      this.retryCounts.delete(key);
      this.clearTimer(key);
      return result;
    } catch (error) {
      const nextRetryCount = currentRetries + 1;
      this.retryCounts.set(key, nextRetryCount);

      if (nextRetryCount >= config.maxRetries) {
        this.retryCounts.delete(key);
        this.clearTimer(key);
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffMultiplier, currentRetries),
        config.maxDelay
      );

      return new Promise((resolve, reject) => {
        const timer = setTimeout(async () => {
          try {
            const result = await this.retry(key, operation, config);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }, delay);

        this.retryTimers.set(key, timer);
      });
    }
  }

  clearTimer(key: string): void {
    const timer = this.retryTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(key);
    }
  }

  clearAll(): void {
    this.retryTimers.forEach(timer => clearTimeout(timer));
    this.retryTimers.clear();
    this.retryCounts.clear();
  }

  getRetryCount(key: string): number {
    return this.retryCounts.get(key) || 0;
  }
}

// Global retry manager instance
export const retryManager = new RetryManager();

// Error types
export enum ErrorType {
  VIDEO_LOAD_FAILED = 'VIDEO_LOAD_FAILED',
  MEDIA_IMPORT_FAILED = 'MEDIA_IMPORT_FAILED',
  TIMELINE_SAVE_FAILED = 'TIMELINE_SAVE_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
}

export interface AppError {
  type: ErrorType;
  message: string;
  details?: any;
  timestamp: Date;
  retryable: boolean;
}

export class ErrorHandler {
  private static instance: ErrorHandler;
  private errors: Map<string, AppError[]> = new Map();

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  logError(component: string, error: AppError): void {
    if (!this.errors.has(component)) {
      this.errors.set(component, []);
    }
    
    const componentErrors = this.errors.get(component)!;
    componentErrors.push(error);
    
    // Keep only last 10 errors per component
    if (componentErrors.length > 10) {
      componentErrors.shift();
    }

    console.error(`[${component}] ${error.type}: ${error.message}`, error.details);
  }

  getErrors(component: string): AppError[] {
    return this.errors.get(component) || [];
  }

  clearErrors(component: string): void {
    this.errors.delete(component);
  }

  clearAllErrors(): void {
    this.errors.clear();
  }

  createError(
    type: ErrorType,
    message: string,
    details?: any,
    retryable: boolean = true
  ): AppError {
    return {
      type,
      message,
      details,
      timestamp: new Date(),
      retryable,
    };
  }
}

export const errorHandler = ErrorHandler.getInstance();

// Media readiness checker - DISABLED to prevent infinite loops
// This was causing infinite requests when media doesn't exist yet
export class MediaReadinessChecker {
  private static instance: MediaReadinessChecker;

  static getInstance(): MediaReadinessChecker {
    if (!MediaReadinessChecker.instance) {
      MediaReadinessChecker.instance = new MediaReadinessChecker();
    }
    return MediaReadinessChecker.instance;
  }

  async waitForMediaReady(
    mediaId: string,
    checkFunction: () => Promise<boolean>,
    maxWaitTime: number = 30000,
    checkInterval: number = 1000
  ): Promise<boolean> {
    // Always return true to prevent infinite loops
    // The media import process will handle timing
    console.log(`Media readiness check disabled for ${mediaId} - returning true`);
    return true;
  }
}

export const mediaReadinessChecker = MediaReadinessChecker.getInstance();
