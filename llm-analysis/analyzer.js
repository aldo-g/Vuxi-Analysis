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
    this.model = options.model || process.env.ANTHROPIC_MODEL || 'claude-3-7-sonnet-20250219';
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
      
      const files = await fs.readdir(this.screenshotsDir);
      const screenshots = [];
      
      for (const file of files) {
        if (file.endsWith('.png')) {
          const filePath = path.join(this.screenshotsDir, file);
          console.log(`📸 Processing screenshot: ${file}`);
          const imageData = await prepareImageForLLM(filePath);
          
          screenshots.push({
            filename: file,
            path: filePath,
            imageData: imageData,
            url: this.extractUrlFromFilename(file)
          });
        }
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
    
    console.log(`📄 Analyzing ${screenshots.length} pages concurrently (${this.concurrency} at a time)...`);
    
    // Prepare data for analysis
    const analysisData = [];
    
    // Match screenshots with lighthouse data
    for (const screenshot of screenshots) {
      const matchingLighthouse = lighthouseData.find(lh => lh.url === screenshot.url);
      
      analysisData.push({
        url: screenshot.url,
        screenshot: screenshot,
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
              console.log(`     📄 [${globalIndex}] Analyzing: ${data.url} (attempt ${attempt})`);
              const pageAnalysis = await this.analyzePageWithLLM(data.screenshot, data.lighthouse, data.url);
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
  
  async analyzePageWithLLM(screenshot, lighthouseData, url) {
    console.log(`🧠 Calling LLM for page analysis for ${url}...`);
    
    // Prepare the prompt with orgContext
    const prompt = getAnalysisPrompt('page', {
      url: url,
      lighthouse: lighthouseData,
      context: this.orgContext
    });
    
    if (this.provider === 'anthropic') {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4000,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: screenshot.imageData.mediaType,
                    data: screenshot.imageData.data
                  }
                }
              ]
            }
          ]
        });
        
        const analysisText = response.content[0].text;
        
        return {
          url: url,
          analysis: analysisText,
          screenshot: screenshot.filename,
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
      // OpenAI implementation
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          max_tokens: 4000,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${screenshot.imageData.mediaType};base64,${screenshot.imageData.data}`
                  }
                }
              ]
            }
          ]
        });
        
        const analysisText = response.choices[0].message.content;
        
        return {
          url: url,
          analysis: analysisText,
          screenshot: screenshot.filename,
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
    const prompt = `Based on the following page analyses and technical summary, provide a high-level overview of the website for ${this.orgContext.org_name}:

TECHNICAL SUMMARY:
${technicalSummary}

PAGE ANALYSES:
${pageAnalyses.map((analysis, i) => `
PAGE ${i + 1}: ${analysis.url}
${analysis.analysis}
`).join('\n')}

Please provide a comprehensive overview that synthesizes all findings into key insights and actionable recommendations for ${this.orgContext.org_name} ${this.orgContext.org_purpose}.`;

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
    // Extract URL from filename like "000_domain.com_path.png"
    const nameWithoutExtension = filename.replace(/\.(png|jpg|jpeg)$/, '');
    const parts = nameWithoutExtension.split('_');
    
    if (parts.length >= 2) {
      // Remove the numeric prefix
      const urlParts = parts.slice(1);
      const domain = urlParts[0];
      const pathParts = urlParts.slice(1);
      
      // Reconstruct URL
      let url = `https://${domain}`;
      if (pathParts.length > 0 && pathParts[0] !== 'index') {
        url += '/' + pathParts.join('/');
      }
      
      return url;
    }
    
    return null;
  }
}

module.exports = { LLMAnalyzer };