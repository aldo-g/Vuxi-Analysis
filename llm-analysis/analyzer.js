require('dotenv').config(); // Load environment variables

const Anthropic = require('@anthropic-ai/sdk');

// Import OpenAI only when needed
let OpenAI;

const fs = require('fs-extra');
const path = require('path');
const { prepareImageForLLM } = require('./utils');
const { getAnalysisPrompt } = require('./prompts/analysis-prompt');
const { getTechnicalPrompt } = require('./prompts/technical-prompt');

class LLMAnalyzer {
  constructor(options = {}) {
    this.provider = options.provider || 'anthropic';
    this.model = options.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
    this.concurrency = options.concurrency || 3;
    this.screenshotsDir = options.screenshotsDir;
    this.lighthouseDir = options.lighthouseDir;
    
    // Organization context - ensure it has the proper structure
    const defaultOrgContext = {
      org_name: 'the organization',
      org_type: 'organization',
      org_purpose: 'to achieve its business goals and serve its users effectively'
    };
    
    // Merge provided orgContext with defaults
    this.orgContext = {
      ...defaultOrgContext,
      ...options.orgContext
    };
    
    // Ensure all required properties exist and are strings
    this.orgContext.org_name = this.orgContext.org_name || defaultOrgContext.org_name;
    this.orgContext.org_type = this.orgContext.org_type || defaultOrgContext.org_type;
    this.orgContext.org_purpose = this.orgContext.org_purpose || defaultOrgContext.org_purpose;
    
    console.log(`🏢 LLMAnalyzer initialized with org context:`, this.orgContext);
    
    // Properties for storing filtered data
    this.screenshots = null;
    this.lighthouseData = null;
    
    // Initialize LLM client
    this.initializeClient();
  }
  
  initializeClient() {
    if (this.provider === 'anthropic') {
      // Check for API key in environment
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY environment variable is required. Please set it in your .env file.');
      }
      
      console.log(`API Key loaded from environment: ${apiKey.substring(0, 8)}...`);
      
      this.client = new Anthropic({
        apiKey: apiKey,
      });
      
      if (!this.client) {
        throw new Error('Failed to initialize Anthropic client');
      }
    } else if (this.provider === 'openai') {
      if (!OpenAI) {
        OpenAI = require('openai').OpenAI;
      }
      this.client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    } else {
      throw new Error(`Unsupported provider: ${this.provider}`);
    }
  }
  
  async loadScreenshots() {
    try {
      // Use screenshotsDir directly - it should already point to the desktop folder
      console.log(`📸 Loading screenshots from: ${this.screenshotsDir}`);

      // Check if the path exists
      if (!await fs.pathExists(this.screenshotsDir)) {
        console.error(`Screenshots directory does not exist: ${this.screenshotsDir}`);
        return [];
      }

      // Load sidecar URL map written by the analysis server for custom/uploaded screenshots
      let urlMap = {};
      try {
        urlMap = await fs.readJson(path.join(this.screenshotsDir, 'url-map.json'));
        console.log(`📍 Loaded URL map with ${Object.keys(urlMap).length} entr(ies)`);
      } catch (_) {}

      const files = await fs.readdir(this.screenshotsDir);
      const screenshots = [];

      for (const file of files) {
        if (!/\.(png|jpg|jpeg)$/i.test(file)) continue;
        const filePath = path.join(this.screenshotsDir, file);
        console.log(`📸 Processing screenshot: ${file}`);
        const imageData = await prepareImageForLLM(filePath);

        // Use URL map first, fall back to filename-based extraction
        // Normalize URL: strip trailing slash from root paths so that
        // https://example.com/ and https://example.com group into the same page.
        const rawUrl = urlMap[file] || this.extractUrlFromFilename(file);
        let url = rawUrl;
        try {
          const u = new URL(rawUrl);
          if (u.pathname === '/') u.pathname = '';
          url = u.href.replace(/\/$/, '') || rawUrl;
        } catch (_) {}

        screenshots.push({
          filename: file,
          path: filePath,
          imageData: imageData,
          url
        });
      }

      // Sort by filename to ensure consistent order
      screenshots.sort((a, b) => a.filename.localeCompare(b.filename));

      return screenshots;
    } catch (error) {
      console.error('Error loading screenshots:', error);
      return [];
    }
  }
  
  async loadLighthouseData() {
    try {
      // Use lighthouseDir directly - it should already point to the trimmed folder
      console.log(`🚦 Loading lighthouse data from: ${this.lighthouseDir}`);
      
      // Check if the path exists
      if (!await fs.pathExists(this.lighthouseDir)) {
        console.error(`Lighthouse directory does not exist: ${this.lighthouseDir}`);
        return [];
      }
      
      const files = await fs.readdir(this.lighthouseDir);
      const lighthouseData = [];
      
      for (const file of files) {
        if (file.endsWith('_trimmed.json')) {
          const filePath = path.join(this.lighthouseDir, file);
          console.log(`🚦 Processing lighthouse report: ${file}`);
          const data = await fs.readJson(filePath);
          
          lighthouseData.push({
            filename: file,
            path: filePath,
            data: data,
            url: data.requestedUrl || data.finalUrl
          });
        }
      }
      
      // Sort by filename to ensure consistent order
      lighthouseData.sort((a, b) => a.filename.localeCompare(b.filename));
      
      return lighthouseData;
    } catch (error) {
      console.error('Error loading lighthouse data:', error);
      return [];
    }
  }
  
  async analyzeWebsite() {
    // Use filtered data if available, otherwise load fresh data
    const screenshots = this.screenshots || await this.loadScreenshots();
    const lighthouseData = this.lighthouseData || await this.loadLighthouseData();

    console.log(`📄 Analyzing ${screenshots.length} screenshots across pages...`);

    // Group screenshots by URL so all interaction states for a page are analyzed together
    const screenshotsByUrl = new Map();
    for (const screenshot of screenshots) {
      const url = screenshot.url;
      if (!screenshotsByUrl.has(url)) {
        screenshotsByUrl.set(url, []);
      }
      screenshotsByUrl.get(url).push(screenshot);
    }

    console.log(`📄 Grouped into ${screenshotsByUrl.size} unique page(s)`);

    // Prepare data for analysis — one entry per unique URL, with all screenshots for that page
    const analysisData = [];

    for (const [url, pageScreenshots] of screenshotsByUrl) {
      const matchingLighthouse = lighthouseData.find(lh => lh.url === url);

      // Sort so baseline comes first, then interactions in order
      pageScreenshots.sort((a, b) => a.filename.localeCompare(b.filename));

      console.log(`📸 Page ${url}: ${pageScreenshots.length} screenshot(s) - ${pageScreenshots.map(s => s.filename).join(', ')}`);

      analysisData.push({
        url,
        screenshots: pageScreenshots,
        lighthouse: matchingLighthouse ? matchingLighthouse.data : null
      });
    }
    
    // Run analysis
    const analysis = {
      timestamp: new Date().toISOString(),
      provider: this.provider,
      model: this.model,
      concurrency: this.concurrency,
      orgContext: this.orgContext,
      pageAnalyses: [],
      technicalSummary: null,
      overview: null
    };
    
    try {
      // 1. Analyze individual pages with concurrency control
      console.log(`📄 Analyzing ${analysisData.length} pages concurrently (${this.concurrency} at a time)...`);
      
      const pageAnalyses = [];
      const batchSize = this.concurrency;
      
      for (let i = 0; i < analysisData.length; i += batchSize) {
        const batch = analysisData.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(analysisData.length / batchSize);
        
        console.log(`   Batch ${batchNumber}/${totalBatches}: Analyzing ${batch.length} pages concurrently...`);
        
        const batchPromises = batch.map(async (data, index) => {
          const globalIndex = i + index;
          const retryCount = 1;

          for (let attempt = 1; attempt <= retryCount; attempt++) {
            try {
              console.log(`     📄 [${globalIndex}] Analyzing: ${data.url} (${data.screenshots.length} screenshot(s), attempt ${attempt})`);
              const pageAnalysis = await this.analyzePageWithLLM(data.screenshots, data.lighthouse, data.url);
              console.log(`     ✅ [${globalIndex}] Completed: ${data.url}`);
              return pageAnalysis;
            } catch (error) {
              if (attempt === retryCount) {
                console.error(`     ❌ [${globalIndex}] Failed after ${retryCount} attempts: ${data.url}`, error);
                return {
                  url: data.url,
                  error: error.message,
                  analysis: 'Analysis failed due to an error',
                  timestamp: new Date().toISOString()
                };
              } else {
                console.warn(`     ⚠️  [${globalIndex}] Attempt ${attempt} failed for ${data.url}, retrying...`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
              }
            }
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        pageAnalyses.push(...batchResults);
        
        // Add a small delay between batches to be respectful to the API
        if (i + batchSize < analysisData.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      analysis.pageAnalyses = pageAnalyses;
      
      // 2. Generate technical summary
      console.log('🔧 Generating technical summary...');
      try {
        analysis.technicalSummary = await this.generateTechnicalSummary(pageAnalyses, lighthouseData);
      } catch (error) {
        console.error('Error generating technical summary:', error);
        analysis.technicalSummary = 'Technical summary generation failed';
      }
      
      // 3. Generate overview
      console.log('📊 Generating overview...');
      try {
        analysis.overview = await this.generateOverview(pageAnalyses, analysis.technicalSummary);
      } catch (error) {
        console.error('Error generating overview:', error);
        analysis.overview = 'Overview generation failed';
      }
      
      return analysis;
      
    } catch (error) {
      console.error('Error in website analysis:', error);
      throw error;
    }
  }
  
  async analyzePageWithLLM(screenshots, lighthouseData, url) {
    // screenshots is now an array — one entry per interaction state captured for this page
    console.log(`🧠 Calling LLM for page analysis: ${url} (${screenshots.length} image(s))`);

    const prompt = getAnalysisPrompt('page', {
      url,
      lighthouse: lighthouseData,
      context: this.orgContext,
      screenshotCount: screenshots.length,
    });

    if (this.provider === 'anthropic') {
      try {
        // Build the content array: text prompt followed by one image block per screenshot
        const contentBlocks = [{ type: 'text', text: prompt }];

        screenshots.forEach((screenshot, i) => {
          const label = screenshots.length > 1
            ? (i === 0 ? 'Baseline (page default state)' : `Interaction ${i}: ${screenshot.filename.replace(/^.*_\d{2}_interaction_\d+_/, '').replace(/_/g, ' ').replace('.png', '')}`)
            : 'Page screenshot';

          contentBlocks.push({ type: 'text', text: `\n[Image ${i + 1} of ${screenshots.length}: ${label}]` });
          contentBlocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: screenshot.imageData.mediaType,
              data: screenshot.imageData.data
            }
          });
        });

        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4000,
          messages: [{ role: 'user', content: contentBlocks }]
        });

        return {
          url,
          analysis: response.content[0].text,
          screenshots: screenshots.map(s => s.filename),
          screenshotCount: screenshots.length,
          lighthouse: lighthouseData ? 'included' : 'not_available',
          timestamp: new Date().toISOString(),
          provider: this.provider,
          model: this.model
        };

      } catch (error) {
        console.error(`Error analyzing page ${url}:`, error);
        throw error;
      }
    } else if (this.provider === 'openai') {
      try {
        const contentBlocks = [{ type: 'text', text: prompt }];

        screenshots.forEach((screenshot, i) => {
          const label = screenshots.length > 1
            ? (i === 0 ? 'Baseline (page default state)' : `Interaction ${i}`)
            : 'Page screenshot';

          contentBlocks.push({ type: 'text', text: `\n[Image ${i + 1} of ${screenshots.length}: ${label}]` });
          contentBlocks.push({
            type: 'image_url',
            image_url: { url: `data:${screenshot.imageData.mediaType};base64,${screenshot.imageData.data}` }
          });
        });

        const response = await this.client.chat.completions.create({
          model: this.model,
          max_tokens: 4000,
          messages: [{ role: 'user', content: contentBlocks }]
        });

        return {
          url,
          analysis: response.choices[0].message.content,
          screenshots: screenshots.map(s => s.filename),
          screenshotCount: screenshots.length,
          lighthouse: lighthouseData ? 'included' : 'not_available',
          timestamp: new Date().toISOString(),
          provider: this.provider,
          model: this.model
        };

      } catch (error) {
        console.error(`Error analyzing page ${url}:`, error);
        throw error;
      }
    }
  }
  
  async generateTechnicalSummary(pageAnalyses, lighthouseData) {
    const prompt = getTechnicalPrompt(this.orgContext, pageAnalyses, lighthouseData);
    
    if (this.provider === 'anthropic') {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 3000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });
      
      return response.content[0].text;
    } else if (this.provider === 'openai') {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 3000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });
      
      return response.choices[0].message.content;
    }
  }
  
  async generateOverview(pageAnalyses, technicalSummary) {
    const prompt = `Based on the following page analyses and technical summary, provide a comprehensive overview of the website for ${this.orgContext.org_name}.

TECHNICAL SUMMARY:
${technicalSummary}

PAGE ANALYSES:
${pageAnalyses.map((analysis, i) => `
PAGE ${i + 1}: ${analysis.url}
${analysis.analysis}
`).join('\n')}

You MUST structure your response using EXACTLY these section headers (in this order). Do not add any text before the first section header.

## KEY FINDINGS
Synthesize the most important observations across all pages. Include:
### Goal Achievement Assessment
How well does the site achieve its primary purpose for ${this.orgContext.org_purpose}?
### Key Strengths
What does the site do well?
### Critical Weaknesses
What are the most significant problems?

## STRATEGIC RECOMMENDATIONS
Provide prioritized, actionable recommendations. Group by priority (High/Medium/Low).

## OVERALL THEME ASSESSMENT
Evaluate the visual design, branding consistency, user experience patterns, and overall aesthetic quality across the site.

## IMPLEMENTATION ROADMAP
Provide a phased plan for improvements:
### Phase 1 - Quick Wins
Changes that can be made immediately with high impact.
### Phase 2 - Core Improvements
Medium-term changes requiring more effort.
### Phase 3 - Long-term Enhancements
Strategic improvements for future consideration.`;

    if (this.provider === 'anthropic') {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });
      
      return response.content[0].text;
    } else if (this.provider === 'openai') {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });
      
      return response.choices[0].message.content;
    }
  }
  
  extractUrlFromFilename(filename) {
    // Handles two filename formats produced by the capture service:
    //
    // Legacy (simple):      "001_domain.com_path.png"
    // Enhanced (interactive): "001_domain.com_page_00_00_baseline.png"
    //                          "001_domain.com_page_01_interaction_1_label.png"
    //
    // The strategy: strip the leading numeric prefix, extract the domain (first segment
    // containing a '.'), then take only the path segment immediately after the domain
    // (which is the page slug — "index" means root "/").
    // Everything after the page slug is screenshot/interaction metadata and is discarded.

    const nameWithoutExtension = filename.replace(/\.(png|jpg|jpeg)$/, '');
    const parts = nameWithoutExtension.split('_');

    if (parts.length < 2) return null;

    // Remove leading numeric prefix (e.g. "001")
    const withoutPrefix = parts[0].match(/^\d+$/) ? parts.slice(1) : parts;

    // Find the domain segment (contains a '.')
    const domainIndex = withoutPrefix.findIndex(p => p.includes('.'));
    if (domainIndex === -1) return null;

    const domain = withoutPrefix[domainIndex];
    const afterDomain = withoutPrefix.slice(domainIndex + 1);

    // The page path slug is the very next segment (if any), but only if it looks like
    // a path name rather than a number or known interaction keyword.
    // Numeric-only or screenshot-metadata segments signal we've reached the suffix.
    const metadataKeywords = /^(\d+|interaction|baseline|final|hover|click|expand|experi|create|filter|writing|next)$/i;
    const pageSegment = afterDomain.length > 0 && !metadataKeywords.test(afterDomain[0])
      ? afterDomain[0]
      : null;

    let url = `https://${domain}`;
    if (pageSegment && pageSegment !== 'index') {
      url += `/${pageSegment}`;
    }

    return url;
  }
}

module.exports = { LLMAnalyzer };