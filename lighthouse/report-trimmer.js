/**
 * Aggressively trims Lighthouse reports to include only essential data
 * Reduces file size by removing unnecessary details
 */

function trimReport(fullReport) {
  const trimmed = {
    finalUrl: fullReport.finalUrl,
    requestedUrl: fullReport.requestedUrl,
    lighthouseVersion: fullReport.lighthouseVersion,
    fetchTime: fullReport.fetchTime,
    
    // Overall scores only
    scores: {},
    
    // Core metrics only
    metrics: {},
    
    // Core Web Vitals only
    coreWebVitals: {},
    
    // Critical issues summary (no details)
    issues: {
      performance: [],
      accessibility: [],
      seo: [],
      bestPractices: []
    }
  };
  
  // Extract category scores (just the numbers)
  if (fullReport.categories) {
    Object.keys(fullReport.categories).forEach(key => {
      trimmed.scores[key] = {
        score: fullReport.categories[key].score,
        title: fullReport.categories[key].title
      };
    });
  }
  
  // Extract ONLY core metrics (no descriptions, no details) - with safety checks
  if (fullReport.audits && fullReport.audits.metrics && 
      fullReport.audits.metrics.details && 
      fullReport.audits.metrics.details.items && 
      fullReport.audits.metrics.details.items.length > 0) {
    
    const metricsData = fullReport.audits.metrics.details.items[0];
    
    trimmed.metrics = {
      firstContentfulPaint: metricsData.firstContentfulPaint || 0,
      largestContentfulPaint: metricsData.largestContentfulPaint || 0,
      interactive: metricsData.interactive || 0,
      speedIndex: metricsData.speedIndex || 0,
      totalBlockingTime: metricsData.totalBlockingTime || 0,
      cumulativeLayoutShift: metricsData.cumulativeLayoutShift || 0,
    };
    
    // Core Web Vitals (essential values only)
    trimmed.coreWebVitals = {
      lcp: {
        value: metricsData.largestContentfulPaint || 0,
        score: fullReport.audits['largest-contentful-paint']?.score || 0
      },
      fid: {
        value: metricsData.totalBlockingTime || 0, // TBT as proxy for FID
        score: fullReport.audits['total-blocking-time']?.score || 0
      },
      cls: {
        value: metricsData.cumulativeLayoutShift || 0,
        score: fullReport.audits['cumulative-layout-shift']?.score || 0
      }
    };
  } else {
    // Fallback with zero values if metrics are not available
    trimmed.metrics = {
      firstContentfulPaint: 0,
      largestContentfulPaint: 0,
      interactive: 0,
      speedIndex: 0,
      totalBlockingTime: 0,
      cumulativeLayoutShift: 0,
    };
    
    trimmed.coreWebVitals = {
      lcp: { value: 0, score: 0 },
      fid: { value: 0, score: 0 },
      cls: { value: 0, score: 0 }
    };
  }
  
  // Extract only CRITICAL issues (titles only, no details)
  const criticalAudits = [
    'meta-description',
    'color-contrast', 
    'image-alt',
    'errors-in-console'
  ];
  
  criticalAudits.forEach(auditId => {
    if (fullReport.audits && fullReport.audits[auditId] && fullReport.audits[auditId].score < 1) {
      const audit = fullReport.audits[auditId];
      
      // Determine category
      let category = 'bestPractices';
      if (auditId === 'meta-description') category = 'seo';
      if (auditId === 'color-contrast' || auditId === 'image-alt') category = 'accessibility';
      if (auditId === 'errors-in-console') category = 'bestPractices';
      
      // Add minimal issue info
      trimmed.issues[category].push({
        id: auditId,
        title: audit.title,
        score: audit.score
      });
    }
  });
  
  return trimmed;
}

module.exports = { trimReport };