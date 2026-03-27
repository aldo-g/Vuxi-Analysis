require('dotenv').config(); // Load environment variables

const fs = require('fs-extra');
const path = require('path');
const { LLMAnalyzer } = require('./analyzer');

class LLMAnalysisService {
  constructor(options = {}) {
    this.provider = options.provider || 'anthropic';
    this.model = options.model || process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-20250219';
    this.concurrency = options.concurrency || 3; // Add concurrency option
    this.screenshotsDir = options.screenshotsDir || './data/screenshots';
    this.lighthouseDir = options.lighthouseDir || './data/lighthouse';
    this.outputDir = options.outputDir || './data/analysis';
    
    // IMPORTANT: Add support for specific URLs
    this.specificUrls = options.specificUrls || null;
    
    // Organization context - can be overridden via options or environment
    this.orgContext = {
      org_name: options.org_name || process.env.ORG_NAME || 'the organization',
      org_type: options.org_type || process.env.ORG_TYPE || 'organization',
      org_purpose: options.org_purpose || process.env.ORG_PURPOSE || 'to achieve its business goals and serve its users effectively'
    };
  }

  // Helper method to check if a URL matches our target URLs
  urlMatches(fileUrl, targetUrls) {
    if (!targetUrls || targetUrls.length === 0) return true;
    
    for (const targetUrl of targetUrls) {
      try {
        const targetUrlObj = new URL(targetUrl);
        const fileUrlObj = new URL(fileUrl);
        
        // Match by hostname and pathname
        if (targetUrlObj.hostname === fileUrlObj.hostname) {
          // Handle root path matching
          const targetPath = targetUrlObj.pathname === '/' ? '' : targetUrlObj.pathname;
          const filePath = fileUrlObj.pathname === '/' ? '' : fileUrlObj.pathname;
          
          if (targetPath === filePath) {
            return true;
          }
        }
      } catch (error) {
        // If URL parsing fails, try string matching
        if (fileUrl.includes(targetUrl) || targetUrl.includes(fileUrl)) {
          return true;
        }
      }
    }
    return false;
  }

  // Helper method to check if a filename matches our target URLs
  filenameMatches(filename, targetUrls) {
    if (!targetUrls || targetUrls.length === 0) return true;
    
    for (const targetUrl of targetUrls) {
      try {
        const urlObj = new URL(targetUrl);
        const domain = urlObj.hostname.replace(/^www\./, '');
        const pathname = urlObj.pathname;
        
        // Check if filename contains the domain
        if (!filename.includes(domain)) continue;
        
        // For root path, look for 'index'
        if (pathname === '/' || pathname === '') {
          if (filename.includes('index')) {
            return true;
          }
        } else {
          // For other paths, look for path segments in filename
          const pathSegments = pathname.split('/').filter(Boolean);
          const hasPathMatch = pathSegments.some(segment => 
            filename.includes(segment.replace(/[^a-z0-9]/gi, ''))
          );
          if (hasPathMatch) {
            return true;
          }
        }
      } catch (error) {
        // Fallback to simple string matching
        if (filename.toLowerCase().includes(targetUrl.toLowerCase())) {
          return true;
        }
      }
    }
    return false;
  }

  async analyze() {
    console.log('🤖 LLM Analysis Service Starting...');
    console.log(`📸 Screenshots: ${this.screenshotsDir}`);
    console.log(`🚦 Lighthouse: ${this.lighthouseDir}`);
    console.log(`📁 Output: ${this.outputDir}`);
    console.log(`🧠 Provider: ${this.provider} (${this.model})`);
    console.log(`🔀 Concurrency: ${this.concurrency} pages at once`);
    console.log(`🏢 Organization: ${this.orgContext.org_name} (${this.orgContext.org_type})`);
    console.log(`🎯 Purpose: ${this.orgContext.org_purpose}`);
    
    // Log specific URLs if provided
    if (this.specificUrls && this.specificUrls.length > 0) {
      console.log(`🎯 Specific URLs to analyze: ${this.specificUrls.join(', ')}`);
    } else {
      console.log(`📊 Analyzing ALL available data`);
    }
    
    const startTime = Date.now();
    
    try {
      // Check API key
      if (!process.env.ANTHROPIC_API_KEY && this.provider === 'anthropic') {
        throw new Error('ANTHROPIC_API_KEY environment variable is required. Please add it to your .env file.');
      }
      
      console.log('API Key loaded from environment:', process.env.ANTHROPIC_API_KEY ? `${process.env.ANTHROPIC_API_KEY.substring(0, 7)}...` : 'NOT FOUND');
      
      // Ensure output directory exists
      await fs.ensureDir(this.outputDir);
      
      // Initialize analyzer with organization context
      const analyzer = new LLMAnalyzer({
        provider: this.provider,
        model: this.model,
        concurrency: this.concurrency,
        screenshotsDir: this.screenshotsDir,
        lighthouseDir: this.lighthouseDir,
        orgContext: this.orgContext
      });
      
      // Load screenshots and lighthouse data
      console.log('\n📥 Loading data...');
      const allScreenshots = await analyzer.loadScreenshots();
      const allLighthouseData = await analyzer.loadLighthouseData();
      
      console.log(`📸 Loaded ${allScreenshots.length} total screenshots`);
      console.log(`🚦 Loaded ${allLighthouseData.length} total lighthouse reports`);
      
      // Filter data if specific URLs are provided
      let screenshots = allScreenshots;
      let lighthouseData = allLighthouseData;
      
      if (this.specificUrls && this.specificUrls.length > 0) {
        console.log(`🎯 Filtering data for specific URLs...`);
        
        // Filter screenshots
        screenshots = allScreenshots.filter(screenshot => {
          // Try URL matching first
          if (screenshot.url && this.urlMatches(screenshot.url, this.specificUrls)) {
            console.log(`✅ Screenshot matched by URL: ${screenshot.url}`);
            return true;
          }
          
          // Try filename matching
          if (screenshot.filename && this.filenameMatches(screenshot.filename, this.specificUrls)) {
            console.log(`✅ Screenshot matched by filename: ${screenshot.filename}`);
            return true;
          }
          
          console.log(`❌ Screenshot filtered out: ${screenshot.filename || screenshot.url || 'unknown'}`);
          return false;
        });
        
        // Filter lighthouse data
        lighthouseData = allLighthouseData.filter(report => {
          // Try URL matching first
          const reportUrl = report.finalUrl || report.requestedUrl || report.url;
          if (reportUrl && this.urlMatches(reportUrl, this.specificUrls)) {
            console.log(`✅ Lighthouse report matched by URL: ${reportUrl}`);
            return true;
          }
          
          // Try filename matching
          if (report.filename && this.filenameMatches(report.filename, this.specificUrls)) {
            console.log(`✅ Lighthouse report matched by filename: ${report.filename}`);
            return true;
          }
          
          console.log(`❌ Lighthouse report filtered out: ${report.filename || reportUrl || 'unknown'}`);
          return false;
        });
        
        console.log(`🎯 Filtered to ${screenshots.length} screenshots and ${lighthouseData.length} lighthouse reports`);
      }
      
      if (screenshots.length === 0 && lighthouseData.length === 0) {
        console.log('⚠️  No data to analyze after filtering');
        return {
          success: false,
          error: 'No screenshots or lighthouse data found for the specified URLs',
          analysis: null,
          stats: {}
        };
      }
      
      // Temporarily replace the analyzer's data with our filtered data
      analyzer.screenshots = screenshots;
      analyzer.lighthouseData = lighthouseData;
      
      // Run analysis
      console.log('\n🔍 Running LLM analysis with concurrency...');
      const analysis = await analyzer.analyzeWebsite();
      
      // Add organization context to analysis
      analysis.orgContext = this.orgContext;
      
      // Add filtering info
      if (this.specificUrls && this.specificUrls.length > 0) {
        analysis.filterInfo = {
          specificUrls: this.specificUrls,
          filteredFrom: {
            totalScreenshots: allScreenshots.length,
            totalLighthouseReports: allLighthouseData.length
          },
          analyzedData: {
            screenshots: screenshots.length,
            lighthouseReports: lighthouseData.length
          }
        };
      }
      
      // Save analysis with timestamp
      const analysisPath = path.join(this.outputDir, 'analysis.json');
      await fs.writeJson(analysisPath, analysis, { spaces: 2 });
      
      // Save metadata
      const duration = (Date.now() - startTime) / 1000;
      const metadata = {
        timestamp: new Date().toISOString(),
        duration_seconds: duration,
        provider: this.provider,
        model: this.model,
        concurrency: this.concurrency,
        screenshots_analyzed: screenshots.length,
        lighthouse_reports_analyzed: lighthouseData.length,
        analysis_version: '1.0.0',
        organization: this.orgContext,
        specificUrls: this.specificUrls || null
      };
      
      const metadataPath = path.join(this.outputDir, 'analysis-metadata.json');
      await fs.writeJson(metadataPath, metadata, { spaces: 2 });
      
      // Summary
      console.log('\n🎉 Analysis completed successfully');
      console.log(`⚡ Speed: ${(analysis.pageAnalyses?.length || 0 / duration).toFixed(2)} pages/second`);
      console.log(`🔀 Concurrency: ${this.concurrency}x parallel processing`);
      console.log(`⏱️  Duration: ${duration.toFixed(2)} seconds`);
      console.log(`📄 Analysis saved to: ${analysisPath}`);
      console.log(`📄 Metadata saved to: ${metadataPath}`);
      
      if (this.specificUrls && this.specificUrls.length > 0) {
        console.log(`🎯 Analyzed ${screenshots.length} screenshots for URLs: ${this.specificUrls.join(', ')}`);
      }
      
      return {
        success: true,
        analysis: analysis,
        stats: {
          duration: duration,
          screenshots: screenshots.length,
          lighthouseReports: lighthouseData.length,
          pageAnalyses: analysis.pageAnalyses?.length || 0
        },
        files: {
          analysis: analysisPath,
          metadata: metadataPath
        }
      };
      
    } catch (error) {
      console.error('❌ LLM Analysis failed:', error.message);
      console.error('Stack trace:', error.stack);
      return {
        success: false,
        error: error.message,
        analysis: null,
        stats: {}
      };
    }
  }
}

module.exports = { LLMAnalysisService };