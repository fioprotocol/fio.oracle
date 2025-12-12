/**
 * Memory Logging Utility
 * Provides consistent memory usage logging throughout the application
 */

/**
 * Format bytes to MB with 2 decimal places
 */
const formatMB = (bytes) => {
  return (bytes / 1024 / 1024).toFixed(2);
};

/**
 * Get current memory usage formatted
 */
export const getMemoryUsage = () => {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
    external: mem.external,
    heapUsedMB: formatMB(mem.heapUsed),
    heapTotalMB: formatMB(mem.heapTotal),
    rssMB: formatMB(mem.rss),
  };
};

/**
 * Log memory usage with context
 * @param {string} context - Description of what's happening
 * @param {string} logPrefix - Optional prefix for the log
 * @param {object} previousMem - Optional previous memory to calculate delta
 */
export const logMemory = (context, logPrefix = '', previousMem = null) => {
  const mem = getMemoryUsage();
  const prefix = logPrefix ? `${logPrefix} ` : '';
  
  if (previousMem) {
    const delta = mem.heapUsed - previousMem.heapUsed;
    const deltaFormatted = delta >= 0 ? `+${formatMB(delta)}` : formatMB(delta);
    console.log(
      `${prefix}[MEMORY] ${context} - Heap: ${mem.heapUsedMB}MB / ${mem.heapTotalMB}MB (${deltaFormatted}MB delta), RSS: ${mem.rssMB}MB`,
    );
  } else {
    console.log(
      `${prefix}[MEMORY] ${context} - Heap: ${mem.heapUsedMB}MB / ${mem.heapTotalMB}MB, RSS: ${mem.rssMB}MB`,
    );
  }
  
  return mem;
};

/**
 * Create a memory checkpoint that can be used to measure delta later
 */
export const createMemoryCheckpoint = (label, logPrefix = '') => {
  const mem = getMemoryUsage();
  const prefix = logPrefix ? `${logPrefix} ` : '';
  console.log(
    `${prefix}[MEMORY CHECKPOINT] ${label} - Heap: ${mem.heapUsedMB}MB / ${mem.heapTotalMB}MB`,
  );
  return mem;
};

/**
 * Log memory delta from checkpoint
 */
export const logMemoryDelta = (label, checkpoint, logPrefix = '') => {
  const current = getMemoryUsage();
  const delta = current.heapUsed - checkpoint.heapUsed;
  const deltaFormatted = delta >= 0 ? `+${formatMB(delta)}` : formatMB(delta);
  const prefix = logPrefix ? `${logPrefix} ` : '';
  
  console.log(
    `${prefix}[MEMORY DELTA] ${label} - Current: ${current.heapUsedMB}MB, Delta: ${deltaFormatted}MB`,
  );
  
  return current;
};

/**
 * Log array size in memory (approximate)
 */
export const logArraySize = (arrayName, array, logPrefix = '') => {
  if (!Array.isArray(array)) {
    console.log(`${logPrefix}[MEMORY] ${arrayName} is not an array`);
    return;
  }
  
  const prefix = logPrefix ? `${logPrefix} ` : '';
  const length = array.length;
  
  // Rough estimate: assume each item is ~2KB (for event objects)
  const estimatedSizeKB = length * 2;
  const estimatedSizeMB = (estimatedSizeKB / 1024).toFixed(2);
  
  console.log(
    `${prefix}[MEMORY] ${arrayName} - ${length} items (~${estimatedSizeMB}MB estimated)`,
  );
};

/**
 * Force garbage collection if available and log results
 */
export const forceGCAndLog = (logPrefix = '') => {
  const prefix = logPrefix ? `${logPrefix} ` : '';
  
  if (global.gc) {
    const before = getMemoryUsage();
    console.log(`${prefix}[MEMORY] Forcing garbage collection...`);
    
    global.gc();
    
    const after = getMemoryUsage();
    const freed = before.heapUsed - after.heapUsed;
    const freedMB = formatMB(freed);
    
    console.log(
      `${prefix}[MEMORY] GC completed - Freed ${freedMB}MB (${before.heapUsedMB}MB → ${after.heapUsedMB}MB)`,
    );
    
    return after;
  } else {
    console.log(
      `${prefix}[MEMORY] GC not available (start node with --expose-gc to enable)`,
    );
    return getMemoryUsage();
  }
};

