const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const path = require('path');
const { createFilename } = require('./utils');
const { trimReport } = require('./report-trimmer');
const lighthouseConfig = require('./config/lighthouse-config');

let lighthouse;
try {
  const lighthouseModule = require('lighthouse');
  lighthouse = lighthouseModule.default || lighthouseModule;
} catch (err) {
  console.error('Error importing lighthouse:', err);
  throw new Error('Lighthouse module could not be imported. Please install with: npm install lighthouse');
}

class LighthouseAuditor {
  constructor(options = {}) {
    this.outputDir = options.outputDir;
    this.retries = options.retries || 1;
    this.browser = null;
    this.timeout = options.timeout || 60000; // 60 second timeout
    
    // Create output directories
    this.reportsDir = path.join(this.outputDir, 'reports');
    this.trimmedDir = path.join(this.outputDir, 'trimmed');
    
    fs.ensureDirSync(this.reportsDir);
    fs.ensureDirSync(this.trimmedDir);
  }
  
  async initBrowser() {
    if (!this.browser) {
      console.log('🚀 Launching Lighthouse browser...');
      
      const launchOptions = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-extensions',
          '--no-first-run'
        ],
        timeout: this.timeout
      };
      
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      }
      
      try {
        this.browser = await puppeteer.launch(launchOptions);
        console.log('✅ Browser launched successfully');
      } catch (error) {
        console.error('❌ Failed to launch browser:', error);
        throw error;
      }
    }
  }
  
  async closeBrowser() {
    if (this.browser) {
      console.log('🛑 Closing Lighthouse browser...');
      try {
        await this.browser.close();
        console.log('✅ Browser closed successfully');
      } catch (error) {
        console.error('❌ Error closing browser:', error);
      }
      this.browser = null;
    }
  }
  
  async auditUrl(url, index) {
    const startTime = Date.now();
    let attempt = 0;
    let lastError = null;
    
    if (typeof lighthouse !== 'function') {
      throw new Error('Lighthouse module is not properly imported');
    }
    
    while (attempt < this.retries) {
      attempt++;
      console.log(`🚦 [${index}] Auditing: ${url} (attempt ${attempt}/${this.retries})`);
      
      try {
        await this.initBrowser();
        
        const browserEndpoint = this.browser.wsEndpoint();
        const port = new URL(browserEndpoint).port;
        
        console.log(`   🔌 Using browser port: ${port}`);
        
        // Run lighthouse with timeout
        const lighthousePromise = lighthouse(url, {
          port: parseInt(port),
          output: 'json',
          logLevel: 'error',
          disableStorageReset: false,
          onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
          clearStorage: true,
          skipAudits: [
            'screenshot-thumbnails',
            'final-screenshot',
            'full-page-screenshot',
            'largest-contentful-paint-element',
            'layout-shift-elements'
          ]
        }, lighthouseConfig);
        
        // Add timeout to lighthouse
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Lighthouse audit timed out')), this.timeout);
        });
        
        const result = await Promise.race([lighthousePromise, timeoutPromise]);
        
        if (!result || !result.lhr) {
          throw new Error('Lighthouse returned no result');
        }
        
        // Generate filenames
        const baseFilename = createFilename(url, index);
        const jsonFilename = `${baseFilename}.json`;
        const trimmedFilename = `${baseFilename}_trimmed.json`;
        
        // Save full report
        const fullReportPath = path.join(this.reportsDir, jsonFilename);
        await fs.writeJson(fullReportPath, result.lhr, { spaces: 2 });
        
        // Trim and save essential data
        const trimmedReport = trimReport(result.lhr);
        const trimmedReportPath = path.join(this.trimmedDir, trimmedFilename);
        await fs.writeJson(trimmedReportPath, trimmedReport, { spaces: 2 });
        
        const duration = Date.now() - startTime;
        console.log(`  ✅ Success in ${duration}ms: ${jsonFilename}`);
        
        // Extract metrics with error handling
        let metrics = {};
        let scores = {};
        
        try {
          if (result.lhr.audits && result.lhr.audits.metrics && result.lhr.audits.metrics.details && result.lhr.audits.metrics.details.items) {
            metrics = result.lhr.audits.metrics.details.items[0] || {};
          }
          scores = result.lhr.categories || {};
        } catch (metricsError) {
          console.warn('⚠️  Error extracting metrics:', metricsError.message);
        }
        
        const returnData = {
          url: url,
          reportPath: `reports/${jsonFilename}`,
          trimmedPath: `trimmed/${trimmedFilename}`,
          timestamp: new Date().toISOString(),
          duration_ms: duration,
          metrics: {
            performance: scores.performance ? scores.performance.score : 0,
            accessibility: scores.accessibility ? scores.accessibility.score : 0,
            bestPractices: scores['best-practices'] ? scores['best-practices'].score : 0,
            seo: scores.seo ? scores.seo.score : 0,
            firstContentfulPaint: metrics.firstContentfulPaint || 0,
            largestContentfulPaint: metrics.largestContentfulPaint || 0,
            totalBlockingTime: metrics.totalBlockingTime || 0,
            cumulativeLayoutShift: metrics.cumulativeLayoutShift || 0,
            speedIndex: metrics.speedIndex || 0,
            interactive: metrics.interactive || 0
          },
          attempt: attempt
        };
        
        return returnData;
        
      } catch (error) {
        lastError = error;
        const duration = Date.now() - startTime;
        console.error(`  ❌ Error (attempt ${attempt}/${this.retries}) after ${duration}ms: ${error.message}`);
        
        // Close and recreate browser on error
        await this.closeBrowser();
        
        if (attempt < this.retries) {
          console.log(`  ⏳ Waiting before retry...`);
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
      }
    }
    
    throw new Error(`Failed to audit ${url} after ${this.retries} attempts: ${lastError.message}`);
  }
}

module.exports = { LighthouseAuditor };