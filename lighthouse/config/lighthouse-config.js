// lighthouse-config.js - Configuration for Lighthouse audits

module.exports = {
    extends: 'lighthouse:default',
    settings: {
      // Run in headless Chrome
      formFactor: 'desktop',
      screenEmulation: {
        mobile: false,
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        disabled: false,
      },
      
      // Throttling settings for consistent results
      throttling: {
        rttMs: 40,
        throughputKbps: 10240,
        requestLatencyMs: 0,
        downloadThroughputKbps: 0,
        uploadThroughputKbps: 0,
        cpuSlowdownMultiplier: 1,
      },
      
      // Other settings
      maxWaitForFcp: 30000,
      maxWaitForLoad: 45000,
      pauseAfterFcpMs: 1000,
      pauseAfterLoadMs: 1000,
      skipAudits: [
        // Skip audits we don't need
        'screenshot-thumbnails',
        'final-screenshot',
        'largest-contentful-paint-element',
      ],
    },
    
    // Only run the audits we care about
    onlyAudits: [
      // Performance metrics
      'first-contentful-paint',
      'largest-contentful-paint',
      'interactive',
      'speed-index',
      'total-blocking-time',
      'cumulative-layout-shift',
      
      // Core Web Vitals
      'metrics',
      
      // SEO basics
      'meta-description',
      'meta-viewport',
      'document-title',
      
      // Accessibility basics
      'color-contrast',
      'image-alt',
      'html-has-lang',
      
      // Best practices
      'errors-in-console',
      'is-on-https',
      'uses-responsive-images',
    ],
  };