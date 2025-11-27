import fs from 'fs';
import path from 'path';

import { LOG_DIRECTORY_PATH_NAME, SYSTEM_LOG_FILE } from './log-file-templates.js';
import config from '../../config/config.js';

const {
  mode,
  logging: { LOG_TO_FILE },
} = config;

const LOG_TO_CONSOLE = !Boolean(LOG_TO_FILE);

/**
 * Logger class for flexible logging to console and/or file
 */
class Logger {
  constructor() {
    this.systemLogPath = path.join(LOG_DIRECTORY_PATH_NAME, SYSTEM_LOG_FILE);
    this.startupMessagesShown = false;
    this.originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
  }

  /**
   * Format log message with timestamp
   * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG)
   * @param {string} message - Log message
   * @returns {string} - Formatted message
   */
  formatMessage(level, message) {
    const timestamp = new Date().toISOString();
    return `${timestamp} [${level}] ${message}`;
  }

  /**
   * Write to system log file (async to prevent blocking)
   * @param {string} message - Message to write
   */
  writeToFile(message) {
    if (!LOG_TO_FILE) return;

    try {
      // Ensure log directory exists
      const logDir = LOG_DIRECTORY_PATH_NAME;
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // Use async write to prevent blocking the event loop
      fs.appendFile(this.systemLogPath, message + '\n', (err) => {
        if (err) {
          // Use original console to prevent recursion
          this.originalConsole.error(`Failed to write to log file: ${err.message}`);
        }
      });
    } catch (error) {
      // If we can't write to file, at least log to console
      this.originalConsole.error(`Failed to write to log file: ${error.message}`);
    }
  }

  /**
   * Log info message
   * @param {string} message - Message to log
   * @param {Object} options - Logging options
   */
  info(message, { consoleOnly = false, fileOnly = false } = {}) {
    const formattedMessage = this.formatMessage('INFO', message);

    if (!fileOnly && LOG_TO_CONSOLE) {
      console.log(message);
    }

    if (!consoleOnly && LOG_TO_FILE) {
      this.writeToFile(formattedMessage);
    }
  }

  /**
   * Log warning message
   * @param {string} message - Message to log
   * @param {Object} options - Logging options
   */
  warn(message, { consoleOnly = false, fileOnly = false } = {}) {
    const formattedMessage = this.formatMessage('WARN', message);

    if (!fileOnly && LOG_TO_CONSOLE) {
      console.warn(message);
    }

    if (!consoleOnly && LOG_TO_FILE) {
      this.writeToFile(formattedMessage);
    }
  }

  /**
   * Log error message
   * @param {string} message - Message to log
   * @param {Object} options - Logging options
   */
  error(message, { consoleOnly = false, fileOnly = false } = {}) {
    const formattedMessage = this.formatMessage('ERROR', message);

    if (!fileOnly && LOG_TO_CONSOLE) {
      console.error(message);
    }

    if (!consoleOnly && LOG_TO_FILE) {
      this.writeToFile(formattedMessage);
    }
  }

  /**
   * Log debug message
   * @param {string} message - Message to log
   * @param {Object} options - Logging options
   */
  debug(message, { consoleOnly = false, fileOnly = false } = {}) {
    const formattedMessage = this.formatMessage('DEBUG', message);

    if (!fileOnly && LOG_TO_CONSOLE) {
      console.log(`[DEBUG] ${message}`);
    }

    if (!consoleOnly && LOG_TO_FILE) {
      this.writeToFile(formattedMessage);
    }
  }

  /**
   * Show startup logging information
   */
  showStartupInfo() {
    if (this.startupMessagesShown) return;

    const messages = [];
    messages.push('='.repeat(60));
    messages.push(`🚀 Oracle Server Starting - Mode: ${mode.toUpperCase()}`);
    messages.push('='.repeat(60));

    if (LOG_TO_FILE) {
      messages.push('📝 Logging: File Only');
      messages.push(`   System logs: ${this.systemLogPath}`);
    } else {
      messages.push('📝 Logging: Console Only');
    }

    messages.push('='.repeat(60));

    // Show startup info using original console (before interception)
    messages.forEach((msg) => this.originalConsole.log(msg));

    // Also write to file if enabled
    if (LOG_TO_FILE) {
      messages.forEach((msg) => this.writeToFile(this.formatMessage('INFO', msg)));
    }

    this.startupMessagesShown = true;
  }

  /**
   * Get current log file path
   */
  getLogFilePath() {
    return this.systemLogPath;
  }

  /**
   * Check if logging to console is enabled
   */
  isConsoleEnabled() {
    return LOG_TO_CONSOLE;
  }

  /**
   * Check if logging to file is enabled
   */
  isFileEnabled() {
    return LOG_TO_FILE;
  }

  /**
   * Intercept console methods to write to file instead of console
   */
  interceptConsole() {
    if (!LOG_TO_FILE) {
      return; // No need to intercept if not logging to file
    }

    const self = this;

    // Intercept console.log - write to file ONLY
    console.log = function (...args) {
      const message = args
        .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      self.writeToFile(self.formatMessage('INFO', message));
    };

    // Intercept console.warn - write to file ONLY
    console.warn = function (...args) {
      const message = args
        .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      self.writeToFile(self.formatMessage('WARN', message));
    };

    // Intercept console.error - write to file ONLY
    console.error = function (...args) {
      const message = args
        .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      self.writeToFile(self.formatMessage('ERROR', message));
    };
  }

  /**
   * Restore original console methods
   */
  restoreConsole() {
    console.log = this.originalConsole.log;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
  }
}

// Export singleton instance
const logger = new Logger();

// Intercept console methods when LOG_TO_FILE is enabled
if (LOG_TO_FILE) {
  logger.interceptConsole();
}

export default logger;

// Export for direct usage
export { logger };
