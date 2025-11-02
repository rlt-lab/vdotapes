/**
 * Debounce utility - delays function execution until after wait time has passed
 * since the last invocation
 *
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait
 * @param {boolean} immediate - Execute on leading edge instead of trailing
 * @returns {Function} Debounced function with cancel method
 */
function debounce(func, wait = 300, immediate = false) {
  let timeout;

  const executedFunction = function(...args) {
    const context = this;

    const later = function() {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };

    const callNow = immediate && !timeout;

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);

    if (callNow) func.apply(context, args);
  };

  // Add cancel method
  executedFunction.cancel = function() {
    clearTimeout(timeout);
    timeout = null;
  };

  return executedFunction;
}

/**
 * Throttle utility - ensures function is called at most once per wait period
 *
 * @param {Function} func - Function to throttle
 * @param {number} wait - Milliseconds to wait between calls
 * @returns {Function} Throttled function
 */
function throttle(func, wait = 300) {
  let inThrottle;
  let lastFunc;
  let lastRan;

  return function(...args) {
    const context = this;

    if (!inThrottle) {
      func.apply(context, args);
      lastRan = Date.now();
      inThrottle = true;
    } else {
      clearTimeout(lastFunc);
      lastFunc = setTimeout(function() {
        if (Date.now() - lastRan >= wait) {
          func.apply(context, args);
          lastRan = Date.now();
        }
      }, Math.max(wait - (Date.now() - lastRan), 0));
    }
  };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { debounce, throttle };
} else {
  window.debounce = debounce;
  window.throttle = throttle;
}
