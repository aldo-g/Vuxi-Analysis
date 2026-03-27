const fs = require('fs-extra');
const path = require('path');
const { ReportGenerator } = require('./generators/report-generator');

class HTMLReportService {
  constructor(options = {}) {
    this.outputDir = options.outputDir || './data/reports';
    this.screenshotsDir = options.screenshotsDir || './data/screenshots';
  }

  async generateTemporary(analysisData) {
    console.log('📄 HTML Report Service Starting (Temporary Report)...');
    console.log(`📸 Screenshots: ${this.screenshotsDir}`);
    
    const startTime = Date.now();
    
    try {
      // Verify we have analysis data
      if (!analysisData) {
        throw new Error('No analysis data provided');
      }
      
      // Initialize report generator for temporary report
      const generator = new ReportGenerator({
        outputDir: this.outputDir,
        screenshotsDir: this.screenshotsDir
      });
      
      // Generate temporary report
      console.log('\n🎨 Generating temporary report...');
      const result = await generator.generateTemporaryReport(analysisData);
      
      if (!result.success) {
        throw new Error('Temporary report generation failed');
      }
      
      const duration = (Date.now() - startTime) / 1000;
      
      console.log('\n🎉 Temporary report generated successfully');
      console.log(`⏱️  Duration: ${duration.toFixed(2)} seconds`);
      
      return {
        success: true,
        duration: duration,
        reportData: result.reportData,
        reportId: result.reportId
      };
      
    } catch (error) {
      console.error('❌ HTML Report Service failed:', error);
      
      return {
        success: false,
        error: error.message,
        duration: (Date.now() - startTime) / 1000
      };
    }
  }

  async generateTemporaryFromFile(analysisFilePath) {
    console.log('📄 HTML Report Service Starting (Temporary Report)...');
    console.log(`📥 Input: ${analysisFilePath}`);
    console.log(`📸 Screenshots: ${this.screenshotsDir}`);
    
    try {
      // Check if analysis file exists
      if (!await fs.pathExists(analysisFilePath)) {
        throw new Error(`Analysis file not found: ${analysisFilePath}`);
      }
      
      // Read analysis data
      console.log('\n📥 Reading analysis data...');
      const analysisData = await fs.readJson(analysisFilePath);
      
      // Generate temporary report using the main method
      return await this.generateTemporary(analysisData);
      
    } catch (error) {
      console.error('❌ Failed to load analysis file:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = { HTMLReportService };