const fs = require('fs-extra');
const path = require('path');
const { Formatter } = require('./formatter');

class FormattingService {
  constructor(options = {}) {
    this.model = options.model || 'claude-3-7-sonnet-20250219';
    this.inputPath = options.inputPath || './data/analysis/analysis.json';
    this.outputPath = options.outputPath || './data/analysis/structured-analysis.json';
    
    // Organization context - can be overridden via options
    this.orgContext = options.orgContext || null; // Will be extracted from analysis data if not provided
  }

  async format() {
    console.log('🔄 Formatting Service Starting...');
    console.log(`📥 Input: ${this.inputPath}`);
    console.log(`📤 Output: ${this.outputPath}`);
    console.log(`🧠 Model: ${this.model}`);
    
    const startTime = Date.now();
    
    try {
      // Check if API key is available
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY environment variable is required');
      }
      
      // Check if input file exists
      if (!await fs.pathExists(this.inputPath)) {
        throw new Error(`Input file not found: ${this.inputPath}`);
      }
      
      // Read raw analysis data
      console.log('\n📖 Reading raw analysis data...');
      const rawAnalysisData = await fs.readJson(this.inputPath);
      
      // Check if we have meaningful data
      if (!rawAnalysisData || typeof rawAnalysisData !== 'object') {
        throw new Error('Invalid analysis data format');
      }
      
      console.log(`   ✅ Loaded analysis data (${Object.keys(rawAnalysisData).length} top-level keys)`);
      
      // Extract organization context from analysis data if not provided
      const orgContext = this.orgContext || rawAnalysisData.orgContext || {
        org_name: 'the organization',
        org_type: 'organization', 
        org_purpose: 'to achieve its business goals and serve its users effectively'
      };
      
      console.log(`🏢 Organization: ${orgContext.org_name} (${orgContext.org_type})`);
      console.log(`🎯 Purpose: ${orgContext.org_purpose}`);
      
      // Initialize formatter with organization context
      const formatter = new Formatter({
        model: this.model,
        orgContext: orgContext
      });
      
      // Format the data
      console.log('🔄 Formatting analysis data into structured format...');
      const result = await formatter.format(rawAnalysisData);
      
      if (result.status === 'success') {
        // Add organization context to the formatted data
        result.data.orgContext = orgContext;
        
        // Ensure output directory exists
        await fs.ensureDir(path.dirname(this.outputPath));
        
        // Save formatted data
        await fs.writeJson(this.outputPath, result.data, { spaces: 2 });
        
        const duration = (Date.now() - startTime) / 1000;
        
        console.log('\n✅ Formatting completed successfully');
        console.log(`⏱️  Duration: ${duration.toFixed(2)} seconds`);
        console.log(`📄 Formatted data saved to: ${this.outputPath}`);
        
        return {
          success: true,
          data: result.data,
          stats: {
            duration: duration,
            inputSize: JSON.stringify(rawAnalysisData).length,
            outputSize: JSON.stringify(result.data).length
          },
          files: {
            input: this.inputPath,
            output: this.outputPath
          }
        };
        
      } else {
        console.error(`❌ Formatting failed: ${result.error}`);
        
        // Save error information for debugging
        const errorData = {
          status: 'error',
          error: result.error,
          timestamp: new Date().toISOString(),
          orgContext: orgContext,
          rawData: rawAnalysisData // Include raw data for fallback
        };
        
        await fs.ensureDir(path.dirname(this.outputPath));
        await fs.writeJson(this.outputPath, errorData, { spaces: 2 });
        
        return {
          success: false,
          error: result.error,
          data: result.data || null,
          stats: {}
        };
      }
      
    } catch (error) {
      console.error('❌ Formatting service failed:', error.message);
      return {
        success: false,
        error: error.message,
        data: null,
        stats: {}
      };
    }
  }
}

module.exports = { FormattingService };