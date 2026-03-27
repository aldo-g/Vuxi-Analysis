/**
 * Creates a safe filename from a URL and index
 * @param {string} url - The URL to create a filename from
 * @param {number} index - The index number for the report
 * @returns {string} A safe filename
 */
function createFilename(url, index) {
    try {
      const urlObj = new URL(url);
      
      // Get domain without www
      let domain = urlObj.hostname.replace(/^www\./, '');
      
      // Get pathname without leading/trailing slashes
      let pathname = urlObj.pathname
        .replace(/^\/+|\/+$/g, '') // Remove leading/trailing slashes
        .replace(/\//g, '_')       // Replace slashes with underscores
        .replace(/[^a-zA-Z0-9_-]/g, '') || 'index'; // Remove special chars
      
      // Truncate if too long
      if (pathname.length > 50) {
        pathname = pathname.substring(0, 50);
      }
      
      // Create filename with index prefix
      const filename = `${String(index).padStart(3, '0')}_${domain}_${pathname}`;
      
      return filename;
    } catch (error) {
      // Fallback for invalid URLs
      console.warn(`Error parsing URL ${url}:`, error.message);
      return `${String(index).padStart(3, '0')}_invalid_url`;
    }
  }
  
  /**
   * Formats a Lighthouse score (0-1) to a percentage
   * @param {number} score - Lighthouse score
   * @returns {string} Formatted percentage
   */
  function formatScore(score) {
    if (score === null || score === undefined) return 'N/A';
    return `${Math.round(score * 100)}%`;
  }
  
  /**
   * Formats a duration in milliseconds to a human-readable string
   * @param {number} milliseconds - Duration in milliseconds
   * @returns {string} Formatted duration string
   */
  function formatDuration(milliseconds) {
    if (milliseconds < 1000) {
      return `${Math.round(milliseconds)}ms`;
    }
    return `${(milliseconds / 1000).toFixed(2)}s`;
  }
  
  /**
   * Categorizes performance scores
   * @param {number} score - Performance score (0-1)
   * @returns {string} Category: 'good', 'needs-improvement', or 'poor'
   */
  function categorizePerformance(score) {
    if (score >= 0.9) return 'good';
    if (score >= 0.5) return 'needs-improvement';
    return 'poor';
  }
  
  /**
   * Extracts Core Web Vitals thresholds
   * @returns {Object} CWV thresholds
   */
  function getCoreWebVitalsThresholds() {
    return {
      lcp: {
        good: 2500,
        needsImprovement: 4000
      },
      fid: {
        good: 100,
        needsImprovement: 300
      },
      cls: {
        good: 0.1,
        needsImprovement: 0.25
      }
    };
  }
  
  /**
   * Categorizes a Core Web Vital metric
   * @param {string} metric - Metric name (lcp, fid, cls)
   * @param {number} value - Metric value
   * @returns {string} Category: 'good', 'needs-improvement', or 'poor'
   */
  function categorizeCoreWebVital(metric, value) {
    const thresholds = getCoreWebVitalsThresholds();
    const metricThresholds = thresholds[metric.toLowerCase()];
    
    if (!metricThresholds) return 'unknown';
    
    if (value <= metricThresholds.good) return 'good';
    if (value <= metricThresholds.needsImprovement) return 'needs-improvement';
    return 'poor';
  }
  
  module.exports = {
    createFilename,
    formatScore,
    formatDuration,
    categorizePerformance,
    getCoreWebVitalsThresholds,
    categorizeCoreWebVital
  };